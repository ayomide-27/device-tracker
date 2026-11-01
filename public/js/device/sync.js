import { blobToBase64 } from './photo.js';

// Sends what is waiting in the outbox to the server. Nothing leaves the phone's storage until
// the server has confirmed it, so a dropped connection never loses data.
export function createSync({ outbox, api, config, getIdentity, onChange }) {
  const state = { connection: 'unknown', lastUploadAt: 0, lastContactAt: 0, rejectedPoints: 0 };
  let running = false;

  const authFailed = (r) => r.status === 401 || r.status === 403;

  async function uploadPoints(force) {
    while (true) {
      const batch = await outbox.takePoints(config.BATCH_SIZE);
      const pingDue = Date.now() - state.lastContactAt >= config.PING_EVERY_SECONDS * 1000;
      if (batch.length === 0 && !force && !pingDue) return true;

      const response = await api.postLocations(getIdentity(), batch);
      if (authFailed(response)) {
        state.connection = 'rejected';
        return false;
      }
      if (response.status === 400 && batch.length > 0) {
        // The server will never accept this batch; drop it so the queue cannot get stuck.
        state.rejectedPoints += batch.length;
        await outbox.removePoints(batch.map((p) => p.t));
        continue;
      }
      if (!response.ok) {
        state.connection = 'offline';
        return false;
      }
      await outbox.removePoints(batch.map((p) => p.t));
      state.connection = 'ok';
      state.lastContactAt = Date.now();
      if (batch.length > 0) state.lastUploadAt = state.lastContactAt;
      if (batch.length < config.BATCH_SIZE) return true;
    }
  }

  async function uploadCheckins() {
    const waiting = (await outbox.allVisits()).filter((v) => v.state === 'pending').sort((a, b) => a.t - b.t);
    for (const visit of waiting) {
      const payload = {
        id: visit.id,
        siteId: visit.siteId,
        placeName: visit.placeName,
        t: visit.t,
        lat: visit.lat,
        lng: visit.lng,
        acc: visit.acc,
      };
      if (visit.photo) payload.photo = { mime: 'image/jpeg', data: await blobToBase64(visit.photo) };

      const response = await api.postCheckin(getIdentity(), payload);
      if (authFailed(response)) {
        state.connection = 'rejected';
        return;
      }
      if (response.status === 400) {
        // Will never be accepted (e.g. the site was removed). Keep it visible instead of retrying forever.
        await outbox.putVisit({ ...visit, photo: null, state: 'rejected', result: { error: response.data.error ?? 'Rejected' } });
        continue;
      }
      if (!response.ok) {
        state.connection = 'offline';
        return;
      }
      await outbox.putVisit({
        ...visit,
        photo: null, // the server has it now
        hadPhoto: Boolean(visit.photo),
        state: 'sent',
        result: { status: response.data.status, distanceM: response.data.distanceM },
      });
      state.lastUploadAt = Date.now();
    }
  }

  async function flush({ force = false } = {}) {
    if (running) return;
    running = true;
    try {
      if (await uploadPoints(force)) await uploadCheckins();
    } catch {
      state.connection = 'offline'; // no internet, or the server took too long
    } finally {
      running = false;
      onChange(state);
    }
  }

  return { state, flush };
}
