import fs from 'fs';
import { promises as fsPromises } from 'fs';
import readline from 'readline';
import { createGunzip } from 'zlib';
import logger from '../utils/logger.js';
import { SNP_MAPPING } from '../config/constants.js';

const SNP_FILE_PATH = SNP_MAPPING; // /home/ac.guptahr/platlas-backend/DATABASE/gwPheWAS_All.annotation.txt.gz
const SNP_IDS_FILE = '/tmp/snp_ids_only.txt';

class SNPMappingService {
  constructor() {
    this.topSNPs = []; // Cache for top 50 rsIDs
    this.searchCache = new Map(); // Cache for recent searches
    this.validSnpIds = new Set(); // Cache for snp_ids_only.txt
    this.initialize();
  }

  // Initialize by loading snp_ids_only.txt and preloading top rsIDs
  async initialize() {
    try {
      // Load snp_ids_only.txt
      logger.info('Loading SNP IDs from snp_ids_only.txt...');
      const snpIdsData = await fsPromises.readFile(SNP_IDS_FILE, 'utf8');
      this.validSnpIds = new Set(snpIdsData.split('\n').filter(id => id.trim()));
      logger.info(`Loaded ${this.validSnpIds.size} SNP IDs`);

      // Preload top rsIDs
      logger.info('Preloading top rsIDs...');
      this.topSNPs = await this.getTopRsIds();
      logger.info(`Preloaded ${this.topSNPs.length} top rsIDs`);
    } catch (error) {
      logger.error('Error initializing SNPMappingService:', error);
    }
  }

  // Get top 50 rsIDs where ID matches snp_ids_only.txt
  async getTopRsIds() {
    try {
      const results = [];
      const inputStream = fs.createReadStream(SNP_FILE_PATH).pipe(createGunzip());
      const rl = readline.createInterface({ input: inputStream, crlfDelay: Infinity });

      let rowCount = 0;
      const maxRows = 1000000; // Limit to 1M rows for speed

      for await (const line of rl) {
        if (line.startsWith('#')) continue;
        const fields = line.split('\t');
        if (fields.length < 15) continue;

        rowCount++;
        const snpId = fields[2]; // ID
        const rsId = fields[14]; // Existing_variation
        if (this.validSnpIds.has(snpId) && rsId && rsId.startsWith('rs')) {
          results.push({
            type: 'snp',
            rsId,
            internalId: snpId,
            chromosome: fields[0],
            position: parseInt(fields[1]) || 0,
            gene: fields[5] || 'unknown',
            consequence: fields[8] || 'unknown'
          });
        }

        if (results.length >= 50 || rowCount >= maxRows) break;
      }

      rl.close();
      logger.info(`Found ${results.length} top rsIDs after scanning ${rowCount} rows`);
      return results;
    } catch (error) {
      logger.error('Error preloading top rsIDs:', error);
      return [];
    }
  }

  // Search SNPs based on term
  async searchSNPs(searchTerm) {
    try {
      logger.info(`Searching SNPs for term: ${searchTerm}`);

      // Handle default "rs" case
      if (searchTerm.toLowerCase() === 'rs') {
        logger.info(`Returning ${this.topSNPs.length} cached rsIDs for term "rs"`);
        return { results: this.topSNPs.slice(0, 50) };
      }

      // Check cache
      if (this.searchCache.has(searchTerm)) {
        logger.info(`Cache hit for ${searchTerm}`);
        return { results: this.searchCache.get(searchTerm) };
      }

      // Stream annotation file for rsID matches
      const inputStream = fs.createReadStream(SNP_FILE_PATH).pipe(createGunzip());
      const rl = readline.createInterface({ input: inputStream, crlfDelay: Infinity });

      const results = [];
      const searchLower = searchTerm.toLowerCase();
      let rowCount = 0;
      const maxRows = 1000000; // Limit to 1M rows for <1s

      for await (const line of rl) {
        if (line.startsWith('#')) continue;
        const fields = line.split('\t');
        if (fields.length < 15) continue;

        rowCount++;
        const rsId = fields[14]; // Existing_variation
        const snpId = fields[2]; // ID
        if (rsId && rsId.toLowerCase().startsWith(searchLower) && this.validSnpIds.has(snpId)) {
          results.push({
            type: 'snp',
            rsId,
            internalId: snpId,
            chromosome: fields[0],
            position: parseInt(fields[1]) || 0,
            gene: fields[5] || 'unknown',
            consequence: fields[8] || 'unknown'
          });
        }

        if (results.length >= 50 || rowCount >= maxRows) break;
      }

      rl.close();
      logger.info(`Found ${results.length} SNPs for term ${searchTerm} after scanning ${rowCount} rows`);

      // Cache results
      this.searchCache.set(searchTerm, results);
      if (this.searchCache.size > 1000) {
        this.searchCache.delete(this.searchCache.keys().next().value);
      }

      return { results };
    } catch (error) {
      logger.error(`Error searching SNPs for ${searchTerm}:`, error);
      return { results: [] };
    }
  }
}

export const snpMappingService = new SNPMappingService();