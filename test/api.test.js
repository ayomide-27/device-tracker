import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE, requireTestDatabase, startServer, tinyJpegBase64, uuid } from './helpers.js';

const skip = requireTestDatabase();
let s;
before(async () => { if (!skip) s = await startServer(); });
after(async () => { if (s) await s.close(); });

const WUSE = { name: 'Wuse Market', lat: 9.0765, lng: 7.3986 };
const nowMs = () => Date.now();
const point = (offsetS, lat = WUSE.lat, lng = WUSE.lng, acc = 10) => ({ t: nowMs() - offsetS * 1000, lat, lng, acc });

test('health is open; phone endpoints need the device key', { skip }, async () => {
  const h = await s.anon('GET', '/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.data.deviceKeyRequired, true);
  assert.equal(h.data.dashboardProtected, true);
  assert.equal((await s.anon('POST', '/api/locations', { deviceId: DEVICE, points: [] })).status, 401);
  assert.equal((await s.anon('GET', `/api/my-plan?deviceId=${DEVICE}`)).status, 401);
});

test('dashboard endpoints and pages need the password', { skip }, async () => {
  for (const path of ['/api/devices', '/api/sites', '/api/visits', '/api/config', '/api/plan/board', '/', '/dash/js/main.js']) {
    assert.equal((await s.anon('GET', path)).status, 401, path);
  }
  assert.equal((await s.phone('GET', '/api/devices')).status, 401, 'device key must not open the dashboard');
  assert.equal((await s.dash('GET', '/api/devices')).status, 200);
});

test('locations: saves, is idempotent, rejects junk, shows on devices and route', { skip }, async () => {
  const points = [point(300), point(200), point(100)];
  const first = await s.phone('POST', '/api/locations', { deviceId: DEVICE, label: 'FO Ada', points: [...points, { t: 1, lat: 999, lng: 0 }] });
  assert.deepEqual([first.status, first.data.saved, first.data.rejected], [200, 3, 1]);
  const again = await s.phone('POST', '/api/locations', { deviceId: DEVICE, label: 'FO Ada', points });
  assert.equal(again.data.saved, 0, 're-upload must not duplicate');

  const { data } = await s.dash('GET', '/api/devices');
  assert.equal(data.devices.length, 1);
  assert.equal(data.devices[0].label, 'FO Ada');
  assert.equal(data.devices[0].online, true);
  assert.equal(data.devices[0].lat, WUSE.lat);

  const route = await s.dash('GET', `/api/route?deviceId=${DEVICE}&days=2`);
  assert.equal(route.status, 200);
  assert.equal(route.data.total, 3);
  assert.ok(route.data.points[0].t < route.data.points[2].t);

  assert.equal((await s.phone('POST', '/api/locations', { deviceId: 'x', points: [] })).status, 400);
  assert.equal((await s.phone('POST', '/api/locations', { deviceId: DEVICE, points: 'nope' })).status, 400);
  assert.equal((await s.dash('GET', `/api/route?deviceId=${DEVICE}&date=2026-02-31`)).status, 400);
  assert.equal((await s.dash('GET', `/api/route?deviceId=${DEVICE}&days=99`)).status, 400);
});

test('config gives the dashboard its map key and server-side dates', { skip }, async () => {
  const { data } = await s.dash('GET', '/api/config');
  assert.equal(data.googleMapsApiKey, 'test-key');
  assert.match(data.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(data.weekStart + 'T00:00:00Z').getUTCDay(), 1, 'week starts on Monday');
  assert.ok(data.weekStart <= data.today);
});

let wuse, garki;
test('sites: add, reuse near-duplicates, update, list', { skip }, async () => {
  const a = await s.dash('POST', '/api/sites', WUSE);
  assert.equal(a.status, 201);
  assert.equal(a.data.created, true);
  wuse = a.data.site;
  assert.equal(wuse.radiusM, 100);

  const dup = await s.dash('POST', '/api/sites', { ...WUSE, lat: WUSE.lat + 0.0001 }); // ~11 m away
  assert.equal(dup.data.created, false);
  assert.equal(dup.data.site.id, wuse.id);

  const g = await s.dash('POST', '/api/sites', { name: 'Garki Hospital', lat: 9.03, lng: 7.49, radiusM: 200 });
  garki = g.data.site;

  const up = await s.dash('PATCH', `/api/sites/${garki.id}`, { radiusM: 150 });
  assert.equal(up.data.site.radiusM, 150);
  assert.equal((await s.dash('PATCH', `/api/sites/${uuid()}`, { radiusM: 150 })).status, 404);
  assert.equal((await s.dash('POST', '/api/sites', { name: 'X', lat: 9, lng: 7, radiusM: 5 })).status, 400);
  assert.equal((await s.dash('POST', '/api/sites', { lat: 9, lng: 7 })).status, 400);
  assert.equal((await s.dash('GET', '/api/sites')).data.sites.length, 2);
});

test('import: pasted list creates, reuses, plans, and reports bad lines', { skip }, async () => {
  const text = `Wuse Market, 9.0765, 7.3986\nMaitama Branch, 9.0833, 7.4833, 80\nbroken line`;
  const r = await s.dash('POST', '/api/sites/import', { text, deviceIds: [DEVICE] });
  assert.equal(r.status, 200);
  assert.equal(r.data.created, 1);
  assert.equal(r.data.reused, 1);
  assert.equal(r.data.errors.length, 1);
  assert.equal((await s.dash('GET', '/api/sites')).data.sites.length, 3);
  assert.equal((await s.dash('POST', '/api/sites/import', { text, deviceIds: ['nope'] })).status, 400);
});

test('plan: set replaces, phone sees this week only', { skip }, async () => {
  const set = await s.dash('PUT', '/api/plan', { deviceId: DEVICE, siteIds: [wuse.id, garki.id] });
  assert.equal(set.status, 200);
  const mine = await s.phone('GET', `/api/my-plan?deviceId=${DEVICE}`);
  assert.deepEqual(mine.data.sites.map((x) => x.name), ['Garki Hospital', 'Wuse Market']);
  assert.equal(mine.data.rules.visitAccuracyM, 50);

  const next = await s.dash('PUT', '/api/plan', { deviceId: DEVICE, weekStart: '2030-01-07', siteIds: [wuse.id] });
  assert.equal(next.data.weekStart, '2030-01-07');
  assert.equal((await s.phone('GET', `/api/my-plan?deviceId=${DEVICE}`)).data.sites.length, 2, 'other weeks do not leak in');

  assert.equal((await s.dash('PUT', '/api/plan', { deviceId: DEVICE, siteIds: [uuid()] })).status, 400, 'unknown site');
  assert.equal((await s.dash('PUT', '/api/plan', { siteIds: [] })).status, 400);
});

let verifiedId;
test('check-in at the site is verified, with distance, idempotent on retry', { skip }, async () => {
  verifiedId = uuid();
  const body = { deviceId: DEVICE, label: 'FO Ada', id: verifiedId, siteId: wuse.id, lat: WUSE.lat + 0.0002, lng: WUSE.lng, t: nowMs() - 60_000, acc: 12, photo: { mime: 'image/jpeg', data: tinyJpegBase64 } };
  const r = await s.phone('POST', '/api/checkins', body);
  assert.equal(r.status, 200);
  assert.equal(r.data.saved, true);
  assert.equal(r.data.status, 'verified');
  assert.ok(r.data.distanceM > 10 && r.data.distanceM < 40, `distance ${r.data.distanceM}`);

  const retry = await s.phone('POST', '/api/checkins', body);
  assert.equal(retry.data.saved, false);
  assert.equal(retry.data.status, 'verified');
  assert.equal((await s.dash('GET', '/api/visits')).data.visits.length, 1, 'no duplicate row');

  const stolen = await s.phone('POST', '/api/checkins', { ...body, deviceId: 'device-other-22' });
  assert.equal(stolen.status, 400, 'another device cannot reuse the id');
});

test('check-in far away is off_site; unplanned has no distance; unknown site is 400', { skip }, async () => {
  const far = await s.phone('POST', '/api/checkins', { deviceId: DEVICE, id: uuid(), siteId: garki.id, lat: WUSE.lat, lng: WUSE.lng, t: nowMs() - 30_000, acc: 8 });
  assert.equal(far.data.status, 'off_site');
  assert.ok(far.data.distanceM > 5000);

  const other = await s.phone('POST', '/api/checkins', { deviceId: DEVICE, id: uuid(), placeName: 'Mama Ngozi shop', lat: 9.2, lng: 7.2, t: nowMs() - 20_000, acc: 8 });
  assert.equal(other.data.status, 'unplanned');
  assert.equal(other.data.distanceM, null);

  const bad = await s.phone('POST', '/api/checkins', { deviceId: DEVICE, id: uuid(), siteId: uuid(), lat: 9, lng: 7, t: nowMs(), acc: 8 });
  assert.equal(bad.status, 400);
  assert.equal((await s.phone('POST', '/api/checkins', { deviceId: DEVICE, id: uuid(), lat: 9, lng: 7, t: nowMs() })).status, 400);
});

test('review: statuses, flags and photo access', { skip }, async () => {
  const { data } = await s.dash('GET', '/api/visits');
  assert.equal(data.visits.length, 3);
  const v = Object.fromEntries(data.visits.map((x) => [x.status, x]));
  assert.equal(v.verified.name, 'Wuse Market');
  assert.equal(v.verified.hasPhoto, true);
  assert.deepEqual(v.verified.flags, [], 'recent check-in: tracking window still open, GPS good');
  assert.ok(v.off_site.flags.length === 0);
  assert.equal(v.unplanned.name, 'Mama Ngozi shop');

  const photo = await s.dash('GET', `/api/visits/${verifiedId}/photo`);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/jpeg');
  assert.match(photo.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal((await s.anon('GET', `/api/visits/${verifiedId}/photo`)).status, 401);
  assert.equal((await s.dash('GET', `/api/visits/${uuid()}/photo`)).status, 404);
  assert.equal((await s.dash('GET', '/api/visits/not-a-uuid/photo')).status, 404);
});

test('fraud flags: weak GPS, no track, impossible travel, clock ahead', { skip }, async () => {
  const dev = 'device-fraud-9';
  const old = nowMs() - 3 * 3_600_000; // old enough that the tracking window has closed
  const mk = (extra) => ({ deviceId: dev, label: 'FO Bayo', id: uuid(), lat: WUSE.lat, lng: WUSE.lng, acc: 10, ...extra });

  await s.phone('POST', '/api/checkins', mk({ placeName: 'A', t: old - 700_000, acc: 300 })); // weak gps, no tracking within 10 min
  await s.phone('POST', '/api/checkins', mk({ placeName: 'B', t: old, lat: 9.5, lng: 7.9 })); // ~60 km in under 12 min
  await s.phone('POST', '/api/locations', { deviceId: dev, points: [{ t: old + 30_000, lat: 9.7, lng: 8.1, acc: 10 }] }); // tracking exists but far from B
  await s.phone('POST', '/api/checkins', mk({ placeName: 'C', t: nowMs() + 20 * 60_000 })); // clock 20 min ahead

  const { data } = await s.dash('GET', `/api/visits?deviceId=${dev}`);
  const by = Object.fromEntries(data.visits.map((x) => [x.name, x.flags]));
  assert.deepEqual(by.A.sort(), ['no_track', 'weak_gps']);
  assert.deepEqual(by.B.sort(), ['impossible_travel', 'track_mismatch']);
  assert.deepEqual(by.C, ['clock_ahead']);
});

test('track support: a check-in with tracking nearby is clean', { skip }, async () => {
  const dev = 'device-clean-7';
  const t = nowMs() - 2 * 3_600_000;
  await s.phone('POST', '/api/locations', { deviceId: dev, label: 'FO Chi', points: [{ t: t - 60_000, lat: WUSE.lat, lng: WUSE.lng, acc: 10 }, { t: t + 60_000, lat: WUSE.lat, lng: WUSE.lng, acc: 10 }] });
  await s.phone('POST', '/api/checkins', { deviceId: dev, id: uuid(), siteId: wuse.id, lat: WUSE.lat, lng: WUSE.lng, t, acc: 9 });
  const { data } = await s.dash('GET', `/api/visits?deviceId=${dev}`);
  assert.deepEqual(data.visits[0].flags, []);
  assert.equal(data.visits[0].status, 'verified');
});

test('board: not visited / verified / off site per FO, plus CSV', { skip }, async () => {
  const { data } = await s.dash('GET', '/api/plan/board');
  const mine = data.items.filter((i) => i.deviceId === DEVICE);
  const status = Object.fromEntries(mine.map((i) => [i.site.name, i.status]));
  assert.deepEqual(status, { 'Garki Hospital': 'off_site', 'Wuse Market': 'verified' });
  assert.deepEqual(data.summary, { planned: 2, verified: 1, offSite: 1, notVisited: 0 });

  // Maitama is planned for nobody yet; plan it and it must show as not visited.
  const maitama = (await s.dash('GET', '/api/sites')).data.sites.find((x) => x.name === 'Maitama Branch');
  await s.dash('PUT', '/api/plan', { deviceId: DEVICE, siteIds: [wuse.id, garki.id, maitama.id] });
  const after = await s.dash('GET', `/api/plan/board?deviceId=${DEVICE}`);
  assert.equal(after.data.summary.notVisited, 1);

  const csv = await s.dash('GET', '/api/plan/board.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.data, /Not visited/);
  assert.match(csv.data, /^Week starting,FO,Site,Status/);
  const raw = Buffer.from(await (await fetch(s.base + '/api/plan/board.csv', { headers: { authorization: 'Basic ' + Buffer.from('b:dash-pass').toString('base64') } })).arrayBuffer());
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM so Excel reads it as UTF-8');
  assert.match(csv.data, /FO Ada/, 'name was not wiped by check-ins that sent no label');
  const vcsv = await s.dash('GET', '/api/visits.csv');
  assert.match(vcsv.data, /FO Ada,Wuse Market,Verified/);
});

test('a better visit replaces a worse one on the board', { skip }, async () => {
  // Garki was off_site; a later check-in right at Garki must win.
  await s.phone('POST', '/api/checkins', { deviceId: DEVICE, id: uuid(), siteId: garki.id, lat: 9.03, lng: 7.49, t: nowMs() - 5000, acc: 10 });
  const { data } = await s.dash('GET', `/api/plan/board?deviceId=${DEVICE}`);
  assert.equal(data.items.find((i) => i.site.name === 'Garki Hospital').status, 'verified');
});

test('archiving a site hides it from lists and plans but keeps old visits', { skip }, async () => {
  assert.equal((await s.dash('DELETE', `/api/sites/${garki.id}`)).status, 200);
  assert.equal((await s.dash('GET', '/api/sites')).data.sites.some((x) => x.id === garki.id), false);
  assert.equal((await s.phone('GET', `/api/my-plan?deviceId=${DEVICE}`)).data.sites.some((x) => x.id === garki.id), false);
  assert.ok((await s.dash('GET', '/api/visits')).data.visits.some((x) => x.name === 'Garki Hospital'));
  assert.equal((await s.dash('DELETE', `/api/sites/${garki.id}`)).status, 404);
});

test('dates: day boundaries use the configured time zone', { skip }, async () => {
  // 23:30 Lagos on 2026-10-30 is 22:30 UTC; it belongs to the 30th, not the 31st.
  const dev = 'device-tz-0001';
  const t = Date.UTC(2026, 9, 30, 22, 30);
  await s.phone('POST', '/api/locations', { deviceId: dev, label: 'TZ', points: [{ t, lat: 9, lng: 7, acc: 5 }] }).catch(() => {});
  // too old for retention? it is within 90 days of the real clock only if the sandbox date is near; use a direct insert instead
  await s.db.query('INSERT INTO devices (device_id,label) VALUES ($1,$2) ON CONFLICT DO NOTHING', [dev, 'TZ']);
  await s.db.query('INSERT INTO locations (device_id,recorded_at,lat,lng) VALUES ($1,$2,9,7) ON CONFLICT DO NOTHING', [dev, new Date(t).toISOString()]);
  const day30 = await s.dash('GET', `/api/route?deviceId=${dev}&date=2026-10-30`);
  const day31 = await s.dash('GET', `/api/route?deviceId=${dev}&date=2026-10-31`);
  assert.equal(day30.data.total, 1);
  assert.equal(day31.data.total, 0);
});

test('errors: bad JSON, oversized body, unknown api path, delete device', { skip }, async () => {
  const bad = await fetch(s.base + '/api/locations', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-key': 'phone-key' }, body: '{oops' });
  assert.equal(bad.status, 400);
  const huge = await fetch(s.base + '/api/locations', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-key': 'phone-key' }, body: JSON.stringify({ x: 'a'.repeat(300_000) }) });
  assert.equal(huge.status, 413);
  assert.equal((await s.dash('GET', '/api/nope')).status, 404);
  assert.equal((await s.dash('DELETE', `/api/devices/${DEVICE}`)).data.ok, true);
  assert.equal((await s.dash('GET', '/api/visits')).data.visits.some((x) => x.deviceId === DEVICE), false, 'visits go with the device');
});
