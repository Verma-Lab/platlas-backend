// File: src/services/gwasService.js
import { promises as fs } from 'fs';
import { join } from 'path';
import { gunzipSync } from 'zlib';
import { promisify } from 'util';
import { exec } from 'child_process';
const execAsync = promisify(exec);
import { GWAS_FILES_PATH, TOP_HITS_PATH, BASE_PREFIX, LEAD_MRMEGA_PATH } from '../config/constants.js';
import { error as _error, warn } from '../utils/logger.js';
import { loadPhenotypeMapping } from './phenotypeService.js';  // Change to named import
import { parse } from 'csv-parse/sync';
import { createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import { createInterface } from 'readline';


const COLUMNS = {
  ID: 0,
  CHR: 1,
  POS: 2,
  REF: 3,
  ALT: 4,
  BETA: 5,
  SE: 6,
  P: 7,
  LOG10P: 8,
  SE_LDSC: 9,
  P_LDSC: 10,
  LOG10P_LDSC: 11,
  AAF: 12,
  AAF_CASE: 13,
  AAC: 14,
  AAC_CASE: 15,
  N: 16,
  N_CASE: 17,
  N_STUDY: 18,
  EFFECT: 19,
  P_HETERO: 20
};

function parseScientificNotation(value) {
  if (value === 'NA' || value === '') return null;
  return parseFloat(value);
}

function parseNA(value, parser = parseFloat) {
  if (value === 'NA' || value === '') return null;
  return parser(value);
}

async function fetchTabixData(chrom, filePath) {
  try {
    const { stdout } = await execAsync(`tabix ${filePath} ${chrom}`);
    return stdout.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const fields = line.split('\t');
        const pval = parseScientificNotation(fields[COLUMNS.P]);
        
        if (pval !== null) {
          return {
            id: fields[COLUMNS.ID].replace('#ID: ', ''),
            chr: parseInt(fields[COLUMNS.CHR]),
            pos: parseInt(fields[COLUMNS.POS]),
            ref: fields[COLUMNS.REF],
            alt: fields[COLUMNS.ALT],
            beta: parseFloat(fields[COLUMNS.BETA]),
            se: parseFloat(fields[COLUMNS.SE]),
            p: pval,
            log10p: parseFloat(fields[COLUMNS.LOG10P]),
            se_ldsc: parseNA(fields[COLUMNS.SE_LDSC]),
            p_ldsc: parseScientificNotation(fields[COLUMNS.P_LDSC]),
            log10p_ldsc: parseNA(fields[COLUMNS.LOG10P_LDSC]),
            aaf: parseNA(fields[COLUMNS.AAF]),
            aaf_case: parseNA(fields[COLUMNS.AAF_CASE]),
            aac: parseNA(fields[COLUMNS.AAC]),
            aac_case: parseNA(fields[COLUMNS.AAC_CASE]),
            n: parseNA(fields[COLUMNS.N], parseInt),
            n_case: parseNA(fields[COLUMNS.N_CASE], parseInt),
            n_study: parseInt(fields[COLUMNS.N_STUDY]),
            effect: fields[COLUMNS.EFFECT],
            p_hetero: parseNA(fields[COLUMNS.P_HETERO])
          };
        }
        return null;
      })
      .filter(result => result !== null);
  } catch (error) {
    if (error.message.includes('No regions in query')) {
      return [];
    }
    console.error(`Error in fetchTabixData for chromosome ${chrom}: ${error.message}`);
    throw error;
  }
}

/**
 * Checks if a GWAS file exists for the given phenoId, cohort, and study.
 * @param {string} phenoId - Phenotype ID
 * @param {string} cohort - Cohort ID (e.g., EUR, ALL)
 * @param {string} study - Study type (gwama or mrmega)
 * @returns {boolean} - True if the file exists, false otherwise
 */
export async function findFiles(phenoId, cohort, study) {
    const filename = `${phenoId}.${cohort}.${study}_pval_up_to_1e-05.gz`;
    const filePath = join(GWAS_FILES_PATH, filename);
    
    info(`Checking file path: ${filePath}`);
    
    try {
        await fs.access(filePath);
        info(`✓ File found: ${filename}`);
        return { exists: true, filename, path: filePath };
    } catch (err) {
        info(`✗ File not found: ${filename}`);
        return { exists: false, filename: null, error: err.message };
    }
}

// File: src/services/gwasService.js

export async function queryGWASData(phenoId, cohortId, study) {
    try {
        // Validate study parameter
        if (!['gwama', 'mrmega'].includes(study.toLowerCase())) {
            throw new Error('Invalid study type. Must be "gwama" or "mrmega".');
        }

        // Construct filename with study and pval_up_to_1e-05
        const gz_file = `${phenoId}.${cohortId}.${study}_pval_up_to_1e-05.gz`;
        const filePath = join(GWAS_FILES_PATH, gz_file);

        console.log(`Attempting to access file: ${filePath}`);

        // Verify file existence
        try {
            await fs.access(filePath);
            console.log('File found:', gz_file);
        } catch {
            throw new Error(`GWAS data file not found: ${gz_file}`);
        }

        // Verify tabix index
        const indexPath = `${filePath}.tbi`;
        try {
            await fs.access(indexPath);
            console.log('Index file found');
        } catch {
            throw new Error(`Tabix index not found for file: ${gz_file}`);
        }

        const results = {};
        const promises = [];

        // Process all chromosomes in parallel
        for (let chrom = 1; chrom <= 22; chrom++) {
            promises.push(
                fetchTabixData(chrom, filePath)
                    .then(chromData => {
                        if (chromData.length > 0) {
                            results[chrom] = chromData;
                        }
                    })
                    .catch(error => {
                        console.error(`Error processing chromosome ${chrom}: ${error.message}`);
                        results[chrom] = [];
                    })
            );
        }

        await Promise.all(promises);
        console.log(`Processed data for file: ${gz_file}`);
        console.log(`Found data for chromosomes: ${Object.keys(results).join(', ')}`);
        const totalRows = Object.values(results).reduce((accumulator, chromData) => {
            return accumulator + chromData.length;
        }, 0);
        console.log(`Total Data Rows: ${totalRows}`);
        return results;
    } catch (error) {
        console.error(`Error querying GWAS data: ${error.message}`);
        throw error;
    }
}

// export async function queryGWASData(phenoId, cohortId) {
//     try {
//       // Remove any "Phe_" prefix if it exists in the phenoId parameter
//     //   const pheno = phenoId.replace('Phe_', '');
      
//       // Construct filename matching your actual file pattern
//       const gz_file = `${phenoId}.${cohortId}.gwama_pval_up_to_1e-05.gz`;
//       const filePath = join(GWAS_FILES_PATH, gz_file);
  
//       console.log(`Attempting to access file: ${filePath}`);
  
//       // Verify file existence
//       try {
//         await fs.access(filePath);
//         console.log('File found:', gz_file);
//       } catch {
//         throw new Error(`GWAS data file not found: ${gz_file}`);
//       }
  
//       // Verify tabix index
//       const indexPath = `${filePath}.tbi`;
//       try {
//         await fs.access(indexPath);
//         console.log('Index file found');
//       } catch {
//         throw new Error(`Tabix index not found for file: ${gz_file}`);
//       }
// //   Phe_414.ALL.mrmega_pval_up_to_1e-05.gz
// //   Phe_414.ALL.gwama_pval_up_to_1e-05.gz
//       const results = {};
//       const promises = [];
  
//       // Process all chromosomes in parallel
//       for (let chrom = 1; chrom <= 22; chrom++) {
//         promises.push(
//           fetchTabixData(chrom, filePath)
//             .then(chromData => {
//               if (chromData.length > 0) {
//                 results[chrom] = chromData;
//               }
//             })
//             .catch(error => {
//               console.error(`Error processing chromosome ${chrom}: ${error.message}`);
//               results[chrom] = [];
//             })
//         );
//       }
  
//       await Promise.all(promises);
//       console.log(`Processed data for file: ${gz_file}`);
//       console.log(`Found data for chromosomes: ${Object.keys(results).join(', ')}`);
//     //   console.log(results)
//       const totalRows = Object.values(results).reduce((accumulator, chromData) => {
//         return accumulator + chromData.length;
//       }, 0);
//       console.log(`Total Data Rows: ${totalRows}`);
//       return results;
//     } catch (error) {
//       console.error(`Error querying GWAS data: ${error.message}`);
//       throw error;
//     }
//   }


function checkPvalThreshold(pval, threshold) {
    switch (threshold) {
        case '1e-06_to_0.0001':
            return true;
        case '0.0001':
            return pval <= 0.0001;
        case '0.1':
            return true;
        default:
            return pval <= parseFloat(threshold);
    }
}

export async function getGWASMetadata() {
    try {
        const phenoMapping = await loadPhenotypeMapping();
        const files = await fs.readdir(GWAS_FILES_PATH);
        const pattern = /Phe_([^.]+)\.([^.]+)\.gwama_pval_up_to_0\.1/;
        const metadata = [];

        for (const filename of files) {
            if (filename.endsWith('0.0001.gz')) {
                const match = filename.match(pattern);
                if (match) {
                    const [_, pheno_id, cohort_id] = match;
                    const filePath = join(GWAS_FILES_PATH, filename);
                    const fileContent = await fs.readFile(filePath);
                    const unzipped = gunzipSync(fileContent).toString();
                    const lines = unzipped.split('\n');
                    
                    // Get header and find sample index
                    const header = lines[0].split('\t');
                    const sampleIdx = header.indexOf('num_samples');
                    
                    // Track unique SNPs and sample count
                    const uniqueSnps = new Set();
                    let numSamples = null;

                    // Process each line after header
                    for (const line of lines.slice(1)) {
                        if (line.trim()) {
                            const fields = line.split('\t');
                            uniqueSnps.add(fields[0]);  // SNP_ID
                            if (numSamples === null && fields[sampleIdx]) {
                                numSamples = parseInt(fields[sampleIdx]);
                            }
                        }
                    }

                    metadata.push({
                        phenotype_id: pheno_id,
                        phenotype_name: phenoMapping[pheno_id] || '',
                        cohort: cohort_id,
                        num_snps: uniqueSnps.size,
                        num_samples: numSamples
                    });
                }
            }
        }
        
        return metadata;
    } catch (error) {
        error(`Error getting GWAS metadata: ${error.message}`);
        throw error;
    }
}


export async function getLeadVariants() {
    try {
        const content = await fs.readFile(LEAD_MRMEGA_PATH, 'utf-8');
        
        // Parse CSV with proper handling of quoted fields
        const records = parse(content, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });

        return records.map(record => ({
            trait: {
                name: record.Trait || '',
                description: record.Description || '',
                type: record['Trait Type'] || ''  // Added trait type
            },
            category: record.Category || '',
            cohort: record.Population || '',
            lead_snp: {
                count: parseInt(record.LEAD_SNP) || 0,
                rsid: record.rsID || '-',
                position: {
                    chromosome: record.Chromosome || '',
                    position: parseInt(record.Position) || 0,
                    from: parseInt(record.From) || 0,    // Added from position
                    to: parseInt(record.To) || 0         // Added to position
                },
                reference: record.Reference || '',       // Added reference allele
                alternate: record.Alternate || '',       // Added alternate allele
                log10p: parseFloat(record.Log10P) || 0
            },
            n_total: parseInt(record.N.replace(/[",]/g, '')),
            n_study: parseInt(record['N Study']) || 0,
            pop_manifest: record.pop_manifest || '',     // Added population manifest
            pop_gwas_page: record.pop_gwas_page || '',  // Added population GWAS page
            studies: record.studies || '',              // Added studies
            analysis: record.analysis || ''             // Added analysis
        }));

    } catch (error) {
        _error(`Error getting lead variants: ${error.message}`);
        throw error;
    }
}

// export async function queryGWASData(cohort, pheno) {
//     try {
//         const gz_file = `${BASE_PREFIX}AGR.${pheno}.${cohort}.GIA_pval_up_to_0.0001.gz`;
        
//         const filePath = join(GWAS_FILES_PATH, gz_file);

//         // Check if file exists
//         try {
//             await fs.access(filePath);
//         } catch {
//             throw new Error('GWAS data files not found');
//         }

//         const results = {};
//         for (let chrom = 1; chrom <= 22; chrom++) {
//             const chromData = await fetchTabixData(chrom, '0.0001', filePath);
//             if (chromData.length > 0) {
//                 results[chrom] = chromData;
//             }
//         }

//         return results;
//     } catch (error) {
//         _error(`Error querying GWAS data: ${error.message}`);
//         throw error;
//     }
// }

// export async function getTopResults(cohort, pheno) {
//     try {
//         const pval_threshold = '0.0001';
//         const topHitsFilename = `${BASE_PREFIX}AGR.${pheno}.${cohort}.GIA_pval_up_to_${pval_threshold}.gz_top_hits_top_hits.txt`;
        
//         // Try primary path first
//         let filePath = join(TOP_HITS_PATH, topHitsFilename);
//         try {
//             await fs.access(filePath);
//         } catch {
//             // Try fallback path
//             filePath = join(GWAS_FILES_PATH, topHitsFilename);
//             try {
//                 await fs.access(filePath);
//             } catch {
//                 throw new Error('Top hits file not found');
//             }
//         }

//         const content = await fs.readFile(filePath, 'utf-8');
//         const lines = content.split('\n');
//         if (lines.length === 0) {
//             throw new Error('Top hits file is empty');
//         }

//         const header = lines[0].split('\t');
//         const results = [];

//         for (const line of lines.slice(1)) {
//             if (line.trim()) {
//                 const fields = line.split('\t');
//                 try {
//                     results.push({
//                         SNP_ID: fields[header.indexOf('SNP_ID')],
//                         chrom: fields[header.indexOf('chrom')],
//                         pos: parseInt(fields[header.indexOf('pos')]),
//                         ref: fields[header.indexOf('ref')],
//                         alt: fields[header.indexOf('alt')],
//                         ea: fields[header.indexOf('ea')],
//                         af: fields[header.indexOf('af')] !== 'NA' ? 
//                             parseFloat(fields[header.indexOf('af')]) : null,
//                         pval: fields[header.indexOf('pval')] !== 'NA' ? 
//                             parseFloat(fields[header.indexOf('pval')]) : null,
//                         or: fields[header.indexOf('or')] !== 'NA' ? 
//                             parseFloat(fields[header.indexOf('or')]) : null,
//                         ci: fields[header.indexOf('ci')]
//                     });
//                 } catch (e) {
//                     warn(`Error processing row: ${e.message}`);
//                 }
//             }
//         }

//         return results;
//     } catch (error) {
//         _error(`Error getting top results: ${error.message}`);
//         throw error;
//     }
// }


// export async function getGWASMetadata() {
//     try {
//         const phenoMapping = await loadPhenotypeMapping();
//         const files = await fs.readdir(GWAS_FILES_PATH);
//         const pattern = /Phe_([^.]+)\.([^.]+)\.gwama_pval_up_to_0\.1/;
//         const metadata = [];

//         for (const filename of files) {
//             if (filename.endsWith('gwama_pval_up_to_0.1.gz')) {
//                 const match = filename.match(pattern);
//                 if (match) {
//                     const [_, pheno_id, cohort_id] = match;
//                     const filePath = join(GWAS_FILES_PATH, filename);
//                     const fileContent = await fs.readFile(filePath);
//                     const unzipped = gunzipSync(fileContent).toString();
//                     const lines = unzipped.split('\n');
                    
//                     // Get header and first data line for sample size
//                     const header = lines[0].split('\t');
//                     const uniqueSnps = new Set();
//                     let numSamples = null;

//                     // Process each line after header
//                     for (const line of lines.slice(1)) {
//                         if (line.trim()) {
//                             const fields = line.split('\t');
//                             uniqueSnps.add(fields[0]);  // ID is first column
//                             if (numSamples === null && fields[16]) {  // N is at index 16
//                                 numSamples = parseInt(fields[16]);
//                             }
//                         }
//                     }

//                     metadata.push({
//                         phenotype_id: pheno_id,
//                         phenotype_name: phenoMapping[pheno_id] || '',
//                         cohort: cohort_id,
//                         num_snps: uniqueSnps.size,
//                         num_samples: numSamples
//                     });
//                 }
//             }
//         }
//         console.log('META')
//         console.log(metadata)
//         return metadata;
//     } catch (error) {
//         error(`Error getting GWAS metadata: ${error.message}`);
//         throw error;
//     }
// }

// File: src/services/gwasService.js

export async function getTopResults(cohortId, phenoId, study) {
    try {

        const gz_file = `${phenoId}.${cohortId}.${study}_pval_up_to_1e-05.gz`;
        const filePath = join(GWAS_FILES_PATH, gz_file);
        
        const results = [];
        const fileStream = createReadStream(filePath);
        const gunzip = createGunzip();
        const rl = createInterface({
            input: fileStream.pipe(gunzip),
            crlfDelay: Infinity
        });

        let isFirstLine = true;
        let headers = [];

        for await (const line of rl) {
            if (isFirstLine) {
                headers = line.trim().split(/\s+/);
                isFirstLine = false;
                continue;
            }

            if (line.trim()) {
                const fields = line.trim().split(/\s+/);
                try {
                    const row = {};
                    headers.forEach((header, index) => {
                        const value = fields[index];
                        if (value === 'NA') {
                            row[header] = null;
                        } else if (['POS', 'N_STUDY', 'N_CASE'].includes(header)) {
                            row[header] = parseInt(value);
                        } else if (['BETA', 'SE', 'P', 'LOG10P', 'AAF', 'AAF_CASE'].includes(header)) {
                            row[header] = parseFloat(value);
                        } else {
                            row[header] = value;
                        }
                    });
                    results.push(row);
                } catch (e) {
                    console.warn(`Error processing row: ${e.message}`);
                }
            }
        }
        // console.log(results)
        return results;
    } catch (error) {
        console.error(`Error getting top results: ${error.message}`);
        throw error;
    }
}

