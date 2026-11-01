import { $, clock, plural } from './dom.js';
import { CFG } from './config.js';
import { api } from './api.js';
import { createCheckinSheet } from './checkinSheet.js';
import { makeUuid } from './ids.js';
import { createOutbox } from './outbox.js';
import { createPlan } from './plan.js';
import { settings } from './storage.js';
import { createSync } from './sync.js';
import { createTracker } from './tracker.js';
import { renderSites, renderStatus, renderToday, showRunning, showSetup } from './ui.js';

const startOfToday = () => new Date().setHours(0, 0, 0, 0);

async function main() {
  const outbox = await createOutbox();

  // The device ID is created once and kept, so every visit is the SAME device on the dashboard.
  let deviceId = settings.get('id');
  if (!deviceId) {
    deviceId = makeUuid();
    settings.set('id', deviceId);
  }
  const idIsSaved = settings.get('id') === deviceId;
  const identity = () => ({ deviceId, label: settings.get('label') ?? '', key: settings.get('key') ?? '' });

  // Version 2 kept waiting readings in localStorage. Move any into the outbox so none are lost.
  const legacy = settings.getJson('queue', []);
  if (Array.isArray(legacy) && legacy.length > 0 && outbox.kind === 'indexeddb') {
    for (const p of legacy) if (Number.isFinite(p?.t)) await outbox.addPoint(p);
    settings.remove('queue');
  }
  // Check-ins that were uploaded days ago no longer need to be listed here.
  const stale = (await outbox.allVisits()).filter((v) => v.state !== 'pending' && v.t < Date.now() - CFG.KEEP_SENT_CHECKINS_DAYS * 86_400_000);
  await outbox.removeVisits(stale.map((v) => v.id));

  // ---------- What is waiting (cached so drawing the screen is instant) ----------
  let counts = { points: 0, checkins: 0 };
  let todayVisits = [];

  async function refreshOutboxView() {
    const visits = await outbox.allVisits();
    counts = { points: await outbox.countPoints(), checkins: visits.filter((v) => v.state === 'pending').length };
    todayVisits = visits.filter((v) => v.t >= startOfToday()).sort((a, b) => b.t - a.t);
    renderToday(todayVisits);
    renderPlan();
    render();
  }

  // ---------- Parts ----------
  let sharing = false;
  let renderTimer = null;
  let uploadTimer = null;
  let wakeLock = null;

  const sync = createSync({ outbox, api, config: CFG, getIdentity: identity, onChange: () => refreshOutboxView() });
  const plan = createPlan({ api, config: CFG, getIdentity: identity, onChange: () => renderPlan() });
  const tracker = createTracker({
    outbox,
    config: CFG,
    onChange: () => render(),
    onRecorded: () => {
      refreshOutboxView();
      sync.flush();
    },
    onDenied: () => stopSharing(false, 'Location is blocked for this page. Allow location in your browser settings, then tap Start.'),
  });
  const sheet = createCheckinSheet({
    config: CFG,
    fixes: { latest: () => tracker.state.latestFix, subscribe: (fn) => tracker.subscribe(fn) },
    getAccuracyLimit: () => plan.visitAccuracyM(),
    onSubmit: async (visit) => {
      await outbox.putVisit(visit);
      await refreshOutboxView();
      sync.flush({ force: true });
    },
  });

  function renderPlan() {
    renderSites({
      plan: plan.get(),
      checkedInToday: new Set(todayVisits.map((v) => v.siteId).filter(Boolean)),
      onCheckin: (site) => sheet.open(site, makeUuid),
    });
  }

  // ---------- Status line ----------
  function describeState() {
    const t = tracker.state;
    const s = sync.state;
    if (t.gpsErrorCode === 2 && !t.lastFixAt) return { cls: 'warn', text: 'No GPS signal yet…' };
    if (s.connection === 'rejected') return { cls: 'error', text: 'Access code not accepted' };
    if (s.connection === 'offline') {
      return { cls: 'warn', text: `Offline: ${plural(counts.points, 'point')} and ${plural(counts.checkins, 'check-in')} saved on this phone` };
    }
    if (!t.lastFixAt || Date.now() - t.lastFixAt > 90_000) {
      return { cls: 'warn', text: t.weakAccuracy ? 'Weak GPS signal…' : 'Waiting for GPS…' };
    }
    return { cls: 'live', text: 'Live: sharing location' };
  }

  function render() {
    if (!sharing) return;
    const t = tracker.state;
    const s = sync.state;
    const hint = ['Keep this page open.'];
    hint.push(wakeLock ? 'The screen is kept on so GPS keeps running.' : 'Do not lock the phone: this page cannot track while the screen is off.');
    hint.push('Everything is saved on this phone first, so a lost signal does not lose it.');
    if (s.connection === 'rejected') hint.push('Tap Stop, then enter the correct access code.');
    if (s.rejectedPoints) hint.push(`${plural(s.rejectedPoints, 'point')} were rejected by the server.`);
    if (!idIsSaved) hint.push('Warning: this browser cannot remember this device between visits.');
    if (outbox.kind === 'memory') hint.push('Warning: this browser cannot store data offline (private mode?). Do not close this page while offline.');

    renderStatus({
      ...describeState(),
      lastFix: t.lastFixAt ? clock(t.lastFixAt) + (t.weakAccuracy ? ` (weak, ±${Math.round(t.weakAccuracy)} m)` : '') : '—',
      pending: `${plural(counts.points, 'point')}, ${plural(counts.checkins, 'check-in')}`,
      lastUpload: s.lastUploadAt ? clock(s.lastUploadAt) : '—',
      hint: hint.join(' '),
    });
  }

  // ---------- Keep the screen on (phones pause GPS in web pages when the screen locks) ----------
  async function keepAwake() {
    try {
      if (sharing && 'wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
        });
      }
    } catch {
      wakeLock = null;
    }
    render();
  }

  // ---------- Start / stop ----------
  function leftoverText() {
    const parts = [];
    if (counts.points) parts.push(plural(counts.points, 'reading'));
    if (counts.checkins) parts.push(plural(counts.checkins, 'check-in'));
    return parts.length ? `${parts.join(' and ')} saved on this phone will upload next time you start sharing with a connection.` : '';
  }

  function startSharing() {
    if (!navigator.geolocation) return showSetup({ message: 'This browser cannot share location.' });
    sharing = true;
    settings.set('sharing', '1');
    sync.state.connection = 'unknown';
    tracker.start();
    plan.start();
    uploadTimer = setInterval(() => sync.flush(), CFG.UPLOAD_EVERY_SECONDS * 1000);
    renderTimer = setInterval(render, 1000);
    showRunning();
    keepAwake();
    refreshOutboxView();
    sync.flush({ force: true });
  }

  async function stopSharing(userChoice, message) {
    sharing = false;
    settings.set('sharing', '0');
    tracker.stop();
    plan.stop();
    clearInterval(uploadTimer);
    clearInterval(renderTimer);
    try {
      await wakeLock?.release();
    } catch {
      /* ignore */
    }
    wakeLock = null;
    if (userChoice) await sync.flush({ force: true }); // one last try to upload what is waiting
    await refreshOutboxView();
    showSetup({ message, leftoverText: leftoverText() });
  }

  // ---------- Wiring ----------
  const labelInput = $('label');
  const keyInput = $('key');
  const keyRow = $('keyRow');

  $('startBtn').addEventListener('click', () => {
    const label = labelInput.value.trim();
    if (!label) return showSetup({ message: 'Please enter a name for this device.' });
    if (!keyRow.hidden && !keyInput.value.trim()) return showSetup({ message: 'Please enter the access code.' });
    settings.set('label', label);
    if (keyInput.value.trim()) settings.set('key', keyInput.value.trim());
    startSharing();
  });
  $('stopBtn').addEventListener('click', () => stopSharing(true));
  $('otherBtn').addEventListener('click', () => sheet.open(null, makeUuid));

  window.addEventListener('online', () => sync.flush({ force: true }));
  window.addEventListener('offline', () => {
    sync.state.connection = 'offline';
    render();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && sharing) {
      keepAwake();
      sync.flush({ force: true });
      plan.refresh();
    }
  });

  // ---------- On page load ----------
  labelInput.value = settings.get('label') ?? '';
  keyInput.value = settings.get('key') ?? '';
  if (settings.get('key')) keyRow.hidden = false;
  api.health().then((r) => {
    if (r.data.deviceKeyRequired) keyRow.hidden = false;
  }).catch(() => {});
  await refreshOutboxView();

  // If sharing was on when the page was last open and the browser already has permission,
  // carry on by itself: no need to tap Start or allow location again.
  if (settings.get('sharing') === '1' && settings.get('label')) {
    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      if (permission.state === 'granted') return startSharing();
    } catch {
      /* older browsers: fall through to the button */
    }
    showSetup({ message: 'Sharing was on. Tap Start to continue.', leftoverText: leftoverText() });
  } else {
    showSetup({ leftoverText: leftoverText() });
  }
}

main();

// Lets the page open with no internet after the first visit.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
