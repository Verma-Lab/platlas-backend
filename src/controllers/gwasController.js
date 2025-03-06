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
//     const { phenoId, cohortId, study } = req.query;
//     if (!phenoId || !cohortId || !study) {
//         return res.status(400).json({ 
//             error: 'phenoId, cohortId, and study are required parameters.' 
//         });
//     }

//     try {
//         const result = await queryGWASDataService(phenoId, cohortId, study);
        
//         if (result.error) {
//             console.error('GWAS Data Error:', result.error);
//             return res.status(result.status).json({ error: result.error });
//         }

//         res.json(result.data);
//     } catch (error) {
//         console.error(`Error in queryGWASData controller: ${error.message}`);
//         res.status(500).json({ error: error.message });
//     }
// }
export async function queryGWASData(req, res) {
    const { phenoId, cohortId, study, minPval, maxPval } = req.query;
    if (!phenoId || !cohortId || !study) {
      return res.status(400).json({ 
        error: 'phenoId, cohortId, and study are required.' 
      });
    }
  
    try {
      // Parse p-value range (or pass null for auto-detection)
      const minPvalParsed = minPval ? parseFloat(minPval) : null;
      const maxPvalParsed = maxPval ? parseFloat(maxPval) : null;
      
      const result = await queryGWASDataService(
        phenoId, 
        cohortId, 
        study, 
        minPvalParsed, 
        maxPvalParsed
      );
      
      if (result.error) {
        return res.status(result.status).json({ 
          error: result.error,
          pValueRange: result.pValueRange // Include range even in error cases
        });
      }
  
      // Stream the response to handle large datasets
      res.setHeader('Content-Type', 'application/json');
      
      // Start the JSON object and include the p-value range
      res.write('{');
      
      // Always include the p-value range
      res.write(`"pValueRange":${JSON.stringify(result.pValueRange)},`);
      
      // Write the data object
      res.write('"data":{');
      
      let isFirstChrom = true;
      for (const [chrom, chromData] of Object.entries(result.data)) {
        if (chromData.length > 0) {
          if (!isFirstChrom) res.write(',');
          res.write(`"${chrom}":${JSON.stringify(chromData)}`);
          isFirstChrom = false;
        }
      }
      
      // Close objects
      res.write('}}');
      res.end();
      
    } catch (error) {
      console.error(`Error in queryGWASData controller: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  }

// export async function queryGWASData(req, res) {
//     try {
//         const { cohortId, phenoId } = req.query;
        
//         if (!cohortId || !phenoId) {
//             return res.status(400).json({
//                 error: "Cohort and phenotype IDs are required"
//             });
//         }

//         const results = await streamTabixData(phenoId, cohortId);

//         if (!Object.keys(results).length) {
//             return res.status(404).json({ error: "No data found" });
//         }

//         res.json(results);
//     } catch (error) {
//         _error(`Error in queryGWASData controller: ${error.message}`);
//         res.status(500).json({ error: error.message });
//     }
// }
 
// File: src/controllers/gwasController.js

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
// export async function getTopResults(req, res) {
//     const { phenoId, cohortId, study } = req.query;
//     if (!phenoId || !cohortId || !study) {
//         return res.status(400).json({ error: 'phenoId, cohortId, and study are required parameters.' });
//     }
//     try {
//         const data = await getTopResultsService(cohortId, phenoId, study);
//         res.json(data);
//     } catch (error) {
//         _error(`Error in getTopResults controller: ${error.message}`);
//         res.status(500).json({ error: error.message });
//     }
// }

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