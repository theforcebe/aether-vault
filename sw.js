// Aether Vault service worker: offline vault browsing.
// Same-origin: network-first (deploys stay instant), cache fallback offline.
// Card images: cache-first with a size cap. APIs (Scryfall search/collection,
// GitHub sync, EDHREC) are never intercepted; sync must always hit the network.

const VERSION = 'av-v6';
const APP_CACHE = VERSION + '-app';
const IMG_CACHE = VERSION + '-img';
const CORE = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/scryfall.js', 'js/rules.js', 'js/vector.js', 'js/analyze.js', 'js/builder.js',
  'js/pilot.js', 'js/store.js', 'js/sync.js', 'js/ui.js', 'js/app.js',
  'data/collection.js', 'data/cards.js', 'data/decks.js', 'data/manifest.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(APP_CACHE)
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimCache(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => c.delete(k)));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // network-first so deploys land immediately; cache keeps offline working
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(APP_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
    );
    return;
  }

  if (url.hostname === 'cards.scryfall.io') {
    // card art rarely changes: cache-first, capped
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(IMG_CACHE).then((c) => c.put(req, copy)).then(() => trimCache(IMG_CACHE, 600));
        }
        return res;
      }))
    );
  }
  // every other origin (api.scryfall.com, api.github.com, edhrec, fonts) passes through untouched
});
