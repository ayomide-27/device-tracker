import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { createStores } from '../src/stores/index.js';
import { TEST_URL, requireTestDatabase, wipe } from './helpers.js';

const skip = requireTestDatabase();

test('migrations adopt an existing v2 database without touching its data', { skip }, async () => {
  const db = createDb(TEST_URL);
  try {
    await wipe(db);
    // The exact tables the deployed v2 server created, with data in them.
    await db.query(`
      CREATE TABLE devices (device_id text PRIMARY KEY, label text NOT NULL, last_seen timestamptz NOT NULL DEFAULT now(),
        last_lat double precision, last_lng double precision, last_fix_at timestamptz);
      CREATE TABLE locations (device_id text NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE, recorded_at timestamptz NOT NULL,
        lat double precision NOT NULL, lng double precision NOT NULL, accuracy real, PRIMARY KEY (device_id, recorded_at));
      CREATE INDEX locations_recorded_at_idx ON locations (recorded_at);
      INSERT INTO devices (device_id, label) VALUES ('device-v2-0001', 'Old FO');
      INSERT INTO locations VALUES ('device-v2-0001', now(), 9.07, 7.39, 12);`);

    assert.deepEqual(await migrate(db), ['001_devices_and_locations', '002_sites_plans_visits']);
    assert.deepEqual(await migrate(db), [], 'second run applies nothing');

    const stores = createStores(db, { timezone: 'Africa/Lagos' });
    const devices = await stores.devices.list();
    assert.equal(devices[0].label, 'Old FO');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM locations'))[0].n, 1);
  } finally {
    await db.close();
  }
});

test('two servers starting together do not collide', { skip }, async () => {
  const a = createDb(TEST_URL);
  const b = createDb(TEST_URL);
  try {
    await wipe(a);
    const [x, y] = await Promise.all([migrate(a), migrate(b)]);
    assert.equal(x.length + y.length, 2, 'each migration applied exactly once between them');
  } finally {
    await a.close();
    await b.close();
  }
});
