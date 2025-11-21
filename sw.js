const CACHE_NAME = 'd30-pwa-v10'; // Incremented version
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
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keyList) => {
        return Promise.all(keyList.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        }));
      })
    ])
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => response || fetch(e.request))
  );
});
