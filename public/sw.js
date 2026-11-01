// Lets the phone page open with no internet. Network first (so updates arrive as soon as there
// is a connection), falling back to the last saved copy. Data requests (/api) are never cached.
const CACHE = 'fo-tracker-shell-v1';
const SHELL = [
  '/device.html',
  '/css/device.css',
  '/js/device/main.js',
  '/js/device/api.js',
  '/js/device/checkinSheet.js',
  '/js/device/config.js',
  '/js/device/dom.js',
  '/js/device/ids.js',
  '/js/device/outbox.js',
  '/js/device/photo.js',
  '/js/device/plan.js',
  '/js/device/storage.js',
  '/js/device/sync.js',
  '/js/device/tracker.js',
  '/js/device/ui.js',
  '/js/shared/dom.js',
  '/js/shared/geo.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Only the phone page and its files. Anything else (the supervisor dashboard!) is never touched or stored.
  const isPage = request.mode === 'navigate' && (url.pathname === '/device' || url.pathname === '/device.html');
  if (!isPage && !SHELL.includes(url.pathname)) return;
  const key = isPage ? '/device.html' : request;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(key, copy));
        }
        return response;
      })
      .catch(() => caches.match(key))
  );
});
