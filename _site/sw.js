/* Geospatial Webhook service worker.
   Strategy:
     - Precache the app shell on install.
     - For navigation requests: network-first with cache fallback (so updates
       propagate quickly, offline still works).
     - For static assets (css/js/img/font): stale-while-revalidate.
     - Avoid caching HTML POSTs or cross-origin requests we don't control.
*/

const VERSION = 'v1';
const SHELL_CACHE = `shell-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/offline/',
  '/assets/css/site.css',
  '/assets/js/site.js',
  '/assets/img/logo.svg',
  '/favicon.svg',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

const isStaticAsset = (url) =>
  /\.(?:css|js|svg|png|jpg|jpeg|gif|webp|ico|woff2?)$/i.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: network-first.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        } catch (err) {
          const cached = await caches.match(req);
          if (cached) return cached;
          const offline = await caches.match('/offline/');
          return offline || new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);
        const fetchPromise = fetch(req)
          .then((resp) => {
            if (resp && resp.status === 200) cache.put(req, resp.clone());
            return resp;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })()
    );
  }
});
