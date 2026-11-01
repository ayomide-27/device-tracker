// The phone's outbox: GPS points and check-ins wait here until the server confirms them.
// Stored in IndexedDB (survives closing the page and has room for photos). If the browser
// refuses IndexedDB (some private modes), a memory-only copy is used and the page says so.

const DB_NAME = 'fot-outbox';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('points', { keyPath: 't' }); // one point per GPS timestamp
      db.createObjectStore('visits', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

// Runs fn(stores) inside one transaction; fn may return a request whose result is handed back.
function inTransaction(db, names, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    const stores = Object.fromEntries(names.map((n) => [n, tx.objectStore(n)]));
    const request = fn(stores);
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function indexedDbOutbox(db) {
  return {
    kind: 'indexeddb',
    addPoint: (point) => inTransaction(db, ['points'], 'readwrite', (s) => s.points.put(point)),
    takePoints: (limit) => inTransaction(db, ['points'], 'readonly', (s) => s.points.getAll(null, limit)),
    countPoints: () => inTransaction(db, ['points'], 'readonly', (s) => s.points.count()),
    removePoints: (times) =>
      inTransaction(db, ['points'], 'readwrite', (s) => {
        times.forEach((t) => s.points.delete(t));
      }),
    // Keeps at most `max` points by deleting the oldest.
    trimPoints: (max) =>
      inTransaction(db, ['points'], 'readwrite', (s) => {
        const counting = s.points.count();
        counting.onsuccess = () => {
          const excess = counting.result - max;
          if (excess <= 0) return;
          let removed = 0;
          const cursor = s.points.openCursor();
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (!c || removed >= excess) return;
            c.delete();
            removed += 1;
            c.continue();
          };
        };
      }),
    putVisit: (visit) => inTransaction(db, ['visits'], 'readwrite', (s) => s.visits.put(visit)),
    allVisits: () => inTransaction(db, ['visits'], 'readonly', (s) => s.visits.getAll()),
    removeVisits: (ids) =>
      inTransaction(db, ['visits'], 'readwrite', (s) => {
        ids.forEach((id) => s.visits.delete(id));
      }),
  };
}

function memoryOutbox() {
  const points = new Map();
  const visits = new Map();
  return {
    kind: 'memory',
    addPoint: async (p) => void points.set(p.t, p),
    takePoints: async (limit) => [...points.values()].sort((a, b) => a.t - b.t).slice(0, limit),
    countPoints: async () => points.size,
    removePoints: async (times) => times.forEach((t) => points.delete(t)),
    trimPoints: async (max) => {
      const oldest = [...points.keys()].sort((a, b) => a - b).slice(0, Math.max(0, points.size - max));
      oldest.forEach((t) => points.delete(t));
    },
    putVisit: async (v) => void visits.set(v.id, v),
    allVisits: async () => [...visits.values()],
    removeVisits: async (ids) => ids.forEach((id) => visits.delete(id)),
  };
}

export async function createOutbox() {
  try {
    return indexedDbOutbox(await openDb());
  } catch {
    return memoryOutbox();
  }
}
