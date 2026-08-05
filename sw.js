// Aether Vault service worker: offline vault browsing.
// Same-origin: network-first with forced revalidation (GitHub Pages sends a
// 10-minute max-age; without no-cache the HTTP cache feeds the SW stale code
// right after a deploy). Cache fallback keeps offline working.
// Card images: cache-first with a size cap. APIs (Scryfall search/collection,
// GitHub sync, EDHREC) are never intercepted; sync must always hit the network.

const BUILD = '10';
const VERSION = 'av-v' + BUILD;
const APP_CACHE = VERSION + '-app';
const IMG_CACHE = VERSION + '-img';
const CORE = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css?v=' + BUILD,
  ...['scryfall', 'rules', 'vector', 'analyze', 'builder', 'pilot', 'store', 'sync', 'ui', 'app'].map((f) => 'js/' + f + '.js?v=' + BUILD),
  ...['collection', 'cards', 'decks', 'manifest'].map((f) => 'data/' + f + '.js?v=' + BUILD),
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(APP_CACHE)
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(new Request(u, { cache: 'no-cache' })))))
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
    // revalidate every time so deploys land immediately; cache keeps offline working
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
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
