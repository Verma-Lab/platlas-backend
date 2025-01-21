// File: src/controllers/gwasController.js
import { 
    getGWASMetadata as getGWASMetadataService, 
    queryGWASData as queryGWASDataService,
    getTopResults as getTopResultsService ,
    getLeadVariants as getLeadVariantsService
 } from '../services/gwasService.js';
 import { streamTabixData } from '../services/tabixService.js';
 import { error as _error } from '../utils/logger.js';
 
 export async function getGWASMetadata(req, res) {
    try {
        const metadata = await getGWASMetadataService();
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

export async function queryGWASData(req, res) {
    const { phenoId, cohortId, study } = req.query;
    if (!phenoId || !cohortId || !study) {
        return res.status(400).json({ error: 'phenoId, cohortId, and study are required parameters.' });
    }
    try {
        const data = await queryGWASDataService(phenoId, cohortId, study);

        // Check if the data is an array
        if (Array.isArray(data)) {
            console.log("Head of the data (first 5 rows):", data.slice(0, 5));  // Print first 5 rows
        } else if (typeof data === 'object' && data !== null) {
            // If it's an object, get the first 5 keys and print
            const headObject = Object.keys(data).slice(0, 5).reduce((obj, key) => {
                obj[key] = data[key];
                return obj;
            }, {});
            console.log("Head of the data (first 5 keys):");
        } else {
            console.log("Data is not an array or object:");
        }
        
        res.json(data);
    } catch (error) {
        _error(`Error in queryGWASData controller: ${error.message}`);
        res.status(500).json({ error: error.message });
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
        return res.status(400).json({ error: 'phenoId, cohortId, and study are required parameters.' });
    }
    try {
        const data = await getTopResultsService(cohortId, phenoId, study);
        res.json(data);
    } catch (error) {
        _error(`Error in getTopResults controller: ${error.message}`);
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