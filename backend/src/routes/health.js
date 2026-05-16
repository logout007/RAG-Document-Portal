import express from 'express';
import supabase from '../utils/supabase.js';

const router = express.Router();

// GET /api/health
router.get('/', async (req, res) => {
  try {
    // Quick DB ping
    const { error } = await supabase.from('documents').select('id').limit(1);
    const dbStatus = error ? 'error' : 'ok';

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        openai: process.env.OPENAI_API_KEY ? 'configured' : 'missing',
      },
    });
  } catch {
    res.status(503).json({ status: 'error', timestamp: new Date().toISOString() });
  }
});

export default router;
