// The ambiguous directory path has been removed from this list.
const assets = [
    "/D30printerPWA/index.html",
    "/D30printerPWA/js/app.js",
    "/D30printerPWA/dist/esc-pos-encoder.js"
];

self.addEventListener("install", (e) => {
    e.waitUntil(
        caches.open("static").then((cache) => {
            return cache.addAll(assets);
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
