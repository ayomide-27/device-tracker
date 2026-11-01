import { metresBetween } from '../shared/geo.js';
import { $ } from './dom.js';
import { compressPhoto } from './photo.js';

// The pop-up where an FO confirms a check-in: waits for a precise GPS fix, shows the distance
// from the site, takes an optional photo, and hands back a finished check-in record.
export function createCheckinSheet({ config, fixes, getAccuracyLimit, onSubmit }) {
  // fixes: { latest(): reading | null, subscribe(fn): unsubscribe, onError(fn): unsubscribe }
  const els = {
    root: $('sheet'),
    title: $('sheetTitle'),
    otherRow: $('otherRow'),
    placeName: $('placeName'),
    gpsDot: $('gpsDot'),
    gpsText: $('gpsText'),
    distance: $('distanceText'),
    photoBtn: $('photoBtn'),
    photoInput: $('photoInput'),
    photoPreview: $('photoPreview'),
    photoError: $('photoError'),
    confirm: $('confirmBtn'),
    cancel: $('cancelBtn'),
  };

  let session = null;

  const stopWatching = () => {
    session?.unsubscribe?.();
    clearInterval(session?.timer);
  };

  function close() {
    stopWatching();
    if (session?.previewUrl) URL.revokeObjectURL(session.previewUrl);
    session = null;
    els.root.hidden = true;
    document.body.classList.remove('sheet-open');
  }

  // The most recent reading that is precise enough, or else (after the wait) the most recent of any.
  function usableFix() {
    if (!session.latest) return null;
    const limit = getAccuracyLimit();
    if (session.latest.acc <= limit) return { fix: session.latest, weak: false };
    const waited = (Date.now() - session.openedAt) / 1000 >= config.CHECKIN_WAIT_SECONDS;
    return waited ? { fix: session.latest, weak: true } : null;
  }

  function render() {
    if (!session) return;
    const { latest, site } = session;
    const limit = getAccuracyLimit();
    const usable = usableFix();

    if (!latest) {
      els.gpsDot.className = 'dot warn';
      els.gpsText.textContent = 'Getting your GPS position…';
    } else if (latest.acc <= limit) {
      els.gpsDot.className = 'dot live';
      els.gpsText.textContent = `GPS ready (±${Math.round(latest.acc)} m)`;
    } else {
      els.gpsDot.className = 'dot warn';
      els.gpsText.textContent = `Weak GPS (±${Math.round(latest.acc)} m). Move to open sky and wait…`;
    }

    els.distance.textContent = '';
    if (site && latest) {
      const distance = Math.round(metresBetween(latest, site));
      els.distance.textContent =
        distance <= site.radiusM
          ? `You are ${distance} m from the site. Inside the ${site.radiusM} m check-in area.`
          : `You are ${distance} m from the site. The check-in area is ${site.radiusM} m.`;
    }

    const needsName = !site && !els.placeName.value.trim();
    els.confirm.disabled = !usable || needsName || session.busy;
    els.confirm.textContent = usable?.weak ? 'Check in anyway (weak GPS)' : 'Check in';
  }

  async function attachPhoto(file) {
    els.photoError.textContent = '';
    try {
      session.photo = await compressPhoto(file);
      if (session.previewUrl) URL.revokeObjectURL(session.previewUrl);
      session.previewUrl = URL.createObjectURL(session.photo);
      els.photoPreview.src = session.previewUrl;
      els.photoPreview.hidden = false;
      els.photoBtn.textContent = 'Retake photo';
    } catch {
      els.photoError.textContent = 'Could not use that photo. Try again, or check in without one.';
    }
  }

  function confirm() {
    const usable = usableFix();
    if (!usable) return;
    const { fix, weak } = usable;
    const { site } = session;

    if (site) {
      const distance = Math.round(metresBetween(fix, site));
      if (distance > site.radiusM) {
        const ok = globalThis.confirm(
          `You are ${distance} m from ${site.name}; the check-in area is ${site.radiusM} m.\n\nCheck in anyway? It will be marked "off site" for your supervisor.`
        );
        if (!ok) return;
      }
    }

    session.busy = true;
    onSubmit({
      id: session.id,
      siteId: site?.id ?? null,
      siteName: site?.name ?? null,
      placeName: site ? null : els.placeName.value.trim(),
      t: fix.t,
      lat: fix.lat,
      lng: fix.lng,
      acc: fix.acc,
      weak,
      photo: session.photo ?? null,
      state: 'pending',
      result: null,
    });
    close();
  }

  els.cancel.addEventListener('click', close);
  els.confirm.addEventListener('click', confirm);
  els.placeName.addEventListener('input', render);
  els.photoBtn.addEventListener('click', () => els.photoInput.click());
  els.photoInput.addEventListener('change', () => {
    const file = els.photoInput.files?.[0];
    els.photoInput.value = '';
    if (file && session) attachPhoto(file);
  });

  return {
    // site: {id, name, lat, lng, radiusM} for a planned site, or null for "another place".
    open(site, makeId) {
      if (session) close();
      session = { site, id: makeId(), latest: null, openedAt: Date.now(), photo: null, previewUrl: null, busy: false };
      els.title.textContent = site ? `Check in: ${site.name}` : 'Check in at another place';
      els.otherRow.hidden = Boolean(site);
      els.placeName.value = '';
      els.photoPreview.hidden = true;
      els.photoError.textContent = '';
      els.photoBtn.textContent = 'Add photo (optional)';
      els.root.hidden = false;
      document.body.classList.add('sheet-open');

      // Start from the latest reading if it is fresh, then follow new ones.
      const current = fixes.latest();
      if (current && Date.now() - current.t <= config.MAX_FIX_AGE_SECONDS * 1000) session.latest = current;
      session.unsubscribe = fixes.subscribe((fix) => {
        session.latest = fix;
        render();
      });
      // The weak-GPS option appears after the wait, even if no new reading arrives.
      session.timer = setInterval(render, 1000);
      render();
    },
    isOpen: () => session !== null,
  };
}
