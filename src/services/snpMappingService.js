// src/services/snpMappingService.js
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import logger from '../utils/logger.js';
import { GWAMA_DB, MRMEGA_DB, SNP_ANNOTATION_DB } from '../config/constants.js';

class SNPMappingService {
  async searchSNPs(searchTerm) {
    try {
      // Normalize search term
      const term = searchTerm.toLowerCase().startsWith('rs') 
        ? searchTerm.slice(2) 
        : searchTerm;

      if (!term) {
        return { results: [] };
      }

      // Connect to databases
      const gwamaDb = new sqlite3.Database(GWAMA_DB, sqlite3.OPEN_READONLY);
      const mrmegaDb = new sqlite3.Database(MRMEGA_DB, sqlite3.OPEN_READONLY);
      const annotationDb = new sqlite3.Database(SNP_ANNOTATION_DB, sqlite3.OPEN_READONLY);

      // Promisify database queries
      const gwamaGet = promisify(gwamaDb.all).bind(gwamaDb);
      const mrmegaGet = promisify(mrmegaDb.all).bind(mrmegaDb);
      const annotationGet = promisify(annotationDb.all).bind(annotationDb);

      // Query snp_annotations for RSIDs
      const annotationQuery = `
        SELECT chromosome, position, rsID, gene_name, consequence
        FROM snp_annotations
        WHERE rsID LIKE ?
        LIMIT 50
      `;
      const annotations = await annotationGet(annotationQuery, [`rs${term}%`]);

      if (!annotations.length) {
        gwamaDb.close();
        mrmegaDb.close();
        annotationDb.close();
        return { results: [] };
      }

      // Extract chromosome and position pairs for querying phewas databases
      const positions = annotations.map(a => ({
        chromosome: a.chromosome,
        position: a.position,
      }));

      // Query both databases for matching SNPs
      const results = [];
      for (const { chromosome, position } of positions) {
        const query = `
          SELECT SNP_ID, chromosome, position, ref_allele, alt_allele
          FROM phewas_snp_data
          WHERE chromosome = ? AND position = ?
          LIMIT 1
        `;

        // Query both databases
        const [gwamaResults, mrmegaResults] = await Promise.all([
          gwamaGet(query, [chromosome, position]),
          mrmegaGet(query, [chromosome, position]),
        ]);

        // Combine results, preferring gwama if both exist
        const result = gwamaResults[0] || mrmegaResults[0];
        if (result) {
          const annotation = annotations.find(
            a => a.chromosome === result.chromosome && a.position === result.position
          );
          if (annotation) {
            results.push({
              type: 'snp',
              rsId: annotation.rsID,
              internalId: result.SNP_ID,
              chromosome: result.chromosome,
              position: parseInt(result.position),
              gene: annotation.gene_name || 'unknown',
              consequence: annotation.consequence || 'unknown',
            });
          }
        }
      }

      // Close database connections
      gwamaDb.close();
      mrmegaDb.close();
      annotationDb.close();

      return { results: results.slice(0, 50) };
    } catch (error) {
      logger.error('Error searching SNPs:', error);
      return { results: [] };
    }
  }
}

export const snpMappingService = new SNPMappingService();