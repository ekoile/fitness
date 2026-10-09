// Offline support: cache the whole app on install, serve it cache-first.
// Bump VERSION whenever any app file changes so phones pick up the update.
const VERSION = 'liftlog-v1.2.1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/logic.js',
  './js/store.js',
  './js/chart.js',
  './js/audio.js',
  './js/metronome.js',
  './icons/icon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache so we never store stale files.
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))),
  );
  // Take over straight away instead of waiting for every window of the app to close
  // (an installed iPhone app may never fully close, so the update would never apply).
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    }),
  );
});
