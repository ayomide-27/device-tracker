// Calls to the server. Throws an Error with a readable message when the server says no.
async function call(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(response.status === 401 ? 'Login needed. Reload the page.' : data.error ?? `Server error (${response.status})`);
  }
  return data;
}

const query = (params) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== ''));
  return q.size ? `?${q}` : '';
};

export const api = {
  config: () => call('GET', '/api/config'),
  devices: () => call('GET', '/api/devices'),
  removeDevice: (id) => call('DELETE', `/api/devices/${encodeURIComponent(id)}`),
  route: (p) => call('GET', `/api/route${query(p)}`),
  visits: (p) => call('GET', `/api/visits${query(p)}`),
  visitsCsvUrl: (p) => `/api/visits.csv${query(p)}`,
  photoUrl: (id) => `/api/visits/${id}/photo`,
  sites: () => call('GET', '/api/sites'),
  updateSite: (id, body) => call('PATCH', `/api/sites/${id}`, body),
  archiveSite: (id) => call('DELETE', `/api/sites/${id}`),
  importSites: (body) => call('POST', '/api/sites/import', body),
  setPlan: (body) => call('PUT', '/api/plan', body),
  board: (p) => call('GET', `/api/plan/board${query(p)}`),
  boardCsvUrl: (p) => `/api/plan/board.csv${query(p)}`,
};
