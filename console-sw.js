// Offline cache for the eDNA Collector Console (console.html only — scope "/console").
// Network first, so updates arrive when online; falls back to the cached copy in the field.
// Only same-origin files are handled (Google Fonts fall back to system fonts offline).
const CACHE = 'ck-console-v5';
const CORE = [
  'console.html', 'css/app.css',
  'js/main.js', 'js/views.js', 'js/store.js', 'js/device.js', 'js/mission.js', 'js/sim.js', 'js/charts.js', 'js/map.js', 'js/util.js',
  'js/scene.js', 'js/scene3d.js', 'js/schematic.js', 'js/motion.js',
  'vendor/gsap/gsap.min.js', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/qrcode/qrcode.js',
  'vendor/three/three.module.js',
  'assets/canopy-keepers-logo.svg', 'assets/favicon.svg', 'docs/sample-results.csv',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('ck-console-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // tiles, fonts: let the browser handle them
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(req, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') { const page = await cache.match('console.html'); if (page) return page; }
      throw err;
    }
  })());
});
