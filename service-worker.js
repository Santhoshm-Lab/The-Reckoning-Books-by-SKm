/* The Reckoning Books - service worker
   Caches the app shell (index.html + install assets) for instant loads and basic offline
   access. Deliberately does NOT intercept Firebase Auth/Firestore requests (any cross-origin
   request passes straight through) and always prefers a fresh copy of the app over the
   cached one when online, so a redeploy is never masked by a stale cache.

   Bump CACHE_NAME (e.g. -v2) whenever you want to force every visitor's old cache to be
   dropped on their next visit -- otherwise this file's own content-hash-based update check
   (built into the browser's service worker lifecycle) handles updates automatically. */
const CACHE_NAME = 'reckoning-books-shell-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {}) // offline-during-install or a missing asset should never break install
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((names) =>
        Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
      ),
      self.clients.claim(),
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never cache/intercept writes

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let Firebase/Firestore/auth calls pass straight through

  if (req.mode === 'navigate' || req.destination === 'document') {
    // Network-first for the app document itself: online visitors always get the latest
    // deploy; the cached shell is only an offline fallback, never a stale trap.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Same-origin static assets (icons, manifest): serve from cache instantly, refresh in
  // the background so the next load picks up any change.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
