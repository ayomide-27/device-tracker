const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { openDatabase, createStore } = require('./db');

// ---------- Settings (change with environment variables on Render) ----------
const PORT = process.env.PORT || 3000;
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS) || 90; // how long route history is kept
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || ''; // protects the map + all location data
const DEVICE_KEY = process.env.DEVICE_KEY || ''; // optional access code the phones must send

const ONLINE_WINDOW_SECONDS = 120; // no contact for 2 minutes -> shown as offline
const MAX_POINTS_PER_UPLOAD = 500;
const MAX_ROUTE_POINTS_SHOWN = 5000;
const MAX_ROUTE_RANGE_DAYS = 31;

// Two folders on purpose:
//   public/   pages anyone may open (the phone page, map library files)
//   private/  the dashboard, only served after the password check
const PUBLIC_DIR = path.join(__dirname, 'public');
const PRIVATE_DIR = path.join(__dirname, 'private');

let db;
let store;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});

// ---------- Small helpers ----------
function safeEqual(a, b) {
  // Compare via hashes so the check takes the same time whatever the input.
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Browser shows its own login box. Username is ignored; the password must match.
function dashboardAuth(req, res, next) {
  if (!DASHBOARD_PASSWORD) return next();
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const password = decoded.slice(decoded.indexOf(':') + 1);
    if (safeEqual(password, DASHBOARD_PASSWORD)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="FO Tracker dashboard"');
  res.status(401).send('Login required');
}

function deviceAuth(req, res, next) {
  if (!DEVICE_KEY) return next();
  if (safeEqual(req.get('x-device-key') || '', DEVICE_KEY)) return next();
  res.status(401).json({ error: 'Access code not accepted' });
}

function cleanLabel(value) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60);
  return text || 'Unnamed device';
}

// Keep only believable points. Bad ones are dropped (and counted), never stored.
function cleanPoints(raw) {
  const now = Date.now();
  const oldest = now - RETENTION_DAYS * 86400000;
  const good = [];
  let rejected = 0;
  for (const p of raw) {
    const ok =
      p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.t) &&
      p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180 &&
      p.t <= now + 5 * 60000 && p.t >= oldest;
    if (!ok) {
      rejected++;
      continue;
    }
    good.push({
      t: Math.round(p.t),
      lat: p.lat,
      lng: p.lng,
      acc: Number.isFinite(p.acc) && p.acc >= 0 ? Math.min(p.acc, 100000) : null,
    });
  }
  return { good, rejected };
}

function downsample(points, max) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

// ---------- API used by the phones (no password; protected by the optional device code) ----------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    storage: db.durable ? 'durable' : 'temporary',
    retentionDays: RETENTION_DAYS,
    deviceKeyRequired: Boolean(DEVICE_KEY),
    dashboardProtected: Boolean(DASHBOARD_PASSWORD),
  });
});

// A phone uploads one or more GPS readings. Readings carry the time the GPS took them,
// so points saved while offline still land at the right place in the route.
app.post('/api/locations', deviceAuth, async (req, res) => {
  const { deviceId, label, points } = req.body || {};
  if (typeof deviceId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) {
    return res.status(400).json({ error: 'Invalid deviceId' });
  }
  if (!Array.isArray(points) || points.length > MAX_POINTS_PER_UPLOAD) {
    return res.status(400).json({ error: `points must be a list of at most ${MAX_POINTS_PER_UPLOAD}` });
  }
  const { good, rejected } = cleanPoints(points);
  const saved = await store.saveBatch({ deviceId, label: cleanLabel(label), points: good });
  res.json({ ok: true, saved, rejected });
});

// ---------- API used by the dashboard (password protected) ----------
app.get('/api/devices', dashboardAuth, async (req, res) => {
  const devices = await store.listDevices();
  res.json({
    devices: devices.map((d) => ({ ...d, online: d.ageSeconds < ONLINE_WINDOW_SECONDS })),
  });
});

app.get('/api/route', dashboardAuth, async (req, res) => {
  const { deviceId } = req.query;
  const from = new Date(req.query.from);
  const to = new Date(req.query.to);
  if (typeof deviceId !== 'string' || Number.isNaN(+from) || Number.isNaN(+to) || from >= to) {
    return res.status(400).json({ error: 'Need deviceId, from and to (ISO dates, from before to)' });
  }
  if (to - from > MAX_ROUTE_RANGE_DAYS * 86400000) {
    return res.status(400).json({ error: `Range too long (max ${MAX_ROUTE_RANGE_DAYS} days)` });
  }
  const all = await store.getRoute(deviceId, from, to);
  const points = downsample(all, MAX_ROUTE_POINTS_SHOWN);
  res.json({ deviceId, total: all.length, shown: points.length, points });
});

app.delete('/api/devices/:id', dashboardAuth, async (req, res) => {
  if (!DASHBOARD_PASSWORD) {
    return res.status(403).json({ error: 'Set DASHBOARD_PASSWORD before removing devices' });
  }
  res.json({ ok: await store.deleteDevice(req.params.id) });
});

// ---------- Pages ----------
app.get(['/', '/index.html'], dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(PRIVATE_DIR, 'dashboard.html'));
});
app.get('/device', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'device.html')));
app.use(express.static(PUBLIC_DIR, { index: false }));

// ---------- Errors ----------
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status < 500) return res.status(status).json({ error: 'Bad request' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// ---------- Start ----------
async function main() {
  db = await openDatabase();
  store = createStore(db);

  const runPurge = async () => {
    try {
      const r = await store.purge(RETENTION_DAYS);
      if (r.points || r.devices) console.log(`Purged ${r.points} old points, ${r.devices} idle devices`);
    } catch (err) {
      console.error('Purge failed:', err.message);
    }
  };
  await runPurge();
  setInterval(runPurge, 6 * 3600 * 1000).unref();

  const server = app.listen(PORT, () => {
    console.log(`Tracker running on port ${PORT}`);
    console.log(`Storage: ${db.kind} (${db.durable ? 'durable' : 'TEMPORARY - set DATABASE_URL'})`);
    console.log(`History kept for ${RETENTION_DAYS} days`);
    if (!DASHBOARD_PASSWORD) console.log('WARNING: DASHBOARD_PASSWORD not set - anyone with the link can see locations');
  });

  const shutdown = () => {
    server.close(async () => {
      await Promise.resolve(db.close()).catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Could not start:', err.message);
  process.exit(1);
});
