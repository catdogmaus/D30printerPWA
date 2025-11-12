const assets = [
    "/D30printerPWA/",
    "/D30printerPWA/index.html",
    "/D30printerPWA/js/app.js",
    "/D30printerPWA/css/style.css",
    "/D30printerPWA/dist/esc-pos-encoder.js",
    "/D30printerPWA/images/icons/icon-72x72.png",
    "/D30printerPWA/images/icons/icon-96x96.png",
    "/D30printerPWA/images/icons/icon-128x128.png",
    "/D30printerPWA/images/icons/icon-144x144.png",
    "/D30printerPWA/images/icons/icon-152x152.png",
    "/D30printerPWA/images/icons/icon-192x192.png",
    "/D30printerPWA/images/icons/icon-384x384.png",
    "/D30printerPWA/images/icons/icon-512x512.png"
];

// install event
self.addEventListener("install", (e) => {
    e.waitUntil(
        caches.open("static").then((cache) => {
            return cache.addAll(assets);
        })
    );
});

// PWA CRITICAL: A fetch event handler is required for the browser to prompt installation
self.addEventListener("fetch", (e) => {
    e.respondWith(
        caches.match(e.request).then((response) => {
            return response || fetch(e.request);
        })
    );
});
