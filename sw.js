const CACHE_NAME = 'd30-pwa-v34';

// Explicit filenames without the ./ prefix to prevent cache-key mismatches
const ASSETS = [
  'index.html',
  'printer.js',
  'ui.js',
  'manifest.json',
  'styles/tailwind.css',
  'icons/icon-256.png',
  'icons/icon-maskable.png',
  'icons/icon-monochrome.png',
  'libs/JsBarcode.all.min.js',
  'libs/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/bwip-js@3.4.3/dist/bwip-js-min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        ASSETS.map((url) => {
          return fetch(url).then((response) => {
            if (response.ok) {
              return cache.put(url, response);
            }
          }).catch((err) => {
            console.warn('SW: Failed to pre-cache', url, err);
          });
        })
      );
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

  const url = new URL(e.request.url);
  let requestToMatch = e.request;

  // CRITICAL FIX: If Chrome requests the root folder OR specifically navigates, 
  // FORCE it to look for the exact 'index.html' cache key.
  if (url.origin === location.origin && (url.pathname === '/D30printerPWA/' || url.pathname === '/D30printerPWA')) {
    requestToMatch = new Request('index.html');
  } else if (e.request.mode === 'navigate') {
    requestToMatch = new Request('index.html');
  }

  e.respondWith(
    caches.match(requestToMatch, { ignoreSearch: true }).then((cachedResponse) => {
      
      // 1. Serve from cache
      if (cachedResponse) {
        return cachedResponse;
      }

      // 2. Fetch from network and dynamically cache
      return fetch(e.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch((err) => {
        // 3. Fallback for offline mode if all else fails
        if (e.request.mode === 'navigate' || e.request.headers.get('accept').includes('text/html')) {
          return caches.match('index.html', { ignoreSearch: true });
        }
        throw err;
      });
    })
  );
});
