import { Router } from 'express';
const router = Router();
import { getRelatedPhenotypes } from '../controllers/phenotypeController.js';
import { loadPhenotypeMapping } from '../services/phenotypeService.js';
import { getSNPAnnotation } from '../services/phenotypeService.js';
router.get('/getRelatedPhenotypes', getRelatedPhenotypes);

router.get('/getPhenotypeMapping', async (req, res) => {
    try {
        const mapping = await loadPhenotypeMapping();
        res.json(mapping);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Add to your routes file (the one that contains router.get('/getPhenotypeMapping', ...))

router.get('/getSNPAnnotation', async (req, res) => {
    try {
        const { chromosome, position } = req.query;
        if (!chromosome || !position) {
            return res.status(400).json({ error: 'Chromosome and position are required' });
        }
        
        const annotation = await getSNPAnnotation(chromosome, position);
        res.json(annotation || { error: 'SNP not found' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;