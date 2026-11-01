import { metresBetween } from '../shared/geo.js';

// The recording rule: save a reading if enough time has passed AND the phone moved,
// or if it has been still for a while (so a stationary phone still leaves a trace).
export function shouldRecord(last, next, config) {
  if (!last) return true;
  const seconds = (next.t - last.t) / 1000;
  if (seconds < 0) return false;
  if (seconds >= config.STILL_POINT_EVERY_SECONDS) return true;
  return seconds >= config.MIN_SECONDS_BETWEEN_POINTS && metresBetween(last, next) >= config.MIN_METRES_BETWEEN_POINTS;
}

// Watches GPS and stores readings in the outbox.
export function createTracker({ outbox, config, onChange, onDenied, onRecorded }) {
  const state = { lastFixAt: 0, weakAccuracy: null, gpsErrorCode: null, latestFix: null };
  const listeners = new Set();
  let watchId = null;
  let lastRecorded = null;
  let savedSinceTrim = 0;

  async function onPosition(position) {
    const c = position.coords;
    state.gpsErrorCode = null;
    state.lastFixAt = position.timestamp;
    // Every reading (even a vague one) is shared with listeners such as the check-in pop-up,
    // so only one GPS watcher runs and the battery is not drained twice.
    state.latestFix = { t: position.timestamp, lat: c.latitude, lng: c.longitude, acc: c.accuracy };
    listeners.forEach((listener) => listener(state.latestFix));

    if (c.accuracy > config.MAX_ACCURACY_METRES) {
      state.weakAccuracy = c.accuracy; // too vague to trust: show it, do not save it
      onChange();
      return;
    }
    state.weakAccuracy = null;

    const point = {
      t: position.timestamp, // when the GPS took the reading, NOT when it gets uploaded
      lat: Math.round(c.latitude * 1e6) / 1e6,
      lng: Math.round(c.longitude * 1e6) / 1e6,
      acc: Math.round(c.accuracy),
    };
    if (shouldRecord(lastRecorded, point, config)) {
      lastRecorded = point;
      await outbox.addPoint(point);
      savedSinceTrim += 1;
      if (savedSinceTrim >= 100) {
        savedSinceTrim = 0;
        await outbox.trimPoints(config.MAX_QUEUED_POINTS);
      }
      onRecorded();
    }
    onChange();
  }

  function onError(error) {
    state.gpsErrorCode = error.code;
    if (error.code === 1) onDenied(); // permission denied
    onChange(); // 2 = no signal, 3 = timed out: keep waiting, the phone keeps trying
  }

  return {
    state,
    // Calls fn with each new GPS reading. Returns a function that stops listening.
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start() {
      lastRecorded = null;
      state.gpsErrorCode = null;
      watchId = navigator.geolocation.watchPosition(onPosition, onError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 30000,
      });
    },
    stop() {
      state.latestFix = null;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    },
  };
}
