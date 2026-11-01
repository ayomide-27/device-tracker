import { Router } from 'express';
import { NotFoundError, ValidationError } from '../errors.js';
import { isUuid } from '../domain/validate.js';
import { dashboardAuth } from '../auth.js';
import { sendCsv } from './csv.js';

const STATUS_LABEL = { verified: 'Verified', off_site: 'Off site', unplanned: 'Unplanned', not_visited: 'Not visited' };
const isoOrBlank = (t) => (t ? new Date(t).toISOString() : '');

// Everything the supervisor's dashboard calls. Every route here needs the dashboard password.
export function dashboardRoutes({ config, makeStores, db, review, planning }) {
  const router = Router();
  router.use(dashboardAuth(config));
  const { calendar, devices, sites } = makeStores(db);

  router.get('/config', async (req, res) => {
    res.json({
      googleMapsApiKey: config.googleMapsApiKey,
      googleMapId: config.googleMapId,
      timezone: config.timezone,
      today: await calendar.today(),
      weekStart: await calendar.weekStart(),
    });
  });

  // --- FOs ---
  router.get('/devices', async (req, res) => res.json({ devices: await review.devices() }));

  router.delete('/devices/:id', async (req, res) => {
    if (!config.dashboardPassword) throw new ValidationError('Set DASHBOARD_PASSWORD before removing devices');
    res.json({ ok: await devices.remove(req.params.id) });
  });

  router.get('/route', async (req, res) => res.json(await review.route(req.query)));

  // --- Sites ---
  router.get('/sites', async (req, res) => res.json({ sites: await sites.list() }));
  router.post('/sites', async (req, res) => res.status(201).json(await planning.addSite(req.body)));
  router.post('/sites/import', async (req, res) => res.json(await planning.importSites(req.body)));
  router.patch('/sites/:id', async (req, res) => res.json({ site: await planning.updateSite(req.params.id, req.body) }));
  router.delete('/sites/:id', async (req, res) => {
    await planning.archiveSite(req.params.id);
    res.json({ ok: true });
  });

  // --- Weekly plan and board ---
  router.put('/plan', async (req, res) => res.json(await planning.setPlan(req.body)));

  router.get('/plan/board', async (req, res) => res.json(await review.board(req.query)));

  router.get('/plan/board.csv', async (req, res) => {
    const board = await review.board(req.query);
    sendCsv(
      res,
      `visit-board-${board.weekStart}.csv`,
      ['Week starting', 'FO', 'Site', 'Status', 'Checked in at (UTC)', 'Distance from site (m)'],
      board.items.map((i) => [board.weekStart, i.deviceLabel, i.site.name, STATUS_LABEL[i.status], isoOrBlank(i.visit?.t), i.visit?.distanceM ?? ''])
    );
  });

  // --- Check-ins ---
  router.get('/visits', async (req, res) => res.json(await review.visits(req.query)));

  router.get('/visits.csv', async (req, res) => {
    const { date, days, visits } = await review.visits(req.query);
    sendCsv(
      res,
      `visits-${date}${days > 1 ? `-${days}d` : ''}.csv`,
      ['FO', 'Place', 'Status', 'Flags', 'Time (UTC)', 'GPS accuracy (m)', 'Distance from site (m)', 'Photo', 'Latitude', 'Longitude'],
      visits.map((v) => [v.deviceLabel, v.name, STATUS_LABEL[v.status], v.flags.join(' '), isoOrBlank(v.t), v.accuracyM === null ? '' : Math.round(v.accuracyM), v.distanceM ?? '', v.hasPhoto ? 'yes' : 'no', v.lat, v.lng])
    );
  });

  router.get('/visits/:id/photo', async (req, res) => {
    if (!isUuid(req.params.id)) throw new NotFoundError('No photo');
    const photo = await makeStores(db).visits.photo(req.params.id);
    if (!photo) throw new NotFoundError('No photo');
    // A photo is user-supplied data: never let the browser treat it as anything but an image.
    res.set({
      'Content-Type': photo.mime,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=3600',
    });
    res.send(photo.bytes);
  });

  return router;
}
