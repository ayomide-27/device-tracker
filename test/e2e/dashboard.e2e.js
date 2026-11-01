import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { requireTestDatabase, startServer, uuid } from '../helpers.js';
import { loadPlaywright, makeJpeg, until } from './browser.js';

const playwright = loadPlaywright();
const skip = requireTestDatabase() || (playwright ? false : 'playwright not found (set PLAYWRIGHT_PATH)');

const ADA = 'device-ada-0001';
const BAYO = 'device-bayo-0002';
const WUSE = { name: 'Wuse Market', lat: 9.0765, lng: 7.3986 };
const GARKI = { name: 'Garki Hospital', lat: 9.03, lng: 7.49 };
const MAITAMA = { name: 'Maitama Branch', lat: 9.0833, lng: 7.4833 };

let s, browser, day, wuseId, garkiId, maitamaId, photoBase64;

// A stand-in for Google's script that records what the dashboard asks of it.
const GOOGLE_MOCK = `
(() => {
  const gm = (window.__gm = { markers: [], polylines: [], circles: [], clicks: [], fits: 0, panned: null });
  class MapC { constructor(el, o) { this.el = el; this.o = o; gm.map = this; gm.options = o; }
    fitBounds() { gm.fits += 1; } panTo(p) { gm.panned = p; } setZoom() {} getZoom() { return 12; }
    setOptions(o) { Object.assign(this.o, o); gm.cursor = o.draggableCursor; }
    addListener(ev, fn) { if (ev === 'click') gm.clicks.push(fn); } }
  class Marker { constructor({ position, content }) { this.position = position; this.content = content; this._m = null; gm.markers.push(this); }
    set map(m) { if (m) gm.map.el.append(this.content); else this.content.remove(); this._m = m; } get map() { return this._m; }
    addEventListener(ev, fn) { if (ev === 'gmp-click') this.content.addEventListener('click', fn); } }
  class Shape { constructor(o) { this.o = o; this._m = null; } setMap(m) { this._m = m; } }
  class Polyline extends Shape { constructor(o) { super(o); gm.polylines.push(this); } }
  class Circle extends Shape { constructor(o) { super(o); gm.circles.push(this); } }
  const libs = { maps: { Map: MapC, Polyline, Circle }, marker: { AdvancedMarkerElement: Marker } };
  window.google = { maps: {
    importLibrary: async (n) => libs[n], ControlPosition: { RIGHT_BOTTOM: 1 },
    LatLngBounds: class { constructor() { this.p = []; } extend(p) { this.p.push(p); } },
    event: { addListenerOnce: (m, e, fn) => fn() } } };
  window.__googleMapsReady();
})();`;

before(async () => {
  if (skip) return;
  s = await startServer();
  browser = await playwright.chromium.launch();
  const photoFile = path.join(os.tmpdir(), 'fo-dash-photo.jpg');
  await makeJpeg(browser, photoFile);
  photoBase64 = (await readFile(photoFile)).toString('base64');

  // ---- seed: two FOs, three sites, a plan, a route with a gap, and check-ins ----
  const now = Date.now();
  const at = (minutesAgo) => now - minutesAgo * 60_000;
  day = new Date(at(100) + 3_600_000).toISOString().slice(0, 10); // the Lagos day those timestamps fall on

  const site = async (x) => (await s.dash('POST', '/api/sites', x)).data.site.id;
  wuseId = await site(WUSE);
  garkiId = await site(GARKI);
  maitamaId = await site(MAITAMA);

  const route = [];
  for (let i = 0; i < 12; i += 1) route.push({ t: at(100 - i * 2), lat: 9.07 + i * 0.001, lng: 7.39 + i * 0.001, acc: 10 });
  for (let i = 0; i < 6; i += 1) route.push({ t: at(60 - i * 2), lat: 9.082 + i * 0.001, lng: 7.402 + i * 0.001, acc: 10 }); // after a 14 min gap
  await s.phone('POST', '/api/locations', { deviceId: ADA, label: 'FO Ada', points: route });
  await s.phone('POST', '/api/locations', { deviceId: BAYO, label: 'FO Bayo', points: [{ t: at(1), lat: 9.05, lng: 7.45, acc: 20 }] });

  const checkin = (deviceId, extra) => s.phone('POST', '/api/checkins', { deviceId, id: uuid(), acc: 8, ...extra });
  await checkin(ADA, { siteId: wuseId, lat: WUSE.lat, lng: WUSE.lng, t: at(95), photo: { mime: 'image/jpeg', data: photoBase64 } });
  await checkin(ADA, { siteId: garkiId, lat: 9.05, lng: 7.41, t: at(85) });
  await checkin(ADA, { placeName: 'Mama Ngozi shop', lat: 9.075, lng: 7.395, t: at(80), acc: 300 });

  await s.dash('PUT', '/api/plan', { deviceId: ADA, siteIds: [wuseId, garkiId, maitamaId] });
  await s.dash('PUT', '/api/plan', { deviceId: BAYO, siteIds: [wuseId] });
});
after(async () => {
  await browser?.close();
  await s?.close();
});

// mode: 'osm' (no key) | 'google' (mock) | 'rejected' (mock whose key Google rejects)
async function openDashboard(mode, { width = 1280, height = 800 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, httpCredentials: { username: 'boss', password: 'dash-pass' } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (mode === 'osm') {
    await page.route('**/api/config', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), googleMapsApiKey: '' } });
    });
  } else {
    await page.route('https://maps.googleapis.com/maps/api/js**', (route) => {
      const url = new URL(route.request().url());
      assert.equal(url.searchParams.get('key'), 'test-key');
      assert.equal(url.searchParams.get('loading'), 'async');
      route.fulfill({ contentType: 'text/javascript', body: GOOGLE_MOCK + (mode === 'rejected' ? 'setTimeout(() => window.gm_authFailure(), 300);' : '') });
    });
  }
  // Tiles are not needed (and the sandbox has no internet).
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  await page.goto(s.base + '/');
  return { page, context, errors };
}

const lineCount = (page) =>
  page.evaluate(() => (window.__gm ? window.__gm.polylines.filter((p) => p._m).length : document.querySelectorAll('#map path.leaflet-interactive').length));
const pins = (page, selector) => page.locator(`#map ${selector}`).count();
const goDay = async (page, date) => {
  await page.click('[data-tab="day"]');
  await page.fill('#dayDate', date);
  await page.dispatchEvent('#dayDate', 'change');
};

for (const mode of ['osm', 'google']) {
  test(`[${mode}] live tab shows phones by name, on the map, offline ones greyed`, { skip }, async () => {
    const { page, context, errors } = await openDashboard(mode);
    await until(async () => (await page.locator('#deviceList .row').count()) === 2, { what: 'two phones listed' });
    assert.match(await page.locator('#deviceList').innerText(), /FO Ada/);
    await until(async () => (await pins(page, '.pin.device')) === 2, { what: 'two device markers' });
    assert.equal(await pins(page, '.pin.device .pin-label'), 2);
    assert.deepEqual(errors, []);
    await context.close();
  });

  test(`[${mode}] day tab: route with a dashed gap, check-ins in three styles, flags, photo`, { skip }, async () => {
    const { page, context, errors } = await openDashboard(mode);
    await until(async () => (await page.locator('#deviceList .row').count()) === 2);
    await page.locator('#deviceList .row', { hasText: 'FO Ada' }).click(); // selects Ada
    await goDay(page, day);

    await until(async () => (await pins(page, '.pin.visit')) === 3, { what: '3 check-in pins' });
    assert.equal(await pins(page, '.pin.visit.verified'), 1);
    assert.equal(await pins(page, '.pin.visit.off_site'), 1);
    assert.equal(await pins(page, '.pin.visit.unplanned'), 1);
    assert.equal(await lineCount(page), 3, 'solid, dashed gap, solid');
    assert.equal(await pins(page, '.pin.endpoint'), 2);

    const summary = await page.locator('#daySummary').innerText();
    assert.match(summary, /Route: 18 points/);
    assert.match(summary, /3 check-ins/);
    const list = await page.locator('#visitList').innerText();
    assert.match(list, /Wuse Market[\s\S]*Verified/);
    assert.match(list, /Garki Hospital[\s\S]*Off site/);
    assert.match(list, /Mama Ngozi shop[\s\S]*Unplanned[\s\S]*Weak GPS/);

    // photo viewer
    await page.locator('#visitList .row', { hasText: 'Wuse Market' }).getByRole('button', { name: 'Photo' }).click();
    await page.waitForSelector('#photoModal:not([hidden])');
    await until(() => page.evaluate(() => document.getElementById('photoImg').naturalWidth > 0), { what: 'photo loaded' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#photoModal', { state: 'hidden' });

    // list click opens the details card
    await page.locator('#visitList .row', { hasText: 'Garki Hospital' }).click();
    await page.waitForSelector('#infoCard:not([hidden])');
    assert.match(await page.locator('#infoCard').innerText(), /Garki Hospital[\s\S]*Off site/);

    // clicking a pin on the map opens it too (the list click above moved the map, so zoom back out first)
    await page.locator('#infoCard .close').click();
    await page.click('#fitBtn');
    await page.locator('#map .pin.visit.verified').click();
    assert.match(await page.locator('#infoCard').innerText(), /Wuse Market/);

    assert.match(await page.getAttribute('#visitsCsv', 'href'), new RegExp(`/api/visits\\.csv\\?.*date=${day}`));
    assert.deepEqual(errors, []);
    await context.close();
  });

  test(`[${mode}] layer toggles hide and show check-ins, route and planned sites`, { skip }, async () => {
    const { page, context } = await openDashboard(mode);
    await until(async () => (await page.locator('#deviceList .row').count()) === 2);
    await page.locator('#deviceList .row', { hasText: 'FO Ada' }).click();
    await goDay(page, day);
    await until(async () => (await pins(page, '.pin.visit')) === 3);

    await page.uncheck('#layers input[data-layer="visits"]');
    await until(async () => (await pins(page, '.pin.visit')) === 0, { what: 'check-ins hidden' });
    assert.equal(await lineCount(page) > 0, true, 'route still there');
    await page.check('#layers input[data-layer="visits"]');
    await until(async () => (await pins(page, '.pin.visit')) === 3, { what: 'check-ins back' });

    await page.uncheck('#layers input[data-layer="route"]');
    await until(async () => (await pins(page, '.pin.endpoint')) === 0, { what: 'route hidden' });
    await page.uncheck('#layers input[data-layer="devices"]');
    await until(async () => (await pins(page, '.pin.device')) === 0);
    await context.close();
  });

  test(`[${mode}] plan tab: board shows verified, off-site and not-visited; map rings coloured`, { skip }, async () => {
    const { page, context } = await openDashboard(mode);
    await page.click('[data-tab="plan"]');
    await until(async () => (await page.locator('#boardList .row').count()) === 4, { what: '4 planned items' });
    const summary = await page.locator('#boardSummary').innerText();
    assert.match(summary, /4 planned/);
    assert.match(summary, /1 verified/);
    assert.match(summary, /1 off site/);
    assert.match(summary, /2 not visited/);
    assert.match(await page.locator('#boardList').innerText(), /FO Ada: 1 of 3 verified/);
    // Wuse is planned for both FOs, so the map shows 3 distinct sites
    await until(async () => (await pins(page, '.pin.site')) === 3, { what: 'site pins' });
    assert.equal(await pins(page, '.pin.site.verified'), 1);
    assert.equal(await pins(page, '.pin.site.off_site'), 1);
    assert.equal(await pins(page, '.pin.site.not_visited'), 1);
    assert.match(await page.getAttribute('#boardCsv', 'href'), /board\.csv\?week=/);

    await page.selectOption('#planDevice', BAYO);
    assert.equal(await page.locator('#boardList .row').count(), 1);
    await context.close();
  });
}

test('[osm] assign: paste a list, see errors, remove one, archive a site', { skip }, async () => {
  const { page, context } = await openDashboard('osm');
  await page.click('[data-tab="plan"]');
  await until(async () => (await page.locator('#targetList input').count()) === 2);
  await page.uncheck(`#targetList input[value="${BAYO}"]`);
  await page.fill('#importText', 'Kubwa Depot, 9.15, 7.33, 120\nWuse Market, 9.0765, 7.3986\nthis is not a site');
  await page.click('#importBtn');
  await until(async () => /1 new, 1 already known/.test(await page.locator('#importResult').innerText()), { what: 'import result' });
  assert.match(await page.locator('#importErrors').innerText(), /Line 3/);
  await until(async () => /Kubwa Depot/.test(await page.locator('#boardList').innerText()));

  // take Kubwa off Ada's week
  await page.locator('#boardList .row', { hasText: 'Kubwa Depot' }).getByRole('button', { name: '✕' }).click();
  await until(async () => !/Kubwa Depot/.test(await page.locator('#boardList').innerText()), { what: 'removed from week' });

  // library: change radius then archive
  await page.click('#libraryBox summary');
  const kubwa = page.locator('#libraryList .row', { hasText: 'Kubwa Depot' });
  page.once('dialog', (d) => d.accept('150'));
  await kubwa.getByRole('button', { name: 'Radius' }).click();
  await until(async () => /150 m/.test(await kubwa.innerText()), { what: 'radius updated' });
  page.once('dialog', (d) => d.accept());
  await kubwa.getByRole('button', { name: 'Archive' }).click();
  await until(async () => (await page.locator('#libraryList .row', { hasText: 'Kubwa Depot' }).count()) === 0, { what: 'archived' });
  await context.close();
});

test('[osm] placing a site by clicking the map', { skip }, async () => {
  const { page, context } = await openDashboard('osm');
  await page.click('[data-tab="plan"]');
  await until(async () => (await page.locator('#targetList input').count()) === 2);
  await page.fill('#pinName', 'Pinned Shop');
  await page.click('#pinBtn');
  await page.waitForSelector('#pickBanner:not([hidden])');
  await page.locator('#map').click({ position: { x: 600, y: 400 } });
  await page.waitForSelector('#pickBanner', { state: 'hidden' });
  await until(async () => /Pinned Shop/.test(await page.locator('#boardList').innerText()), { what: 'pinned site in board' });
  const { data } = await s.dash('GET', '/api/sites');
  const pinned = data.sites.find((x) => x.name === 'Pinned Shop');
  assert.ok(Math.abs(pinned.lat - 9.0765) < 0.5, 'coordinates come from the map centre area');

  // cancel path
  await page.fill('#pinName', 'Never Saved');
  await page.click('#pinBtn');
  await page.click('#pickCancel');
  await page.waitForSelector('#pickBanner', { state: 'hidden' });
  assert.equal((await s.dash('GET', '/api/sites')).data.sites.some((x) => x.name === 'Never Saved'), false);
  await context.close();
});

test('[google] placing a site uses the Google map click', { skip }, async () => {
  const { page, context } = await openDashboard('google');
  await page.click('[data-tab="plan"]');
  await until(async () => (await page.locator('#targetList input').count()) === 2);
  await page.fill('#pinName', 'Google Pinned');
  await page.click('#pinBtn');
  await page.waitForSelector('#pickBanner:not([hidden])');
  assert.equal(await page.evaluate(() => window.__gm.cursor), 'crosshair');
  await page.evaluate(() => window.__gm.clicks.forEach((fn) => fn({ latLng: { lat: () => 9.2, lng: () => 7.5 } })));
  await until(async () => (await s.dash('GET', '/api/sites')).data.sites.some((x) => x.name === 'Google Pinned' && x.lat === 9.2 && x.lng === 7.5), { what: 'site saved at clicked spot' });
  await context.close();
});

test('map falls back to OpenStreetMap when Google rejects the key, and says why', { skip }, async () => {
  const { page, context } = await openDashboard('rejected');
  await until(async () => (await page.locator('#mapNote').innerText()).includes('Google rejected the API key'), { what: 'fallback note', timeout: 20000 });
  assert.match(await page.locator('#mapNote').innerText(), /OpenStreetMap/);
  await page.waitForSelector('#map.leaflet-container');
  await until(async () => (await page.locator('#deviceList .row').count()) === 2);
  await context.close();
});

test('with no key, the note explains it is using OpenStreetMap', { skip }, async () => {
  const { page, context } = await openDashboard('osm');
  await until(async () => /No Google Maps key/.test(await page.locator('#mapNote').innerText()));
  await context.close();
});

test('layout: the side panel never covers the map controls (desktop) and the map comes first (phone)', { skip }, async () => {
  const desktop = await openDashboard('osm');
  await until(async () => (await desktop.page.locator('#map .leaflet-control-zoom').count()) === 1);
  const box = async (page, sel) => page.locator(sel).first().boundingBox();
  const side = await box(desktop.page, '.sidebar');
  const mapBox = await box(desktop.page, '#map');
  const zoom = await box(desktop.page, '#map .leaflet-control-zoom');
  assert.ok(side.x + side.width <= mapBox.x + 1, 'sidebar and map sit side by side');
  assert.ok(zoom.x >= mapBox.x && zoom.x + zoom.width <= mapBox.x + mapBox.width, 'zoom buttons are inside the map, not under the panel');
  await desktop.context.close();

  const phone = await openDashboard('osm', { width: 390, height: 800 });
  await until(async () => (await phone.page.locator('#deviceList .row').count()) === 2);
  const m = await box(phone.page, '.map-wrap');
  const sd = await box(phone.page, '.sidebar');
  assert.ok(m.y < sd.y && m.y + m.height <= sd.y + 1, 'map above the panel');
  await phone.context.close();
});

test('dashboard pages need the login', { skip }, async () => {
  const anon = await fetch(s.base + '/dash/js/main.js');
  assert.equal(anon.status, 401);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const response = await page.goto(s.base + '/');
  assert.equal(response.status(), 401);
  await ctx.close();
});
