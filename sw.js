const CACHE_NAME = 'd30-pwa-cache-v1';

// This list MUST include the start_url from the manifest ('/D30printerPWA/')
const assets = [
    '/D30printerPWA/',
    '/D30printerPWA/index.html',
    '/D30printerPWA/js/app.js',
    '/D30printerPWA/dist/esc-pos-encoder.js'
];

// install event: cache all assets
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Service Worker: Caching Files');
            return cache.addAll(assets);
        })
    );
});

// activate event: clear old caches
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        console.log('Service Worker: Clearing Old Cache');
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
});

// fetch event: serve from cache or fetch from network
self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((response) => {
            return response || fetch(e.request);
        })
    );
});
