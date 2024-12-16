// File: src/controllers/phewasController.js
import { getPhewasData as getPhewasDataService } from '../services/phewasService.js';
import { error as _error } from '../utils/logger.js';

// File: src/controllers/phewasController.js
export async function getPhewasData(req, res) {
    try {
        const { snp, chromosome, position, study } = req.query;
        
        if (!snp || !chromosome || !position || !study) {
            return res.status(400).json({
                error: 'Missing required parameters: snp, chromosome, position, and study are required'
            });
        }

        const data = await getPhewasDataService(snp, chromosome, position, study);
        res.json(data);
    } catch (error) {
        res.status(500).json({
            error: 'Error fetching PheWAS data',
            details: error.message
        });
    }
}