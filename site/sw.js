// Service worker for the WDF Reader PWA (plan T8.1): cache-first for the app
// shell so the installed reader works fully offline. Documents themselves are
// never fetched by the app (they arrive via file handler, drop, or ?doc=
// same-site links, which pass through untouched when offline caching misses).
const CACHE = 'wdf-reader-v1';
const SHELL = [
  'viewer.html',
  // Reader-only lazy assets (WP21 T21.2): PDF.js renders the author PDF
  // rendition (ext-source 0.5) in the Original view. Precached so the
  // installed Reader renders it fully offline; same-origin only.
  'pdfjs.js',
  'pdfjs-worker.js',
  // Reader typography (plan §10.62, §10.80): IBM Plex, lazy-injected by main.ts.
  'plex.css',
  'plex/IBMPlexSans-Variable.woff2',
  'plex/IBMPlexMono-400.woff2',
  'plex/IBMPlexMono-500.woff2',
  'plex/IBMPlexMono-600.woff2',
  // Converter (plan §10.80): the template a .wdf.html download is filled
  // into, so the installed Reader produces it offline too.
  'standalone-template.html',
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
          // path is '' for the site root: every string endsWith(''), which
          // would pin the landing page in the cache forever.
          if (response.ok && path !== '' && SHELL.some((s) => s.endsWith(path))) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        }),
    ),
  );
});
