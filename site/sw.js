// Service worker for the WDF Reader PWA (plan T8.1): cache-first for the app
// shell so the installed reader works fully offline. Documents themselves are
// never fetched by the app (they arrive via file handler, drop, or ?doc=
// same-site links, which pass through untouched when offline caching misses).
const CACHE = 'wdf-reader-v1';
const SHELL = [
  'viewer.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(
      (cached) =>
        cached ??
        fetch(event.request).then((response) => {
          // Opportunistically refresh shell entries.
          const url = new URL(event.request.url);
          const path = url.pathname.split('/').pop() ?? '';
          if (response.ok && SHELL.some((s) => s.endsWith(path))) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        }),
    ),
  );
});
