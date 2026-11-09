// Caches only the app shell so it opens offline. Downloads are never cached.
const CACHE = "data-eater-v3";
const FILES = ["./", "index.html", "style.css", "script.js", "manifest.json", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))));
self.addEventListener("fetch", e => {
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
