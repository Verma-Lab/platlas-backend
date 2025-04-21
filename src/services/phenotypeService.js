// File: src/services/phenotypeService.js
import { promises as fs } from 'fs';
import { parse } from 'csv-parse/sync';
import { MANIFEST_PATH, GWAS_FILES_PATH, COMBINED_SNP_INFO } from '../config/constants.js';
import { error } from '../utils/logger.js';

import { createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import readline from 'readline';
import { SNP_MAPPING } from '../config/constants.js';

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { SNP_ANNOTATION_DB } from '../config/constants.js';

// function parseNumberWithCommas(str) {
//     if (!str || str === '-') return 0;
//     return parseInt(str.replace(/,/g, '')) || 0;
// }
// // New function to get phenotype stats
// export async function getPhenotypeStats(phenoId) {
//     try {
//         if (!phenoId || typeof phenoId !== 'string') {
//             throw new Error(`Invalid phenotype ID: ${phenoId}`);
//         }

//         const fileContent = await fs.readFile(MANIFEST_PATH, 'utf-8');
        
//         // Parse CSV with header
//         const records = parse(fileContent, {
//             columns: true,
//             skip_empty_lines: true,
//             trim: true
//         });

//         // Filter records for the specific phenotype
//         const phenoRecords = records.filter(record => record.Trait.trim() === phenoId.trim());
        
//         console.log(`Found ${phenoRecords.length} records for phenotype ${phenoId}`);

//         if (phenoRecords.length === 0) {
//             throw new Error(`No data found for phenotype: ${phenoId}`);
//         }

//         // Get populations for this phenotype
//         const populations = phenoRecords[0].Population.split(',').map(pop => pop.trim());

//         // Initialize stats object
//         const stats = {
//             snps_by_cohort: {},
//             samples_by_cohort: {}
//         };

//         // For each population, create entries in stats
//         populations.forEach(pop => {
//             stats.snps_by_cohort[pop] = parseNumberWithCommas(phenoRecords[0]['N SNP']);
//             stats.samples_by_cohort[pop] = parseNumberWithCommas(phenoRecords[0]['N All']);
            
//             // If it's a binary trait, also add case numbers
//             if (phenoRecords[0]['Trait type'] === 'Binary') {
//                 const nCases = parseNumberWithCommas(phenoRecords[0]['N Cases']);
//                 stats.samples_by_cohort[pop] = nCases;
//             }
//         });

//         return {
//             phenotype_id: phenoId,
//             trait_description: phenoRecords[0].Description,
//             category: phenoRecords[0].Category,
//             trait_type: phenoRecords[0]['Trait type'],
//             stats: stats
//         };

//     } catch (err) {
//         console.error(`Error getting phenotype stats for ${phenoId}:`, err);
//         throw err;
//     }
// }
function parseNumberWithCommas(str) {
    if (!str || str === '-') return 0;
    return parseInt(str.replace(/,/g, '')) || 0;
}

export async function getSNPAnnotation(chromosome, position) {
    try {
      console.log(`Searching for nearest SNP to chromosome ${chromosome}, position ${position}`);
      const startTime = Date.now();
  
      if (!chromosome || !position) {
        throw new Error('Chromosome and position are required');
      }
  
      const positionInt = parseInt(position);
      if (isNaN(positionInt) || positionInt <= 0) {
        throw new Error('Position must be a positive integer');
      }
  
      // Open the database connection
      const db = await open({
        filename: SNP_ANNOTATION_DB,
        driver: sqlite3.Database
      });
  
      // Apply SQLite performance pragmas
      await db.exec(`
        PRAGMA cache_size = -20000;  -- 20MB cache
        PRAGMA journal_mode = WAL;   -- Write-Ahead Logging
        PRAGMA synchronous = NORMAL; -- Less strict syncing
        PRAGMA temp_store = MEMORY;  -- Store temp tables in memory
      `);
        
      console.log('we are here')
      // Find the nearest SNP, excluding the exact position
      const nearestSNP = await db.get(`
        SELECT a.*, ABS(p.min_pos - ?) AS distance
        FROM snp_positions p
        JOIN snp_annotations a ON p.id = a.rowid
        WHERE p.chromosome = ?
          AND p.min_pos >= ? - 100000
          AND p.min_pos <= ? + 100000
          AND p.min_pos != ?
        ORDER BY ABS(p.min_pos - ?)
        LIMIT 1
      `, [positionInt, chromosome, positionInt, positionInt, positionInt, positionInt]);
  
      const queryTime = Date.now() - startTime;
      console.log(`Query completed in ${queryTime}ms`);
  
      if (nearestSNP) {
        console.log(`Nearest SNP found at chromosome ${nearestSNP.chromosome}, position ${nearestSNP.position}, distance ${nearestSNP.distance}, gene ${nearestSNP.gene}, symbol ${nearestSNP.symbol}`);
        await db.close();
        return {
          queriedPosition: positionInt,
          chromosome: nearestSNP.chromosome,
          position: nearestSNP.position,
          rsid: nearestSNP.rsid,
          allele: nearestSNP.allele,
          gene: nearestSNP.gene,  // Ensembl Gene ID (e.g., ENSG00000223972)
          symbol: nearestSNP.symbol,  // Gene symbol (e.g., DDX11L1)
          feature_type: nearestSNP.feature_type,
          consequence: nearestSNP.consequence,
          distance: nearestSNP.distance,
          isExact: false
        };
      }
  
      console.log(`No nearby SNP found for chromosome ${chromosome}, position ${position}`);
      await db.close();
      return null;
  
    } catch (err) {
      console.error(`Error getting SNP annotation: ${err.message}`);
      throw err;
    }
}

export async function getPhenotypeStats(phenoId) {
    try {
        if (!phenoId || typeof phenoId !== 'string') {
            throw new Error(`Invalid phenotype ID: ${phenoId}`);
        }

        // Read and parse the combined SNP info file
        const snpFileContent = await fs.readFile(COMBINED_SNP_INFO, 'utf-8');
        const snpRecords = parse(snpFileContent, {
            columns: ['phenotype', 'cohort', 'analysis_type', 'snp_number'],
            skip_empty_lines: true,
            delimiter: ',',
            trim: true
        });

        // Filter records for the specific phenotype
        const phenoSnpRecords = snpRecords.filter(record => 
            record.phenotype.trim() === phenoId.trim()
        );

        // Read the manifest file for other metadata
        const manifestContent = await fs.readFile(MANIFEST_PATH, 'utf-8');
        const manifestRecords = parse(manifestContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });

        const phenoManifestRecords = manifestRecords.filter(record => 
            record.Trait.trim() === phenoId.trim()
        );

        if (phenoManifestRecords.length === 0) {
            throw new Error(`No manifest data found for phenotype: ${phenoId}`);
        }

        // Initialize stats object
        const stats = {
            snps_by_cohort: {},
            samples_by_cohort: {}
        };

        // Group SNP records by analysis type and cohort
        phenoSnpRecords.forEach(record => {
            if (record.analysis_type === 'mrmega') {
                stats.snps_by_cohort['ALL'] = parseInt(record.snp_number) || 0;
            } else if (record.analysis_type === 'gwama') {
                stats.snps_by_cohort[record.cohort] = parseInt(record.snp_number) || 0;
            }
        });

        // Add sample counts from manifest
        const populations = phenoManifestRecords[0].Population.split(',').map(pop => pop.trim());
        populations.forEach(pop => {
            stats.samples_by_cohort[pop] = parseNumberWithCommas(phenoManifestRecords[0]['N All']);
            
            if (phenoManifestRecords[0]['Trait type'] === 'Binary') {
                const nCases = parseNumberWithCommas(phenoManifestRecords[0]['N Cases']);
                stats.samples_by_cohort[pop] = nCases;
            }
        });

        console.log('Stats for phenotype:', phenoId, stats); // Debug log

        return {
            phenotype_id: phenoId,
            trait_description: phenoManifestRecords[0].Description,
            category: phenoManifestRecords[0].Category,
            trait_type: phenoManifestRecords[0]['Trait type'],
            stats: stats
        };

    } catch (err) {
        console.error(`Error getting phenotype stats for ${phenoId}:`, err);
        throw err;
    }
}
// Helper function to parse a CSV line properly handling quoted fields
function parseCSVLine(line) {
    const entries = [];
    let entry = '';
    let withinQuotes = false;
    
    for (let char of line) {
        if (char === '"') {
            withinQuotes = !withinQuotes;
        } else if (char === ',' && !withinQuotes) {
            entries.push(entry.trim());
            entry = '';
        } else {
            entry += char;
        }
    }
    entries.push(entry.trim());
    return entries;
}

export async function loadPhenotypeMapping() {
    try {
        const fileContent = await fs.readFile(MANIFEST_PATH, 'utf-8');
        const lines = fileContent.trim().split('\n');
        
        // Skip the header line
        const dataLines = lines.slice(1);
        
        const mapping = {};
        for (const line of dataLines) {
            if (line.trim()) {
                const fields = parseCSVLine(line);
                
                const phenotype = fields[0];
                const traitDescription = fields[1];
                const category = fields[2];
                const traitType = fields[4]; // Add this line to get the trait type
                const populations = fields[3].replace(/"/g, '').split(',').map(pop => pop.trim());
                const nAll = parseNumberWithCommas(fields[6]);
                const nCases = parseNumberWithCommas(fields[7]);
                const nSnp = parseNumberWithCommas(fields[11]);

                if (phenotype) {
                    mapping[phenotype] = {
                        traitDescription,
                        category,
                        populations,
                        traitType,
                        nAll,
                        nCases,
                        nSnp
                    };
                }
            }
        }

        console.log('Loaded mapping with keys:', Object.keys(mapping).length);
        return mapping;
    } catch (err) {
        console.error('Error loading phenotype mapping:', {
            error: err.message,
            stack: err.stack,
            path: MANIFEST_PATH
        });
        throw err;
    }
}


export async function getRelatedPhenotypes(currentPheno) {
    try {
        const phenoMapping = await loadPhenotypeMapping();
        const files = await fs.readdir(GWAS_FILES_PATH);
        
        const phenotypes = files
            .filter(file => file.endsWith('0.0001.gz'))
            .map(file => {
                const match = file.match(/MVP_R4\.1000G_AGR\.([^.]+)\./);
                return match ? {
                    id: match[1],
                    description: phenoMapping[match[1]] || ''
                } : null;
            })
            .filter(p => p && p.id !== currentPheno);

        return [...new Map(phenotypes.map(p => [p.id, p])).values()]
            .sort((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
        error(`Error getting related phenotypes: ${err.message}`);
        throw err;
    }
}