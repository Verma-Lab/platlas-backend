import fs from 'fs';
import readline from 'readline';
import { createGunzip } from 'zlib';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import logger from '../utils/logger.js';
import { SNP_MAPPING } from '../config/constants.js';

const MRMEGA_DB = '/nfs/platlas_stor/db/genomics-backend/phewas_mrmega.db';
const SNP_FILE_PATH = SNP_MAPPING; // /home/ac.guptahr/platlas-backend/DATABASE/gwPheWAS_All.annotation.txt.gz

class SNPMappingService {
  constructor() {
    this.db = null;
    this.topSNPs = []; // Cache for top 50 rsIDs
    this.snpMap = new Map(); // In-memory map of SNP_ID to rsID details
    this.initialize();
  }

  // Initialize database and preload mappings
  async initialize() {
    try {
      // Connect to MR-MEGA database
      this.db = await open({
        filename: MRMEGA_DB,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READONLY
      });

      // Fetch all SNP_IDs from MR-MEGA database
      const snpRows = await this.db.all('SELECT DISTINCT SNP_ID FROM phewas_snp_data_mrmega');
      const validSnpIds = new Set(snpRows.map(row => row.SNP_ID));
      logger.info(`Fetched ${validSnpIds.size} SNP_IDs from MR-MEGA database`);

      // Load annotation file into memory
      const inputStream = fs.createReadStream(SNP_FILE_PATH).pipe(createGunzip());
      const rl = readline.createInterface({ input: inputStream, crlfDelay: Infinity });

      for await (const line of rl) {
        if (line.startsWith('#')) continue;
        const fields = line.split('\t');
        if (fields.length < 15) continue;

        const snpId = fields[2]; // ID
        const rsId = fields[14]; // Existing_variation
        if (validSnpIds.has(snpId) && rsId && rsId.startsWith('rs')) {
          this.snpMap.set(snpId, {
            type: 'snp',
            rsId,
            internalId: snpId,
            chromosome: fields[0],
            position: parseInt(fields[1]) || 0,
            gene: fields[5] || 'unknown',
            consequence: fields[8] || 'unknown'
          });
        }
      }
      rl.close();
      logger.info(`Loaded ${this.snpMap.size} SNP mappings into memory`);

      // Preload top 50 rsIDs
      const topSnpIds = Array.from(validSnpIds).slice(0, 100); // Take first 100 SNP_IDs
      this.topSNPs = topSnpIds
        .map(snpId => this.snpMap.get(snpId))
        .filter(Boolean)
        .slice(0, 50); // Limit to 50
      logger.info(`Preloaded ${this.topSNPs.length} top rsIDs`);
    } catch (error) {
      logger.error('Error initializing SNPMappingService:', error);
    }
  }

  // Search SNPs based on term
  async searchSNPs(searchTerm) {
    try {
      const searchLower = searchTerm.toLowerCase();

      // Handle default "rs" case
      if (searchLower === 'rs') {
        return { results: this.topSNPs };
      }

      // Filter in-memory map for real-time search
      const results = [];
      for (const entry of this.snpMap.values()) {
        if (entry.rsId.toLowerCase().startsWith(searchLower)) {
          results.push(entry);
          if (results.length >= 50) break; // Limit to 50 results
        }
      }

      logger.info(`Found ${results.length} SNPs for term ${searchTerm}`);
      return { results };
    } catch (error) {
      logger.error(`Error searching SNPs for ${searchTerm}:`, error);
      return { results: [] };
    }
  }

  // Cleanup on server shutdown
  async cleanup() {
    if (this.db) await this.db.close();
  }
}

export const snpMappingService = new SNPMappingService();

