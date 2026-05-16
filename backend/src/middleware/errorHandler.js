/**
 * Centralised error handler — keeps route handlers clean.
 * All errors thrown with next(err) land here.
 */
export function errorHandler(err, req, res, _next) {
  console.error(`[error] ${req.method} ${req.path}:`, err.message);

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: `File too large. Maximum size is ${process.env.MAX_FILE_SIZE_MB || 10}MB`,
    });
  }

  // Known operational errors
  if (err.message?.includes('Only PDF')) {
    return res.status(400).json({ error: err.message });
  }

  if (err.message?.includes('empty or image-only')) {
    return res.status(422).json({ error: err.message });
  }

  // OpenAI API errors
  if (err.status === 401) {
    return res.status(500).json({ error: 'Invalid OpenAI API key — check your .env file' });
  }

  if (err.status === 429) {
    return res.status(429).json({ error: 'OpenAI rate limit hit — try again in a moment' });
  }

  // Default 500
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(500).json({
    error: 'Something went wrong on the server',
    ...(isDev && { detail: err.message }),
  });
}
