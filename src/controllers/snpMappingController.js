// src/controllers/snpMappingController.js
import { snpMappingService } from '../services/snpMappingService.js';
import logger from '../utils/logger.js';

export const searchSNPs = async (req, res) => {
  const { term } = req.query;

  if (!term) {
    return res.status(400).json({
      error: 'Search term is required',
    });
  }

  try {
    const { results } = await snpMappingService.searchSNPs(term);

    res.json({
      results,
      hasMore: results.length >= 50,
      count: results.length,
    });
  } catch (error) {
    logger.error('Error in searchSNPs:', error);
    res.status(500).json({
      error: 'Failed to search SNPs',
      details: error.message,
    });
  }
};