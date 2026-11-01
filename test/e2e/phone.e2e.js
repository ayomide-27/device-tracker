import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { requireTestDatabase, startServer } from '../helpers.js';
import { loadPlaywright, makeJpeg, until } from './browser.js';

const playwright = loadPlaywright();
const skip = requireTestDatabase() || (playwright ? false : 'playwright not found (set PLAYWRIGHT_PATH)');

const WUSE = { name: 'Wuse Market', lat: 9.0765, lng: 7.3986 };
let s, browser, context, page, photoFile, deviceId;

const fast = {
  MIN_SECONDS_BETWEEN_POINTS: 1,
  STILL_POINT_EVERY_SECONDS: 2,
  UPLOAD_EVERY_SECONDS: 1,
  PING_EVERY_SECONDS: 2,
  PLAN_REFRESH_SECONDS: 2,
  CHECKIN_WAIT_SECONDS: 3,
};

before(async () => {
  if (skip) return;
  s = await startServer();
  browser = await playwright.chromium.launch();
  photoFile = path.join(os.tmpdir(), 'fo-test-photo.jpg');
  await makeJpeg(browser, photoFile);
  context = await browser.newContext({
    viewport: { width: 390, height: 800 },
    permissions: ['geolocation'],
    geolocation: { latitude: WUSE.lat + 0.0002, longitude: WUSE.lng, accuracy: 10 },
    acceptDownloads: false,
  });
  await context.addInitScript((cfg) => { window.__FOT_TEST_CONFIG__ = cfg; }, fast);
  page = await context.newPage();
  page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
});
after(async () => {
  await browser?.close();
  await s?.close();
});

// The browser's fake GPS only reports when it is told a position, so re-send the current one.
let currentPosition = { latitude: WUSE.lat + 0.0002, longitude: WUSE.lng, accuracy: 10 };
const setPosition = async (pos) => { currentPosition = pos; await context.setGeolocation(pos); };
const pushFix = () => context.setGeolocation(currentPosition);

const visits = async () => (await s.dash('GET', '/api/visits')).data.visits;
const text = (selector) => page.locator(selector).innerText();

test('first run: enter name and code, start sharing, points reach the server', { skip }, async () => {
  await page.goto(s.base + '/device.html');
  await page.waitForSelector('#keyRow:not([hidden])'); // server says a code is required
  await page.fill('#label', 'FO Ada');
  await page.fill('#key', 'phone-key');
  await page.click('#startBtn');
  await page.waitForSelector('#running:not([hidden])');
  await until(async () => (await text('#stateText')).startsWith('Live'), { what: 'Live status' });
  deviceId = await page.evaluate(() => localStorage.getItem('fot_id'));
  await until(async () => (await s.dash('GET', '/api/devices')).data.devices.some((d) => d.label === 'FO Ada'), { what: 'device on dashboard' });
});

test('wrong access code is reported, not silently ignored', { skip }, async () => {
  const ctx = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 9, longitude: 7, accuracy: 10 } });
  await ctx.addInitScript((cfg) => { window.__FOT_TEST_CONFIG__ = cfg; }, fast);
  const p = await ctx.newPage();
  await p.goto(s.base + '/device.html');
  await p.fill('#label', 'FO Wrong');
  await p.fill('#key', 'nope');
  await p.click('#startBtn');
  await p.waitForFunction(() => document.getElementById('stateText').textContent.includes('Access code not accepted'), null, { timeout: 15000 });
  await ctx.close();
});

test('supervisor assigns a site; it appears on the phone', { skip }, async () => {
  const { data } = await s.dash('POST', '/api/sites', WUSE);
  await s.dash('PUT', '/api/plan', { deviceId, siteIds: [data.site.id] });
  await page.waitForSelector('#siteList .site');
  assert.match(await text('#siteList'), /Wuse Market/);
  assert.match(await page.getAttribute('#siteList a', 'href'), /destination=9\.0765,7\.3986/);
});

test('check in at a site: precise GPS, verified on the server', { skip }, async () => {
  await page.click('#siteList button');
  await page.waitForSelector('#sheet:not([hidden])');
  await pushFix();
  await until(async () => !(await page.isDisabled('#confirmBtn')), { what: 'check-in button enabled' });
  assert.match(await text('#distanceText'), /Inside the 100 m check-in area/);
  await page.click('#confirmBtn');
  await until(async () => (await visits()).length === 1, { what: 'visit on server' });
  const [v] = await visits();
  assert.equal(v.status, 'verified');
  assert.equal(v.name, 'Wuse Market');
  await until(async () => /Verified/.test(await text('#todayList')), { what: 'status chip' });
  assert.match(await text('#siteList'), /Checked in today/);
});

test('offline: check-in with photo waits on the phone, then uploads when back online', { skip }, async () => {
  await context.setOffline(true);
  await until(async () => /Offline/.test(await text('#stateText')), { what: 'offline status', timeout: 25000 });
  await page.click('#otherBtn');
  await pushFix();
  await page.fill('#placeName', 'Mama Ngozi shop');
  await page.setInputFiles('#photoInput', photoFile);
  await page.waitForSelector('#photoPreview:not([hidden])');
  await until(async () => !(await page.isDisabled('#confirmBtn')));
  await page.click('#confirmBtn');
  await until(async () => /Waiting to upload/.test(await text('#todayList')), { what: 'pending chip' });
  assert.equal((await visits()).length, 1, 'server must not have it yet');

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await until(async () => (await visits()).length === 2, { what: 'uploaded after reconnect', timeout: 20000 });
  const other = (await visits()).find((v) => v.status === 'unplanned');
  assert.equal(other.name, 'Mama Ngozi shop');
  assert.equal(other.hasPhoto, true);
  await until(async () => !/Waiting to upload/.test(await text('#todayList')));
});

test('weak GPS: blocked at first, allowed after the wait, flagged weak_gps', { skip }, async () => {
  await setPosition({ latitude: WUSE.lat, longitude: WUSE.lng, accuracy: 400 });
  await page.click('#siteList button');
  await page.waitForSelector('#sheet:not([hidden])');
  await pushFix();
  await until(async () => /Weak GPS/.test(await text('#gpsText')), { what: 'weak message' });
  assert.equal(await page.isDisabled('#confirmBtn'), true);
  await until(async () => !(await page.isDisabled('#confirmBtn')), { what: 'weak option after wait' });
  assert.match(await text('#confirmBtn'), /weak GPS/);
  await page.click('#confirmBtn');
  await until(async () => (await visits()).length === 3);
  const weak = (await visits()).find((v) => v.accuracyM === 400);
  assert.ok(weak.flags.includes('weak_gps'));
  await setPosition({ latitude: WUSE.lat, longitude: WUSE.lng, accuracy: 10 });
});

test('far from the site: asks before saving, marked off site', { skip }, async () => {
  await setPosition({ latitude: WUSE.lat + 0.01, longitude: WUSE.lng, accuracy: 10 }); // ~1.1 km away
  page.once('dialog', (d) => { assert.match(d.message(), /off site/); d.accept(); });
  await page.click('#siteList button');
  await page.waitForSelector('#sheet:not([hidden])');
  await pushFix();
  await until(async () => !(await page.isDisabled('#confirmBtn')));
  await until(async () => /1[01]\d\d m from the site/.test(await text('#distanceText')), { what: 'distance text' });
  await page.click('#confirmBtn');
  await until(async () => (await visits()).length === 4);
  assert.ok((await visits()).some((v) => v.status === 'off_site'));
  await setPosition({ latitude: WUSE.lat, longitude: WUSE.lng, accuracy: 10 });
});

test('cancel saves nothing; another-place needs a name', { skip }, async () => {
  await page.click('#otherBtn');
  await pushFix();
  await until(async () => /GPS ready/.test(await text('#gpsText')));
  assert.equal(await page.isDisabled('#confirmBtn'), true, 'no name yet');
  await page.click('#cancelBtn');
  await page.waitForSelector('#sheet', { state: 'hidden' });
  assert.equal((await visits()).length, 4);
});

test('page opens with no internet and keeps pending check-ins across reloads', { skip }, async () => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.click('#otherBtn');
  await pushFix();
  await page.fill('#placeName', 'Offline shop');
  await until(async () => !(await page.isDisabled('#confirmBtn')));
  await page.click('#confirmBtn');
  await until(async () => /Waiting to upload/.test(await text('#todayList')));

  await page.reload(); // no internet: served by the service worker
  await page.waitForSelector('#running:not([hidden])', { timeout: 15000 });
  assert.match(await text('#siteList'), /Wuse Market/, 'site list from the saved copy');
  assert.match(await text('#todayList'), /Offline shop/);
  assert.match(await text('#todayList'), /Waiting to upload/);

  await context.setOffline(false);
  await until(async () => (await visits()).some((v) => v.name === 'Offline shop'), { what: 'uploaded after reload', timeout: 20000 });
});

test('stop sharing, then version-2 queued readings are migrated and uploaded', { skip }, async () => {
  await page.click('#stopBtn');
  await page.waitForSelector('#setup:not([hidden])');
  const before = (await s.dash('GET', `/api/route?deviceId=${deviceId}&days=2`)).data.total;
  const t = Date.now() - 600_000;
  await page.evaluate((t) => localStorage.setItem('fot_queue', JSON.stringify([{ t, lat: 9.1, lng: 7.2, acc: 12 }])), t);
  await page.reload();
  await page.waitForSelector('#setup:not([hidden])');
  assert.match(await text('#leftover'), /1 reading/);
  assert.equal(await page.evaluate(() => localStorage.getItem('fot_queue')), null, 'legacy key cleared');
  await page.click('#startBtn');
  await until(async () => (await s.dash('GET', `/api/route?deviceId=${deviceId}&days=2`)).data.points.some((p) => p.t === t), { what: 'legacy point uploaded' });
  assert.ok(before >= 1);
});

test('dashboard HTML is never cached by the service worker', { skip }, async () => {
  const cached = await page.evaluate(async () => (await (await caches.open('fo-tracker-shell-v1')).keys()).map((r) => new URL(r.url).pathname));
  assert.ok(cached.includes('/device.html'));
  assert.ok(cached.every((p) => p === '/device.html' || p.startsWith('/js/') || p.startsWith('/css/')));
});
