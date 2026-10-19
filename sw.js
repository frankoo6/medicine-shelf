// Medicine Shelf offline support.
// When you change any file, bump CACHE (v1 -> v2) so phones pick up the new version.
const CACHE = 'medicine-shelf-v4';
const FILES = ['./', './index.html', './shelf-math.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('medicine-shelf-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Serve from the cache first so the app opens with no signal, then refresh the cache in the background.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // The background refresh (fetch + cache.put) is handed to waitUntil so the browser keeps the worker alive until it finishes.
  const fresh = fetch(req).then(async (res) => {
    if (res.ok && res.type === 'basic') { const cache = await caches.open(CACHE); await cache.put(req, res.clone()); }
    return res;
  });
  event.waitUntil(fresh.then(() => undefined, () => undefined));
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    // Not cached yet: use the network; if offline, fall back to the app page for page loads.
    try { return (await fresh).clone(); }
    catch (e) { return req.mode === 'navigate' ? (await cache.match('./index.html')) || Response.error() : Response.error(); }
  })());
});
