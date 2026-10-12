// db.js — every database operation lives in this file.
//
// Two ways to run:
//   1. DATABASE_URL is set  -> real Postgres (e.g. Neon). Data is durable. Use this on Render.
//   2. DATABASE_URL not set -> a small built-in Postgres (PGlite) saved in ./data/pgdata.
//      Zero setup, good for your laptop. On Render's free plan this folder is wiped on every
//      restart, so route history is TEMPORARY in this mode.
// Both speak the same SQL, so the rest of the app doesn't care which one is in use.

const fs = require('fs');
const path = require('path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  device_id   text PRIMARY KEY,
  label       text NOT NULL,
  last_seen   timestamptz NOT NULL DEFAULT now(),  -- last time the device contacted the server
  last_lat    double precision,                    -- latest known position
  last_lng    double precision,
  last_fix_at timestamptz                          -- when that position was taken by the phone's GPS
);

CREATE TABLE IF NOT EXISTS locations (
  device_id   text NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL,                -- when the phone's GPS took the reading
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  accuracy    real,                                -- metres
  PRIMARY KEY (device_id, recorded_at)             -- also makes re-uploads harmless (no duplicates)
);

CREATE INDEX IF NOT EXISTS locations_recorded_at_idx ON locations (recorded_at);
`;

async function openDatabase() {
  const url = process.env.DATABASE_URL;

  if (url) {
    const { Pool } = require('pg');
    const mode = process.env.DATABASE_SSL; // 'off' | 'no-verify' | (unset = verify, the safe default)
    const ssl = mode === 'off' ? false : { rejectUnauthorized: mode !== 'no-verify' };
    const pool = new Pool({ connectionString: url, ssl, max: 5, connectionTimeoutMillis: 10000 });
    await pool.query('SELECT 1'); // fail now, with a clear error, if the URL is wrong
    await pool.query(SCHEMA);
    return {
      kind: 'postgres',
      durable: true,
      query: async (sql, params) => (await pool.query(sql, params)).rows,
      close: () => pool.end(),
    };
  }

  // The built-in test database needs ~500-700 MB of memory. Hosts like Render's free plan
  // allow 512 MB, so loading it there crashes the server. Refuse, and say what to do.
  if (process.env.RENDER) {
    throw new Error(
      'DATABASE_URL is not set. On Render: open your service > Environment > add DATABASE_URL ' +
      '(your Neon connection string), then redeploy.'
    );
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.LOCAL_DB_DIR || path.join(__dirname, 'data', 'pgdata');
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  await db.exec(SCHEMA);
  return {
    kind: 'local-file',
    durable: false,
    query: async (sql, params) => (await db.query(sql, params)).rows,
    close: () => db.close(),
  };
}

const iso = (value) => (value ? new Date(value).toISOString() : null);

function createStore(db) {
  return {
    // Save a batch of points from one device. Safe to call twice with the same points.
    async saveBatch({ deviceId, label, points }) {
      // 1. Register the device (or update its name) and mark it as "seen just now".
      await db.query(
        `INSERT INTO devices (device_id, label, last_seen) VALUES ($1, $2, now())
         ON CONFLICT (device_id) DO UPDATE SET label = EXCLUDED.label, last_seen = now()`,
        [deviceId, label]
      );
      if (points.length === 0) return 0;

      // 2. Insert every point. ON CONFLICT DO NOTHING skips ones we already have.
      const params = [deviceId];
      const rows = points.map((p) => {
        const at = params.length;
        params.push(new Date(p.t).toISOString(), p.lat, p.lng, p.acc ?? null);
        return `($1, $${at + 1}, $${at + 2}, $${at + 3}, $${at + 4})`;
      });
      const inserted = await db.query(
        `INSERT INTO locations (device_id, recorded_at, lat, lng, accuracy)
         VALUES ${rows.join(', ')} ON CONFLICT DO NOTHING RETURNING 1`,
        params
      );

      // 3. Point the device's "latest position" at its newest stored reading.
      await db.query(
        `UPDATE devices d SET last_lat = l.lat, last_lng = l.lng, last_fix_at = l.recorded_at
         FROM (SELECT lat, lng, recorded_at FROM locations
               WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 1) l
         WHERE d.device_id = $1`,
        [deviceId]
      );
      return inserted.length;
    },

    async listDevices() {
      const rows = await db.query(
        `SELECT device_id, label, last_lat, last_lng, last_fix_at,
                EXTRACT(EPOCH FROM (now() - last_seen))::int AS age_seconds
         FROM devices ORDER BY label`
      );
      return rows.map((r) => ({
        deviceId: r.device_id,
        label: r.label,
        lat: r.last_lat,
        lng: r.last_lng,
        lastFixAt: iso(r.last_fix_at),
        ageSeconds: r.age_seconds,
      }));
    },

    // All points for one device between two moments, oldest first.
    async getRoute(deviceId, from, to, hardLimit = 50000) {
      const rows = await db.query(
        `SELECT recorded_at, lat, lng, accuracy FROM locations
         WHERE device_id = $1 AND recorded_at >= $2 AND recorded_at < $3
         ORDER BY recorded_at LIMIT $4`,
        [deviceId, from.toISOString(), to.toISOString(), hardLimit]
      );
      return rows.map((r) => ({
        t: new Date(r.recorded_at).getTime(),
        lat: r.lat,
        lng: r.lng,
        acc: r.accuracy,
      }));
    },

    async deleteDevice(deviceId) {
      const rows = await db.query('DELETE FROM devices WHERE device_id = $1 RETURNING 1', [deviceId]);
      return rows.length > 0;
    },

    // Delete readings older than N days, and devices that haven't been seen for N days.
    async purge(days) {
      const old = await db.query(
        'DELETE FROM locations WHERE recorded_at < now() - make_interval(days => $1::int) RETURNING 1',
        [days]
      );
      const gone = await db.query(
        'DELETE FROM devices WHERE last_seen < now() - make_interval(days => $1::int) RETURNING 1',
        [days]
      );
      return { points: old.length, devices: gone.length };
    },
  };
}

module.exports = { openDatabase, createStore };
