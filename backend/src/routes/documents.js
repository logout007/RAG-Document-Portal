import express from 'express';
import multer from 'multer';
import { ingestPdf } from '../services/ingestion.js';
import supabase from '../utils/supabase.js';

const router = express.Router();

const MAX_MB = parseInt(process.env.MAX_FILE_SIZE_MB) || 10;

// Multer — memory storage (no disk writes in production)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are accepted'));
    }
    cb(null, true);
  },
});

// POST /api/documents/upload
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { documentId, chunkCount, pageCount } = await ingestPdf(
      req.file.buffer,
      req.file.originalname,
      req.file.size
    );

    res.status(201).json({
      success: true,
      document: { id: documentId, filename: req.file.originalname, chunkCount, pageCount },
      message: `Document processed: ${chunkCount} chunks created from ${pageCount} pages`,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/documents
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('id, filename, file_size, page_count, chunk_count, status, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw new Error(error.message);

    res.json({ documents: data });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/documents/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('id', req.params.id);

    if (error) throw new Error(error.message);

    res.json({ success: true, message: 'Document and all its chunks deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
