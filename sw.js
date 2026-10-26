// Medicine Shelf offline support.
// Each version of the app is stored as one complete set of files under its own name (CACHE). A phone keeps
// using its current set until the person taps "Reload now" on the "new version is ready" banner, then
// switches to the whole new set at once, so an old page never runs with newer files.
// When you change any file, raise the version number at the end of CACHE by one (v12 -> v13).
const CACHE = 'medicine-shelf-v13';
const FILES = ['./', './index.html', './shelf-math.js', './app.js', './flyer.html', './flyer.js', './qrcode.js', './install-guide.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's own HTTP cache (GitHub Pages lets it keep files ~10 minutes),
  // so the new set holds the new files, not stale copies of the old ones. If any file fails, the whole
  // install fails and the phone keeps the version it has.
  // No skipWaiting() here: a new version waits until the page asks for it (see the 'message' handler).
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

// The page sends 'skipWaiting' when the person taps "Reload now".
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Remove older sets, then take over open pages (only matters on the very first install).
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('medicine-shelf-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Serve this version's own files. Nothing is refreshed in the background: a file only changes when a whole
// new version is installed.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    // Not part of the app (or the set isn't stored yet): use the network; offline page loads get the app page.
    try { return await fetch(req); }
    catch (e) { return req.mode === 'navigate' ? (await cache.match('./index.html')) || Response.error() : Response.error(); }
  })());
});
