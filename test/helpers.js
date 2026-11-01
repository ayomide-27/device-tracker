import { createDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { createApp } from '../src/http/app.js';
import { loadConfig } from '../src/config.js';

export const TEST_URL = process.env.TEST_DATABASE_URL;

// Integration tests wipe the whole database they connect to, so refuse anything not named "...test...".
export function requireTestDatabase() {
  if (!TEST_URL) return 'set TEST_DATABASE_URL to run database tests';
  if (!/test/i.test(new URL(TEST_URL).pathname)) return 'TEST_DATABASE_URL must point at a database with "test" in its name';
  return false;
}

export async function wipe(db) {
  await db.query('DROP SCHEMA public CASCADE');
  await db.query('CREATE SCHEMA public');
}

// A fresh database + running server on a random port. Returns helpers for calling it.
export async function startServer(overrides = {}) {
  const db = createDb(TEST_URL);
  await wipe(db);
  await migrate(db);
  const config = loadConfig({
    DATABASE_URL: TEST_URL,
    DASHBOARD_PASSWORD: 'dash-pass',
    DEVICE_KEY: 'phone-key',
    GOOGLE_MAPS_API_KEY: 'test-key',
    ...overrides,
  });
  const server = await new Promise((resolve) => {
    const s = createApp({ config, db }).listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const dashAuth = 'Basic ' + Buffer.from('boss:dash-pass').toString('base64');

  const call = async (method, path, { body, auth, key } = {}) => {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth === 'dash') headers.authorization = dashAuth;
    if (key) headers['x-device-key'] = key;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : type.startsWith('image/') ? Buffer.from(await res.arrayBuffer()) : await res.text();
    return { status: res.status, data, headers: res.headers };
  };

  return {
    db,
    config,
    base,
    phone: (method, path, body) => call(method, path, { body, key: 'phone-key' }),
    dash: (method, path, body) => call(method, path, { body, auth: 'dash' }),
    anon: (method, path, body) => call(method, path, { body }),
    close: async () => {
      await new Promise((r) => server.close(r));
      await db.close();
    },
  };
}

export const uuid = () => crypto.randomUUID();
export const DEVICE = 'device-aaaa-1111';
// A tiny but valid JPEG header + padding (the server only checks magic bytes and size).
export const tinyJpegBase64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]).toString('base64');
