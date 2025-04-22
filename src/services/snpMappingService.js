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
    this.searchCache = new Map(); // Cache for recent searches
    this.initialize();
  }

  // Initialize database and preload top SNPs
  async initialize() {
    try {
      // Connect to MR-MEGA database
      this.db = await open({
        filename: MRMEGA_DB,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READONLY
      });
      this.stmt = await this.db.prepare('SELECT 1 FROM phewas_snp_data_mrmega WHERE SNP_ID = ? LIMIT 1');

      // Preload top 100 SNP_IDs
      const topSnpIds = await this.db.all('SELECT DISTINCT SNP_ID FROM phewas_snp_data_mrmega LIMIT 100');
      this.topSNPs = await this.getRsIdsForSnpIds(topSnpIds.map(row => row.SNP_ID));
      logger.info(`Preloaded ${this.topSNPs.length} top rsIDs`);
    } catch (error) {
      logger.error('Error initializing SNPMappingService:', error);
    }
  }

  // Map SNP_IDs to rsIDs using annotation file
  async getRsIdsForSnpIds(snpIds) {
    const snpSet = new Set(snpIds);
    const results = [];
    const inputStream = fs.createReadStream(SNP_FILE_PATH).pipe(createGunzip());
    const rl = readline.createInterface({ input: inputStream, crlfDelay: Infinity });

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
        snpSet.delete(snpId); // Remove to avoid duplicates
        if (snpSet.size === 0) break;
      }
    }

    rl.close();
    return results;
  }

  // Search SNPs based on term
  async searchSNPs(searchTerm) {
    try {
      // Handle default "rs" case
      if (searchTerm.toLowerCase() === 'rs') {
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

      for await (const line of rl) {
        if (line.startsWith('#')) continue;
        const fields = line.split('\t');
        if (fields.length < 15) continue;

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

        if (results.length >= 50) break; // Limit to 50 results
      }

      rl.close();

      // Cache results
      this.searchCache.set(searchTerm, results);
      if (this.searchCache.size > 1000) {
        this.searchCache.delete(this.searchCache.keys().next().value); // Limit cache size
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
    if (this.stmt) await this.stmt.finalize();
    if (this.db) await this.db.close();
  }
}

export const snpMappingService = new SNPMappingService();