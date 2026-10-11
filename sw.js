// Offline shell: serve the app files from cache, fetch updates in the background.
const CACHE = "cards-v4";
const FILES = ["./", "index.html", "style.css", "app.js", "manifest.json", "icon.svg"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;            // never cache GitHub API calls
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => hit);
    return hit || net;
  }));
});
