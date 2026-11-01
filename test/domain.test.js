import test from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from '../src/errors.js';
import { cleanText, requireDate, requireDeviceId, requireInt, isUuid } from '../src/domain/validate.js';
import { cleanPoints, downsample } from '../src/domain/points.js';
import { parseCheckin } from '../src/domain/checkin.js';
import { parseSiteLines } from '../src/domain/siteImport.js';
import { FLAGS, planItemStatus, visitFlags, visitStatus } from '../src/domain/visitAssessment.js';
import { toCsv } from '../src/http/csv.js';
import { loadConfig, ConfigError } from '../src/config.js';

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
const id = '3f2b8c1e-1d2a-4b3c-8d4e-5f6a7b8c9d0e';

test('validate: ids, dates, ints, text', () => {
  assert.ok(isUuid(id));
  assert.ok(!isUuid('nope'));
  assert.throws(() => requireDeviceId('short'), ValidationError);
  assert.equal(requireDeviceId('abcd-1234'), 'abcd-1234');
  assert.throws(() => requireDate('31/10/2026'), ValidationError);
  assert.equal(requireDate('2026-10-31'), '2026-10-31');
  assert.throws(() => requireInt('x', 'days', { min: 1, max: 5 }), ValidationError);
  assert.throws(() => requireInt(9, 'days', { min: 1, max: 5 }), ValidationError);
  assert.equal(cleanText('  <b>Hi</b>\u0000 ', 10), 'bHi/b');
  assert.equal(cleanText('', 10, 'fallback'), 'fallback');
  assert.equal(cleanText('x'.repeat(99), 5), 'xxxxx');
});

test('points: keeps believable, rejects the rest, downsamples keeping ends', () => {
  const { good, rejected } = cleanPoints(
    [
      { t: NOW, lat: 9, lng: 7, acc: 10 },
      { t: NOW, lat: 91, lng: 7 },
      { t: NOW + 3_600_000, lat: 9, lng: 7 },
      { t: NOW - 200 * 86_400_000, lat: 9, lng: 7 },
      null,
      { t: NOW, lat: 9, lng: 7, acc: -5 },
    ],
    { now: NOW, retentionDays: 90 }
  );
  assert.equal(good.length, 2);
  assert.equal(rejected, 4);
  assert.equal(good[1].acc, null);

  const many = Array.from({ length: 1000 }, (_, i) => i);
  const thin = downsample(many, 100);
  assert.ok(thin.length <= 101);
  assert.equal(thin[0], 0);
  assert.equal(thin.at(-1), 999);
  assert.equal(downsample([1, 2], 100).length, 2);
});

test('checkin: valid, site xor place, photo checks, clock', () => {
  const base = { deviceId: 'device-aaaa', id, siteId: id, lat: 9, lng: 7, t: NOW - 1000, acc: 12 };
  const ok = parseCheckin(base, { now: NOW, retentionDays: 90 });
  assert.equal(ok.checkin.siteId, id);
  assert.equal(ok.checkin.placeName, null);

  const other = parseCheckin({ ...base, siteId: null, placeName: ' Mama Ngozi shop ' }, { now: NOW, retentionDays: 90 });
  assert.equal(other.checkin.placeName, 'Mama Ngozi shop');

  const bad = (patch) => assert.throws(() => parseCheckin({ ...base, ...patch }, { now: NOW, retentionDays: 90 }), ValidationError);
  bad({ siteId: null });
  bad({ placeName: 'both' });
  bad({ lat: 200 });
  bad({ t: NOW + 3 * 86_400_000 });
  bad({ t: NOW - 400 * 86_400_000 });
  bad({ id: 'x' });
  bad({ photo: { mime: 'image/png', data: 'AAAA' } });
  bad({ photo: { mime: 'image/jpeg', data: Buffer.from('not a jpeg').toString('base64') } });
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(700_000)]).toString('base64');
  bad({ photo: { mime: 'image/jpeg', data: big } });

  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(10)]).toString('base64');
  const withPhoto = parseCheckin({ ...base, photo: { mime: 'image/jpeg', data: jpeg } }, { now: NOW, retentionDays: 90 });
  assert.equal(withPhoto.checkin.photo.bytes.length, 13);
});

test('site import: columns, radius, google links, errors, comments', () => {
  const { sites, errors } = parseSiteLines(`
# week 44
Wuse Market, 9.0765, 7.3986
Garki Hospital; 9.03; 7.49; 150
Shop, with comma, 9.1, 7.2
Maitama Branch, https://www.google.com/maps/place/Maitama/@9.0833,7.4833,17z/data=!3m1
Nowhere, 95, 7
Bad line
Tiny radius, 9, 7, 5
Short link, https://maps.app.goo.gl/abc123
`);
  assert.deepEqual(sites.map((s) => s.name), ['Wuse Market', 'Garki Hospital', 'Shop, with comma', 'Maitama Branch']);
  assert.equal(sites[0].radiusM, 100);
  assert.equal(sites[1].radiusM, 150);
  assert.equal(sites[3].lat, 9.0833);
  assert.equal(errors.length, 4);
  assert.match(errors[3].reason, /Short links/);
});

test('assessment: status, flags, plan status', () => {
  assert.equal(visitStatus({ siteId: null, distanceM: null, radiusM: null }), 'unplanned');
  assert.equal(visitStatus({ siteId: id, distanceM: 40, radiusM: 100 }), 'verified');
  assert.equal(visitStatus({ siteId: id, distanceM: 400, radiusM: 100 }), 'off_site');
  assert.equal(planItemStatus(null), 'not_visited');
  assert.equal(planItemStatus({ distanceM: 400, radiusM: 100 }), 'off_site');

  const at = new Date(NOW - 3_600_000);
  const v = (patch) => ({ accuracyM: 10, recordedAt: at, receivedAt: new Date(NOW - 3_000_000), trackPoints: 5, trackNearestM: 20, prevDistanceM: null, prevGapS: null, ...patch });
  const now = new Date(NOW);
  assert.deepEqual(visitFlags(v({}), { now }), []);
  assert.deepEqual(visitFlags(v({ accuracyM: 200 }), { now }), [FLAGS.WEAK_GPS]);
  assert.deepEqual(visitFlags(v({ trackPoints: 0, trackNearestM: null }), { now }), [FLAGS.NO_TRACK]);
  assert.deepEqual(visitFlags(v({ trackNearestM: 900 }), { now }), [FLAGS.TRACK_MISMATCH]);
  // Recent check-in: tracking window still open, so no track judgement yet.
  assert.deepEqual(visitFlags(v({ recordedAt: new Date(NOW - 60_000), receivedAt: new Date(NOW), trackPoints: 0, trackNearestM: null }), { now }), []);
  // 50 km in 10 minutes = 300 km/h
  assert.deepEqual(visitFlags(v({ prevDistanceM: 50_000, prevGapS: 600 }), { now }), [FLAGS.IMPOSSIBLE_TRAVEL]);
  // 50 km in 2 hours is fine; 100 m jitter is ignored
  assert.deepEqual(visitFlags(v({ prevDistanceM: 50_000, prevGapS: 7200 }), { now }), []);
  assert.deepEqual(visitFlags(v({ prevDistanceM: 100, prevGapS: 1 }), { now }), []);
  // phone clock 10 min ahead of the server
  assert.deepEqual(visitFlags(v({ recordedAt: new Date(NOW - 3_000_000 + 600_000) }), { now }), [FLAGS.CLOCK_AHEAD]);
});

test('csv: quoting and formula guard', () => {
  const csv = toCsv(['a', 'b'], [['x,y', 'say "hi"'], ['=SUM(A1)', null]]);
  assert.equal(csv, 'a,b\r\n"x,y","say ""hi"""\r\n\'=SUM(A1),\r\n');
});

test('config: requires DATABASE_URL, validates numbers, applies defaults', () => {
  assert.throws(() => loadConfig({}), ConfigError);
  assert.throws(() => loadConfig({ DATABASE_URL: 'x', RETENTION_DAYS: 'abc' }), ConfigError);
  const c = loadConfig({ DATABASE_URL: 'postgres://x', PORT: '8080' });
  assert.equal(c.port, 8080);
  assert.equal(c.retentionDays, 90);
  assert.equal(c.timezone, 'Africa/Lagos');
  assert.equal(c.googleMapId, 'DEMO_MAP_ID');
});
