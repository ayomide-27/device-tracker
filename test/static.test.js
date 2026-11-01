import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';
import { splitRoute } from '../private/js/map/route.js';
import { shouldRecord } from '../public/js/device/tracker.js';
import { metresBetween } from '../public/js/shared/geo.js';

const p = (t, lat = 9, lng = 7) => ({ t, lat, lng });

test('route: continuous points make one solid line; a long silence makes a dashed gap', () => {
  assert.deepEqual(splitRoute([p(0), p(60_000), p(120_000)]).map((s) => s.dashed), [false]);
  const parts = splitRoute([p(0), p(60_000), p(60_000 + 10 * 60_000), p(60_000 + 11 * 60_000)]);
  assert.deepEqual(parts.map((s) => s.dashed), [false, true, false]);
  assert.equal(splitRoute([p(0)]).length, 0, 'one point is not a line');
  assert.equal(splitRoute([]).length, 0);
});

test('tracker recording rule: moves, stillness, clock going backwards', () => {
  const cfg = { MIN_SECONDS_BETWEEN_POINTS: 15, MIN_METRES_BETWEEN_POINTS: 10, STILL_POINT_EVERY_SECONDS: 60 };
  const last = { t: 0, lat: 9, lng: 7 };
  assert.equal(shouldRecord(null, last, cfg), true);
  assert.equal(shouldRecord(last, { t: 5_000, lat: 9.01, lng: 7 }, cfg), false, 'too soon');
  assert.equal(shouldRecord(last, { t: 20_000, lat: 9.001, lng: 7 }, cfg), true, 'moved ~111 m');
  assert.equal(shouldRecord(last, { t: 20_000, lat: 9.000001, lng: 7 }, cfg), false, 'did not move');
  assert.equal(shouldRecord(last, { t: 61_000, lat: 9, lng: 7 }, cfg), true, 'still but a minute passed');
  assert.equal(shouldRecord(last, { t: -1000, lat: 9.5, lng: 7 }, cfg), false, 'time went backwards');
});

test('geo: distance matches the database formula closely (0.001 degree of latitude is about 111 m)', () => {
  const d = metresBetween({ lat: 9, lng: 7 }, { lat: 9.001, lng: 7 });
  assert.ok(d > 110 && d < 112, String(d));
});

test('service worker caches every phone-page file, and only those', async () => {
  const sw = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const listed = [...sw.matchAll(/^\s+'(\/[^']+)',$/gm)].map((m) => m[1]);
  for (const file of listed) await access(new URL(`../public${file}`, import.meta.url));

  const device = await readdir(new URL('../public/js/device', import.meta.url));
  for (const f of device) assert.ok(listed.includes(`/js/device/${f}`), `${f} missing from the service worker list`);
  // shared files the phone imports
  const imports = (await Promise.all(device.map((f) => readFile(new URL(`../public/js/device/${f}`, import.meta.url), 'utf8')))).join('\n');
  for (const m of imports.matchAll(/from '\.\.\/shared\/([\w.]+)'/g)) assert.ok(listed.includes(`/js/shared/${m[1]}`), `${m[1]} not cached`);
});
