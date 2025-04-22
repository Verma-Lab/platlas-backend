import { snpMappingService } from '../services/snpMappingService.js';
import logger from '../utils/logger.js';

export const searchSNPs = async (req, res) => {
  const startTime = Date.now();
  const { term } = req.query;

  if (!term) {
    logger.warn('Search term missing in request');
    return res.status(400).json({
      error: 'Search term is required'
    });
  }

  try {
    const { results } = await snpMappingService.searchSNPs(term);
    const duration = Date.now() - startTime;

    logger.info(`Search for ${term} returned ${results.length} results in ${duration}ms`);

    res.json({
      results,
      hasMore: results.length >= 50,
      count: results.length
    });
  } catch (error) {
    logger.error('Error in searchSNPs:', error);
    res.status(500).json({
      error: 'Failed to search SNPs',
      details: error.message
    });
  }
};