
const CACHE_NAME = 'phomemo-d30-cache-v1';// 👈 any unique name

const urlsToCache = [
  "/D30printerPWA", // 👈 your repository name , both slash are important  
  './',
  './index.html',
  './vite.svg',
  './manifest.json',
  './icon-192x192.png',
  './icon-512x512.png',
  './index.tsx',
  './App.tsx',
  './types.ts',
  './components/Header.tsx',
  './components/ControlsPanel.tsx',
  './components/CanvasPreview.tsx',
  './components/Icons.tsx',
  './services/printerService.ts',
  './services/labelGenerator.ts',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
