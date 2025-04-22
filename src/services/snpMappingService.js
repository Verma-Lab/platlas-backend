// src/services/snpMappingService.js
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { exec } from 'child_process';
import logger from '../utils/logger.js';
import { SNP_MAPPING, GWAMA_DB, MRMEGA_DB } from '../config/constants.js';

const execAsync = promisify(exec);
const SNP_FILE_PATH = SNP_MAPPING;

class SNPMappingService {
  async searchSNPs(searchTerm) {
    try {
      let results = [];
      logger.info(`Searching SNPs with term: ${searchTerm}`);

      // Connect to GWAMA and MR-MEGA databases
      const gwamaDb = new sqlite3.Database(GWAMA_DB, (err) => {
        if (err) logger.error(`GWAMA DB connection error: ${err.message}`);
      });
      const mrmegaDb = new sqlite3.Database(MRMEGA_DB, (err) => {
        if (err) logger.error(`MR-MEGA DB connection error: ${err.message}`);
      });

      // Promisify SQLite queries
      const gwamaQuery = promisify(gwamaDb.all.bind(gwamaDb));
      const mrmegaQuery = promisify(mrmegaDb.all.bind(mrmegaDb));

      // Query GWAMA database for SNPs
      const gwamaSnps = await gwamaQuery(`
        SELECT DISTINCT SNP_ID, chromosome, position
        FROM phewas_snp_data
        LIMIT 100
      `);
      logger.info(`GWAMA SNPs found: ${gwamaSnps.length}`, gwamaSnps.slice(0, 5));

      // Query MR-MEGA database for SNPs
      const mrmegaSnps = await mrmegaQuery(`
        SELECT DISTINCT SNP_ID, chromosome, position
        FROM phewas_snp_data
        LIMIT 100
      `);
      logger.info(`MR-MEGA SNPs found: ${mrmegaSnps.length}`, mrmegaSnps.slice(0, 5));

      // Combine unique SNPs
      const allSnps = [...new Set([...gwamaSnps, ...mrmegaSnps].map(s => JSON.stringify(s)))].map(s => JSON.parse(s));
      logger.info(`Total unique SNPs: ${allSnps.length}`);

      // Fetch rsIDs from annotation file
      const snpData = await Promise.all(
        allSnps.map(async (snp) => {
          const { chromosome, position, SNP_ID } = snp;
          try {
            const command = `tabix ${SNP_FILE_PATH} ${chromosome}:${position}-${position}`;
            const { stdout } = await execAsync(command);
            const lines = stdout.split('\n').filter(Boolean);
            logger.debug(`Tabix output for SNP ${SNP_ID}: ${lines.length} lines`);

            const annotation = lines.find((line) => {
              const fields = line.split('\t');
              return fields[2] === SNP_ID; // Match SNP_ID with ID column
            });

            if (annotation) {
              const fields = annotation.split('\t');
              const rsId = fields[14] || SNP_ID; // Existing_variation column
              // Filter by search term
              if (rsId.startsWith(searchTerm.toLowerCase())) {
                return {
                  type: 'snp',
                  rsId,
                  internalId: SNP_ID,
                  chromosome,
                  position: parseInt(position),
                  gene: fields[5] || 'unknown',
                  consequence: fields[8] || 'unknown',
                };
              }
            }
            return null;
          } catch (error) {
            logger.error(`Error fetching annotation for SNP ${SNP_ID}: ${error.message}`);
            return null;
          }
        })
      );

      results = snpData.filter(Boolean).slice(0, 50);
      logger.info(`Final SNP results: ${results.length}`, results);

      gwamaDb.close();
      mrmegaDb.close();
      return { results };
    } catch (error) {
      logger.error(`Error searching SNPs: ${error.message}`);
      return { results: [] };
    }
  }
}

export const snpMappingService = new SNPMappingService();