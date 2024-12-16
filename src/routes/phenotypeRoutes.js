import { Router } from 'express';
const router = Router();
import { getRelatedPhenotypes } from '../controllers/phenotypeController.js';
import { loadPhenotypeMapping } from '../services/phenotypeService.js';

router.get('/getRelatedPhenotypes', getRelatedPhenotypes);

router.get('/getPhenotypeMapping', async (req, res) => {
    try {
        const mapping = await loadPhenotypeMapping();
        res.json(mapping);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;