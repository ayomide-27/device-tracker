import { NotFoundError, ValidationError } from '../errors.js';

// Turns anything thrown in a route into a JSON response. Details are logged, never leaked.
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
  if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });

  // Postgres: class 22 = bad data (e.g. impossible date), class 23 = broken reference (e.g. unknown site).
  if (typeof err.code === 'string' && /^2[23]/.test(err.code)) {
    return res.status(400).json({ error: 'Some of the data sent is not valid' });
  }
  // Body parser problems: bad JSON, too large.
  if (err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.type === 'entity.too.large' ? 'Upload too large' : 'Bad request' });
  }

  console.error(err);
  res.status(500).json({ error: 'Server error' });
}
