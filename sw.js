const CACHE_NAME = 'd30-pwa-v33';

// List of core assets to try caching immediately
const ASSETS = [
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
  './libs/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/bwip-js@3.4.3/dist/bwip-js-min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap'
];

self.addEventListener('install', (e) => {
  self.skipWaiting(); // Force the new SW to activate immediately
  
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Bulletproof Caching: Fetch files individually. 
      // If one fails (e.g. a missing icon), it won't crash the whole offline system.
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
  // Claim control of all open windows immediately
  self.clients.claim();
  
  // Cleanup old caches
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
  // Only intercept GET requests
  if (e.request.method !== 'GET') return;

  e.respondWith(
    // ignoreSearch: true prevents issues if Android adds ?utm_source=homescreen to the URL
    caches.match(e.request, { ignoreSearch: true }).then((cachedResponse) => {
      
      // 1. Serve from cache if we have it
      if (cachedResponse) {
        return cachedResponse;
      }

      // 2. If not in cache, fetch from network (Dynamic Caching)
      return fetch(e.request).then((networkResponse) => {
        // If the fetch was successful, save a copy in the cache for next time we are offline
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch((err) => {
        // 3. Fallback: If offline and the network fails, and the user is trying to navigate to the app
        if (e.request.mode === 'navigate') {
          return caches.match('./index.html', { ignoreSearch: true });
        }
        throw err;
      });
    })
  );
});
