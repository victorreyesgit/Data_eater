// Caches the app shell and handles the background download + notifications.
// Downloaded data is NOT kept: the browser drops it when these handlers finish.
const CACHE = "data-eater-v6";
const FILES = ["./", "index.html", "style.css", "script.js", "manifest.json", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))));
self.addEventListener("fetch", e => {
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

const gb = b => (b / 1e9).toFixed(2) + " GB";
const notify = body => self.registration.showNotification("Data Eater", { body, icon: "icon-192.png", badge: "icon-192.png", tag: "data-eater" });

self.addEventListener("backgroundfetchsuccess", e => e.waitUntil(notify("Done: " + gb(e.registration.downloaded) + " downloaded")));
self.addEventListener("backgroundfetchfail", e => e.waitUntil(notify("Failed after " + gb(e.registration.downloaded))));
self.addEventListener("backgroundfetchabort", e => e.waitUntil(notify("Stopped at " + gb(e.registration.downloaded))));
self.addEventListener("backgroundfetchclick", e => e.waitUntil(clients.openWindow("./")));
self.addEventListener("notificationclick", e => { e.notification.close(); e.waitUntil(clients.openWindow("./")); });
