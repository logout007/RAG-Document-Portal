import express from 'express';
import { ragSearch } from '../services/search.js';

const router = express.Router();

// POST /api/search
router.post('/', async (req, res, next) => {
  try {
    const { query, documentId } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'query is required and must be a string' });
    }

    if (query.trim().length < 3) {
      return res.status(400).json({ error: 'Query must be at least 3 characters' });
    }

    if (query.length > 1000) {
      return res.status(400).json({ error: 'Query too long (max 1000 characters)' });
    }

    const result = await ragSearch(query.trim(), documentId || null);

    res.json({
      query,
      answer: result.answer,
      sources: result.sources,
      latencyMs: result.latencyMs,
      sourceCount: result.sources.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
