const assets = [
    "/D30printerPWA/",
    "/D30printerPWA/index.html",
    "/D30printerPWA/js/app.js",
    "/D30printerPWA/dist/esc-pos-encoder.js",
    "/D30printerPWA/images/icons/printer-outline.png"
];

const CACHE_NAME = 'd30-pwa-cache-v7'; // Incremented cache name

self.addEventListener("install", (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Service Worker: Caching Files');
            return cache.addAll(assets);
        })
    );
});

self.addEventListener("activate", (e) => {
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

self.addEventListener("fetch", (e) => {
    e.respondWith(
        caches.match(e.request).then((response) => {
            return response || fetch(e.request);
        })
    );
});
