import { Router } from 'express';
import { RULES } from '../rules.js';
import { requireDeviceId } from '../domain/validate.js';
import { deviceAuth } from '../auth.js';

// Endpoints the field officers' phones call. No password; protected by the optional device code.
export function phoneRoutes({ config, tracking, planning, makeStores, db }) {
  const router = Router();
  const auth = deviceAuth(config);
  const { plans, calendar } = makeStores(db);

  router.get('/health', (req, res) => {
    res.json({
      ok: true,
      storage: 'durable',
      retentionDays: config.retentionDays,
      deviceKeyRequired: Boolean(config.deviceKey),
      dashboardProtected: Boolean(config.dashboardPassword),
    });
  });

  router.post('/locations', auth, async (req, res) => res.json(await tracking.recordLocations(req.body)));

  router.post('/checkins', auth, async (req, res) => res.json(await tracking.recordCheckin(req.body)));

  // This week's sites for one phone, plus the rule the phone needs to judge its own GPS quality.
  router.get('/my-plan', auth, async (req, res) => {
    const deviceId = requireDeviceId(req.query.deviceId);
    const weekStart = await calendar.weekStart();
    const sites = await plans.forDevice({ deviceId, weekStart });
    res.json({ weekStart, sites, rules: { visitAccuracyM: RULES.visitAccuracyM } });
  });

  return router;
}
