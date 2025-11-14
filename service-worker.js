const CACHE_NAME = "d30pwa-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./printer.js",
  "./ui.js",
  "./manifest.json",
  "./icons/icon-256.png",
  "./icons/icon-maskable.png",
  "./icons/icon-monochrome.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const asset of ASSETS) {
      try {
        await cache.add(asset);
      } catch (e) {
        console.warn("SW: skipping asset", asset, e && e.message);
      }
    }
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null));
  })());
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(caches.match(event.request).then(resp => resp || fetch(event.request)));
});
