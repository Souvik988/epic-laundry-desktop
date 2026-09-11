// Epic Laundry service worker: offline-capable, but network-first so UI/API updates always show.
// (Cache-first on HTML was hiding fresh pages during active development — network-first fixes that
// while still serving the last-known copy when truly offline.)
const SHELL = ['/ui/app/', '/ui/app/index.html', '/ui/manifest.webmanifest', '/ui/app/brand/lndry-mark.png'];
const CACHE = 'epic-laundry-ui-v1';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin) return;
  // Network-first: try the network, cache the fresh copy, fall back to cache only when offline.
  e.respondWith(
    fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return r; })
      .catch(() => caches.match(req)),
  );
});
