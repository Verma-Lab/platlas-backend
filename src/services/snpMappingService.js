// src/services/snpMappingService.js
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import logger from '../utils/logger.js';
import { GWAMA_DB, MRMEGA_DB, SNP_ANNOTATION_DB } from '../config/constants.js';

class SNPMappingService {
  async searchSNPs(searchTerm) {
    let gwamaDb, mrmegaDb, annotationDb;
    try {
      // Normalize search term
      const term = searchTerm.toLowerCase().startsWith('rs') 
        ? searchTerm.slice(2) 
        : searchTerm;

      if (!term) {
        return { results: [] };
      }

      // Connect to databases
      gwamaDb = new sqlite3.Database(GWAMA_DB, sqlite3.OPEN_READONLY);
      mrmegaDb = new sqlite3.Database(MRMEGA_DB, sqlite3.OPEN_READONLY);
      annotationDb = new sqlite3.Database(SNP_ANNOTATION_DB, sqlite3.OPEN_READONLY);

      // Promisify database queries
      const gwamaGet = promisify(gwamaDb.all).bind(gwamaDb);
      const mrmegaGet = promisify(mrmegaDb.all).bind(mrmegaDb);
      const annotationGet = promisify(annotationDb.all).bind(annotationDb);

      // Query snp_annotations with correct column names
      const annotationQuery = `
        SELECT chromosome, position, rsid, symbol, consequence
        FROM snp_annotations
        WHERE rsid LIKE ?
        LIMIT 50
      `;
      const annotations = await annotationGet(annotationQuery, [`rs${term}%`]);

      if (!annotations.length) {
        logger.info(`No RSIDs found for term: rs${term}`);
        return { results: [] };
      }

      // Build WHERE clause for batch query
      const conditions = annotations.map(
        a => `(chromosome = ? AND position = ?)`
      ).join(' OR ');
      const params = annotations.flatMap(a => [a.chromosome, a.position]);

      // Query both databases for matching SNPs
      const query = `
        SELECT SNP_ID, chromosome, position, ref_allele, alt_allele
        FROM phewas_snp_data
        WHERE ${conditions}
        LIMIT 50
      `;

      const [gwamaResults, mrmegaResults] = await Promise.all([
        gwamaGet(query, params),
        mrmegaGet(query, params),
      ]);

      // Combine and deduplicate results
      const combinedResults = [...gwamaResults, ...mrmegaResults].reduce((acc, row) => {
        const key = `${row.chromosome}:${row.position}`;
        if (!acc[key] || row.SNP_ID.includes(':')) {
          acc[key] = row;
        }
        return acc;
      }, {});

      // Map to frontend format
      const results = annotations
        .map(a => {
          const key = `${a.chromosome}:${a.position}`;
          const row = combinedResults[key];
          if (!row) return null;
          return {
            type: 'snp',
            rsId: a.rsid,
            internalId: row.SNP_ID,
            chromosome: row.chromosome,
            position: parseInt(row.position),
            gene: a.symbol || 'unknown',
            consequence: a.consequence || 'unknown',
          };
        })
        .filter(Boolean)
        .slice(0, 50);

      logger.info(`Found ${results.length} RSIDs for term: rs${term}`);
      return { results };
    } catch (error) {
      logger.error('Error searching SNPs:', error);
      return { results: [] };
    } finally {
      gwamaDb?.close();
      mrmegaDb?.close();
      annotationDb?.close();
    }
  }
}

export const snpMappingService = new SNPMappingService();