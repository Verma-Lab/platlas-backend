// File: src/controllers/gwasController.js
import { 
    queryGWASData as queryGWASDataService,
    getTopResults as getTopResultsService ,
    getLeadVariants as getLeadVariantsService, 
    getSearchableGWASMetadata, 
    getGWASStats
 } from '../services/gwasService.js';
 import { streamTabixData } from '../services/tabixService.js';
 import { error as _error } from '../utils/logger.js';
 
 export async function getGWASMetadata(req, res) {
    try {
        const metadata = await getSearchableGWASMetadata();
        res.json(metadata);
    } catch (error) {
        _error(`Error in getGWASMetadata controller: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
 }
 export async function getGWASStatsRoute(req, res) {
    try {
        const metadata = await getGWASStats();
        console.log('STATS')
        console.log(metadata)
        res.json(metadata);
    } catch (error) {
        _error(`Error in getGWASMetadata controller: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
 } 
 export async function findFiles(req, res) {
    const { phenoId, cohort, study } = req.query;
    if (!phenoId || !cohort || !study) {
        return res.status(400).json({ error: 'phenoId, cohort, and study are required parameters.' });
    }
    try {
        const result = await serviceFindFiles(phenoId, cohort, study);
        res.json(result);
    } catch (error) {
        _error(`Error in findFiles controller: ${error.message}`);
        res.status(500).json({ error: 'Internal server error.' });
    }
}

// export async function queryGWASData(req, res) {
//     const { phenoId, cohortId, study, minPval, maxPval } = req.query;
    
//     if (!phenoId || !cohortId || !study) {
//       return res.status(400).json({ 
//         error: 'phenoId, cohortId, and study are required parameters' 
//       });
//     }
  
//     try {
//       console.log(`Received GWAS data request for ${phenoId}, ${cohortId}, ${study}`);
//       console.log(`P-value range parameters: min=${minPval || 'not specified'}, max=${maxPval || 'not specified'}`);
      
//       // Parse p-value range (or pass null for auto-detection)
//     //   const minPvalParsed = minPval ? parseFloat(minPval) : null;
//     //   const maxPvalParsed = maxPval ? parseFloat(maxPval) : null;
      
//       // Call the service function
//       const result = await queryGWASDataService(
//         phenoId, 
//         cohortId, 
//         study, 
//         minPval,  
//         maxPval  
//       );
      
//       // Handle error cases
//       if (result.error) {
//         console.error(`GWAS data error: ${result.error}`);
//         return res.status(result.status).json({ 
//           error: result.error,
//           pValueRange: result.pValueRange // Include range even in error cases
//         });
//       }
  
//       // Count total data points for logging
//       const totalPoints = Object.values(result.data)
//         .reduce((sum, chromData) => sum + chromData.length, 0);
      
//       console.log(`Returning ${totalPoints} data points in p-value range: ${result.pValueRange.minPValue} to ${result.pValueRange.maxPValue}`);
      
//       // Stream the response to handle large datasets
//       res.setHeader('Content-Type', 'application/json');
      
//       // Start the JSON response
//       res.write('{');
      
//       // Always include the p-value range
//       res.write(`"pValueRange":${JSON.stringify(result.pValueRange)},`);
      
//       // Write the data object
//       res.write('"data":{');
      
//       // Stream each chromosome's data
//       let isFirstChrom = true;
//       for (const [chrom, chromData] of Object.entries(result.data)) {
//         if (chromData.length > 0) {
//           if (!isFirstChrom) res.write(',');
//           res.write(`"${chrom}":${JSON.stringify(chromData)}`);
//           isFirstChrom = false;
//         }
//       }
      
//       // Close the response objects
//       res.write('}}');
//       res.end();
      
//     } catch (error) {
//       console.error(`Error in queryGWASData controller: ${error.message}`);
//       if (!res.headersSent) {
//         res.status(500).json({ error: error.message });
//       }
//     }
//   }
export async function queryGWASData(phenoId, cohortId, study, minPval = null, maxPval = null) {
    try {
        if (!['gwama', 'mrmega'].includes(study.toLowerCase())) {
            return { error: 'Invalid study type.', status: 500 };
        }

        const gz_file = `${phenoId}.${cohortId}.${study}_pval_up_to_1e-05.gz`;
        const filePath = join(GWAS_FILES_PATH, gz_file);

        await fs.access(filePath);
        await fs.access(`${filePath}.tbi`);

        const results = {};
        const batchSize = 4; // Process 4 chromosomes at a time

        // Keep the original minPval/maxPval logic intact
        let effectiveMinPval;
        if (minPval !== null) {
            effectiveMinPval = minPval;
        } else {
            // Original adaptive default logic preserved
            if (globalMaxLog10p >= 400) {
                effectiveMinPval = 400;
            } else if (globalMaxLog10p >= 300) {
                effectiveMinPval = 300;
            } else if (globalMaxLog10p >= 200) {
                effectiveMinPval = 200;
            } else if (globalMaxLog10p >= 100) {
                effectiveMinPval = 100;
            } else if (globalMaxLog10p >= 20) {
                effectiveMinPval = 20;
            } else if (globalMaxLog10p >= 8) {
                effectiveMinPval = 8;
            } else {
                effectiveMinPval = 5;
            }
        }
        const effectiveMaxPval = maxPval !== null ? maxPval : Infinity;

        console.log(`Fetching data with -log10(p) range: ${effectiveMinPval} to ${effectiveMaxPval}`);

        // Batching logic with single-pass processing
        const promises = [];
        for (let chrom = 1; chrom <= 22; chrom++) {
            promises.push(
                fetchTabixData(chrom, filePath)
                    .then(chromData => {
                        // Filter directly in single pass (original filtering logic preserved)
                        const filteredData = chromData.filter(row => {
                            const log10p = Number(row.log10p) || 0;
                            return log10p >= effectiveMinPval && 
                                   (effectiveMaxPval === Infinity || log10p <= effectiveMaxPval);
                        });

                        if (filteredData.length > 0) {
                            console.log(`Chromosome ${chrom}: Found ${filteredData.length} rows with -log10(p) >= ${effectiveMinPval}`);
                            results[chrom] = filteredData;
                        }
                    })
                    .catch(error => {
                        console.error(`Error processing chromosome ${chrom}: ${error.message}`);
                        results[chrom] = [];
                    })
            );

            // Execute in batches
            if (promises.length === batchSize || chrom === 22) {
                await Promise.all(promises);
                promises.length = 0; // Clear for next batch
            }
        }

        const totalRows = Object.values(results).reduce((acc, chromData) => acc + chromData.length, 0);
        console.log(`Returning ${totalRows} data points with -log10(p) range: ${effectiveMinPval} to ${effectiveMaxPval}`);

        if (totalRows === 0) {
            return {
                error: 'No data found in the specified -log10(p) range',
                status: 404,
                pValueRange: {
                    maxLog10P: effectiveMaxPval,
                    minLog10P: effectiveMinPval
                }
            };
        }

        return {
            data: results,
            status: 200,
            pValueRange: {
                maxLog10P: effectiveMaxPval,
                minLog10P: effectiveMinPval
            }
        };
    } catch (error) {
        console.error(`Error querying GWAS data: ${error.message}`);
        return { error: error.message, status: 500 };
    }
}
export async function getTopResults(req, res) {
    const { phenoId, cohortId, study } = req.query;
    if (!phenoId || !cohortId || !study) {
        return res.status(400).json({ 
            error: 'phenoId, cohortId, and study are required parameters.' 
        });
    }

    try {
        const result = await getTopResultsService(cohortId, phenoId, study);
        
        if (result.error) {
            console.error('Top Results Error:', result.error);
            return res.status(result.status).json({ error: result.error });
        }

        res.json(result.data);
    } catch (error) {
        console.error(`Error in getTopResults controller: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

 export async function getLeadVariants(req, res) {
    try {
        const results = await getLeadVariantsService();
        // console.log(results)
        res.json(results);
    } catch (error) {
        _error(`Error in getLeadVariants controller: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}