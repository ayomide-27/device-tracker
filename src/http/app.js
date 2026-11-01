import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dashboardAuth } from '../auth.js';
import { createStores } from '../stores/index.js';
import { createTrackingService } from '../services/tracking.js';
import { createPlanningService } from '../services/planning.js';
import { createReviewService } from '../services/review.js';
import { phoneRoutes } from './phoneRoutes.js';
import { dashboardRoutes } from './dashboardRoutes.js';
import { errorHandler } from './errors.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Two folders on purpose: public/ is open to anyone (phone page), private/ only after the password.
const PUBLIC_DIR = path.join(ROOT, 'public');
const PRIVATE_DIR = path.join(ROOT, 'private');

export function createApp({ config, db }) {
  const makeStores = (executor) => createStores(executor, { timezone: config.timezone });
  const deps = { config, db, makeStores };
  deps.tracking = createTrackingService(deps);
  deps.planning = createPlanningService(deps);
  deps.review = createReviewService(deps);

  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });

  // Check-ins may carry a photo, so they get a bigger body limit than everything else.
  app.use('/api/checkins', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '256kb' }));

  // Phone routes first (open), dashboard routes after (password). Both live under /api.
  app.use('/api', phoneRoutes(deps));
  app.use('/api', dashboardRoutes(deps));

  const requireLogin = dashboardAuth(config);
  app.get('/', requireLogin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(PRIVATE_DIR, 'index.html'));
  });
  app.get('/index.html', (req, res) => res.redirect('/'));
  app.use('/dash', requireLogin, express.static(PRIVATE_DIR, { index: false }));

  app.get('/device', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'device.html')));
  app.use(express.static(PUBLIC_DIR, { index: false }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);
  return app;
}
