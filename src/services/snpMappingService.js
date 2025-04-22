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
      const gwamaDb = new sqlite3.Database(GWAMA_DB, sqlite3.OPEN_READONLY, (err) => {
        if (err) logger.error(`GWAMA DB connection error: ${err.message}`);
      });
      const mrmegaDb = new sqlite3.Database(MRMEGA_DB, sqlite3.OPEN_READONLY, (err) => {
        if (err) logger.error(`MR-MEGA DB connection error: ${err.message}`);
      });

      // Promisify SQLite queries
      const gwamaGet = promisify(gwamaDb.all.bind(gwamaDb));
      const mrmegaGet = promisify(mrmegaDb.all.bind(mrmegaDb));

      // Check if table exists
      const checkTable = async (db, tableName, dbName) => {
        try {
          const tables = await promisify(db.all.bind(db))(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`
          );
          return tables.length > 0;
        } catch (error) {
          logger.error(`Error checking table ${tableName} in ${dbName}: ${error.message}`);
          return false;
        }
      };

      // Query GWAMA database
      let gwamaSnps = [];
      const gwamaTable = 'phewas_snp_data';
      if (await checkTable(gwamaDb, gwamaTable, 'GWAMA')) {
        try {
          gwamaSnps = await gwamaGet(`
            SELECT DISTINCT SNP_ID, chromosome, position
            FROM ${gwamaTable}
            LIMIT 100
          `);
          logger.info(`GWAMA SNPs found: ${gwamaSnps.length}`, gwamaSnps.slice(0, 5));
        } catch (error) {
          logger.error(`GWAMA query error: ${error.message}`);
        }
      } else {
        logger.warn(`Table ${gwamaTable} not found in GWAMA database`);
      }

      // Query MR-MEGA database
      let mrmegaSnps = [];
      const mrmegaTable = 'phewas_snp_data_mrmega';
      if (await checkTable(mrmegaDb, mrmegaTable, 'MR-MEGA')) {
        try {
          mrmegaSnps = await mrmegaGet(`
            SELECT DISTINCT SNP_ID, chromosome, position
            FROM ${mrmegaTable}
            LIMIT 100
          `);
          logger.info(`MR-MEGA SNPs found: ${mrmegaSnps.length}`, mrmegaSnps.slice(0, 5));
        } catch (error) {
          logger.error(`MR-MEGA query error: ${error.message}`);
        }
      } else {
        logger.warn(`Table ${mrmegaTable} not found in MR-MEGA database`);
      }

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
              if (rsId.toLowerCase().startsWith(searchTerm.toLowerCase())) {
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