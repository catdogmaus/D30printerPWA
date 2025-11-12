let cacheName = "D30printerPWA";// 👈 any unique name

let filesToCache = [
  "/D30printerPWA", // 👈 your repository name , both slash are important
  "service-worker.js",
  '/',
  '/index.html',
  '/index.tsx',
  '/App.tsx',
  '/types.ts',
  '/components/Header.tsx',
  '/components/ControlsPanel.tsx',
  '/components/CanvasPreview.tsx',
  '/components/Icons.tsx',
  '/services/printerService.ts',
  '/services/labelGenerator.ts',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js'
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(cacheName).then((cache) => {
    console.log('installed successfully')
    return cache.addAll(filesToCache);
  }));
});

self.addEventListener('fetch', function (event) {

  if (event.request.url.includes('clean-cache')) {
    caches.delete(cacheName);
    console.log('Cache cleared')
  }

  event.respondWith(caches.match(event.request).then(function (response) {
    if (response) {
      console.log('served form cache')
    } else {
      console.log('Not serving from cache ', event.request.url)
    }
    return response || fetch(event.request);
  })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keyList) {
      return Promise.all(keyList.map(function (key) {
        if (key !== cacheName) {
          console.log('service worker: Removing old cache', key);
          return caches.delete(key);
        }
      }));
    })
  );
  return self.clients.claim();
});
