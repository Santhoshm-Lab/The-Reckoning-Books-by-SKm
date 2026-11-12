// The Reckoning Books by SKm — service worker
// Two jobs: (1) basic app-shell caching so the PWA has something to show offline-ish, with a
// network-first strategy for the HTML document itself so a fresh deploy is never masked by a stale
// cache; (2) the PWA Share Target handler, so "The Reckoning Books" can appear as a destination when
// someone shares a photo (e.g. a receipt from WhatsApp) from their phone's share sheet — see
// manifest.json's share_target block and index.html's openSharedReceiptIntoScan().

const CACHE_NAME = 'rb-shell-v3'; // bump this string on any future shell-asset change to bust old caches
const SHARE_CACHE_NAME = 'rb-share-target';
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS)).catch(()=>{ /* best-effort — a missing icon file shouldn't block install */ })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names.filter(n => n !== CACHE_NAME && n !== SHARE_CACHE_NAME).map(n => caches.delete(n))
    ))
  );
  self.clients.claim();
});

// The Share Target POST — the browser sends the shared image (and whatever title/text accompanied
// it) as multipart/form-data straight to manifest.json's share_target.action, which is this same
// origin/scope, so no special hosting route or rewrite is needed: this fetch handler answers it
// directly without ever touching the network. The file is stashed in a dedicated cache (not
// IndexedDB — simplest thing that can hold a Blob) for index.html to retrieve once a company is open
// (see openSharedReceiptIntoScan()), then the browser is redirected back into the app as a normal GET
// so the page loads exactly as it would from any other link.
async function handleShareTarget(event){
  try{
    const formData = await event.request.formData();
    const file = formData.get('image');
    if(file){
      const cache = await caches.open(SHARE_CACHE_NAME);
      await cache.put('/shared-receipt', new Response(file, { headers: { 'Content-Type': file.type || 'image/jpeg' } }));
    }
  }catch(e){ /* best-effort — a share-target hiccup just means the user scans manually instead */ }
  return Response.redirect('./?shared-receipt=1', 303);
}

// Clicking a local notification (see index.html's showLocalNotification()) focuses an already-open
// app window/tab if one exists, or opens a new one otherwise, rather than doing nothing.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for(const client of clientList){
        if('focus' in client) return client.focus();
      }
      if(self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const scopePath = new URL(self.registration.scope).pathname;

  // Share Target: a POST to our own scope carrying the shared file.
  if(event.request.method === 'POST' && url.pathname === scopePath){
    event.respondWith(handleShareTarget(event));
    return;
  }

  if(event.request.method !== 'GET') return; // let everything else (Firestore, Google Fonts, etc.) go straight to the network, untouched

  // Network-first for the HTML document itself, so a redeploy is live immediately rather than
  // masked by a stale cached shell; falls back to the cached copy only when offline.
  if(event.request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname === scopePath){
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          // Only a genuine, successful same-origin page may become the offline copy -- never an
          // error page, an opaque/redirected response or anything from another origin.
          if(resp && resp.ok && resp.type === 'basic'){
            const copy = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy)).catch(()=>{});
          }
          return resp;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Everything else same-origin (icons, manifest): cache-first, falling back to network.
  if(url.origin === self.location.origin){
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  }
});
