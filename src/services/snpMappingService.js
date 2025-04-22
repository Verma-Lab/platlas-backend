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
    this.stmt = null;
    this.topSNPs = []; // Cache for top 100 rsIDs
    this.initialize();
  }

  // Initialize database and preload top SNPs
  async initialize() {
    try {
      logger.info('Connecting to MR-MEGA database...');
      this.db = await open({
        filename: MRMEGA_DB,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READONLY
      });
      logger.info('Preparing statement for SNP_ID validation...');
      this.stmt = await this.db.prepare('SELECT 1 FROM phewas_snp_data_mrmega WHERE SNP_ID = ? LIMIT 1');

      // Preload top 100 SNP_IDs
      logger.info('Fetching top 100 SNP_IDs from phewas_snp_data_mrmega...');
      const topSnpIds = await this.db.all('SELECT DISTINCT SNP_ID FROM phewas_snp_data_mrmega LIMIT 100');
      if (topSnpIds.length === 0) {
        logger.warn('No SNP_IDs found in phewas_snp_data_mrmega');
      } else {
        this.topSNPs = await this.getRsIdsForSnpIds(topSnpIds.map(row => row.SNP_ID));
        logger.info(`Preloaded ${this.topSNPs.length} top rsIDs`);
      }
    } catch (error) {
      logger.error('Error initializing SNPMappingService:', error);
      this.topSNPs = [];
    }
  }

  // Map SNP_IDs to rsIDs using annotation file
  async getRsIdsForSnpIds(snpIds) {
    try {
      const snpSet = new Set(snpIds);
      const results = [];
      const inputStream = fs.createReadStream(SNP_FILE_PATH).pipe(createGunzip());
      const rl = readline.createInterface({ input: inputStream, crlfDelay: Infinity });

      logger.info('Mapping SNP_IDs to rsIDs from annotation file...');
      for await (const line of rl) {
        if (line.startsWith('#')) continue;
        const fields = line.split('\t');
        if (fields.length < 15) continue;

        const snpId = fields[2]; // ID
        const rsId = fields[14]; // Existing_variation
        if (snpSet.has(snpId) && rsId && rsId.startsWith('rs')) {
          results.push({
            type: 'snp',
            rsId,
            internalId: snpId,
            chromosome: fields[0],
            position: parseInt(fields[1]) || 0,
            gene: fields[5] || 'unknown',
            consequence: fields[8] || 'unknown'
          });
          snpSet.delete(snpId);
          if (snpSet.size === 0) break;
        }
      }

      rl.close();
      logger.info(`Mapped ${results.length} SNP_IDs to rsIDs`);
      return results;
    } catch (error) {
      logger.error('Error mapping SNP_IDs to rsIDs:', error);
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

      // Stream annotation file for rsID matches
      const inputStream = fs.createReadStream(SNP_FILE_PATH).pipe(createGunzip());
      const rl = readline.createInterface({ input: inputStream, crlfDelay: Infinity });

      const results = [];
      const searchLower = searchTerm.toLowerCase();
      let rowCount = 0;
      const maxRows = 1000000; // Limit to 1M rows to ensure <1s

      for await (const line of rl) {
        if (line.startsWith('#')) continue;
        const fields = line.split('\t');
        if (fields.length < 15) continue;

        rowCount++;
        const rsId = fields[14]; // Existing_variation
        const snpId = fields[2]; // ID
        if (rsId && rsId.toLowerCase().startsWith(searchLower)) {
          // Validate SNP_ID against MR-MEGA database
          const exists = await this.stmt.get(snpId);
          if (exists) {
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
        }

        if (results.length >= 50 || rowCount >= maxRows) break;
      }

      rl.close();
      logger.info(`Found ${results.length} SNPs for term ${searchTerm} after scanning ${rowCount} rows`);

      return { results };
    } catch (error) {
      logger.error(`Error searching SNPs for ${searchTerm}:`, error);
      return { results: [] };
    }
  }

  // Cleanup on server shutdown
  async cleanup() {
    try {
      if (this.stmt) await this.stmt.finalize();
      if (this.db) await this.db.close();
      logger.info('SNPMappingService cleanup complete');
    } catch (error) {
      logger.error('Error during SNPMappingService cleanup:', error);
    }
  }
}

export const snpmappingService = new SNPMappingService();