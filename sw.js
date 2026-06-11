const CACHE_NAME = 'd30-pwa-v50';

// ONLY cache local, guaranteed files during the install phase.
// External CDNs (fonts, bwip-js) are removed from here to prevent CORS failures blocking the install.
const CORE_ASSETS = [
  './',
  './index.html',
  './printer.js',
  './ui.js',
  './manifest.json',
  './styles/tailwind.css',
  './icons/icon-256.png',
  './icons/icon-maskable.png',
  './icons/icon-monochrome.png',
  './libs/JsBarcode.all.min.js',
  './libs/qrcode.min.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS);
    })
  );
});

self.addEventListener('activate', (e) => {
  self.clients.claim();
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    })
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cachedResponse) => {
      // 1. Serve from cache immediately if we have it
      if (cachedResponse) {
        return cachedResponse;
      }

      // 2. If not in cache, try network
      return fetch(e.request).then((networkResponse) => {
        // Dynamically cache everything else (like fonts and bwip-js) as it loads
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch((err) => {
        // 3. ULTIMATE OFFLINE FALLBACK:
        // If the network fails AND the user is navigating to the app, force load index.html
        if (e.request.mode === 'navigate' || e.request.headers.get('accept').includes('text/html')) {
          return caches.match('./index.html', { ignoreSearch: true });
        }
        throw err;
      });
    })
  );
});
