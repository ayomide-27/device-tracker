import { CFG } from './config.js';

// Talks to the server. Resolves with {status, ok, data} for ANY HTTP answer (even errors);
// rejects only when the network failed or the server took too long.
async function request(method, path, { identity, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CFG.REQUEST_TIMEOUT_MS);
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (identity?.key) headers['x-device-key'] = identity.key;
  try {
    const response = await fetch(path, {
      method,
      headers,
      signal: controller.signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, data };
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health: () => request('GET', '/api/health'),
  postLocations: (identity, points) =>
    request('POST', '/api/locations', { identity, body: { deviceId: identity.deviceId, label: identity.label, points } }),
  postCheckin: (identity, checkin) =>
    request('POST', '/api/checkins', { identity, body: { deviceId: identity.deviceId, label: identity.label, ...checkin } }),
  getPlan: (identity) => request('GET', `/api/my-plan?deviceId=${encodeURIComponent(identity.deviceId)}`, { identity }),
};
