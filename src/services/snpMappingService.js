// src/services/snpMappingService.js
import sqlite3 from 'sqlite3';
import { promises as fs } from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import logger from '../utils/logger.js';
import { SNP_MAPPING, GWAMA_DB, MRMEGA_DB } from '../config/constants.js';

const execAsync = promisify(exec);
const SNP_FILE_PATH = SNP_MAPPING;

class SNPMappingService {
  async searchSNPs(searchTerm) {
    try {
      // Initialize results array
      let results = [];

      // Connect to GWAMA and MR-MEGA databases
      const gwamaDb = new sqlite3.Database(GWAMA_DB);
      const mrmegaDb = new sqlite3.Database(MRMEGA_DB);

      // Promisify SQLite queries
      const gwamaQuery = promisify(gwamaDb.all.bind(gwamaDb));
      const mrmegaQuery = promisify(mrmegaDb.all.bind(mrmegaDb));

      // Query GWAMA database for SNPs matching the search term
      const gwamaSnps = await gwamaQuery(`
        SELECT DISTINCT SNP_ID, chromosome, position
        FROM phewas_snp_data
        WHERE SNP_ID LIKE ? LIMIT 50
      `, [`${searchTerm}%`]);

      // Query MR-MEGA database for SNPs matching the search term
      const mrmegaSnps = await mrmegaQuery(`
        SELECT DISTINCT SNP_ID, chromosome, position
        FROM phewas_snp_data
        WHERE SNP_ID LIKE ? LIMIT 50
      `, [`${searchTerm}%`]);

      // Combine unique SNPs from both databases
      const allSnps = [...new Set([...gwamaSnps, ...mrmegaSnps])];

      // Fetch rsIDs from annotation file using tabix
      const snpData = await Promise.all(
        allSnps.map(async (snp) => {
          const { chromosome, position, SNP_ID } = snp;
          try {
            const command = `tabix ${SNP_FILE_PATH} ${chromosome}:${position}-${position}`;
            const { stdout } = await execAsync(command);
            const lines = stdout.split('\n').filter(Boolean);

            const annotation = lines.find((line) => {
              const fields = line.split('\t');
              return fields[2] === SNP_ID; // Match SNP_ID with annotation ID
            });

            if (annotation) {
              const fields = annotation.split('\t');
              return {
                type: 'snp',
                rsId: fields[14] || SNP_ID, // Use rsID if available, else SNP_ID
                internalId: SNP_ID,
                chromosome: chromosome,
                position: parseInt(position),
                gene: fields[5] || 'unknown',
                consequence: fields[8] || 'unknown',
              };
            }
            return null;
          } catch (error) {
            logger.error(`Error fetching annotation for SNP ${SNP_ID}:`, error);
            return null;
          }
        })
      );

      // Filter out null results and limit to 50
      results = snpData.filter(Boolean).slice(0, 50);

      // Close database connections
      gwamaDb.close();
      mrmegaDb.close();

      return { results };
    } catch (error) {
      logger.error('Error searching SNPs:', error);
      return { results: [] };
    }
  }
}

export const snpMappingService = new SNPMappingService();