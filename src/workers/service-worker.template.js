/*
 * Service worker de VibeCAD (généré au build par scripts/vite-plugin-offline.ts).
 * Met en cache tous les fichiers de l'application, y compris le noyau WASM, pour permettre
 * un fonctionnement complet sans réseau après la première visite. Aucune donnée de projet
 * ne transite par ce fichier : les projets restent dans IndexedDB.
 */
const CACHE_VERSION = '__VIBECAD_CACHE_VERSION__';
const CACHE_NAME = `vibecad-${CACHE_VERSION}`;
const PRECACHE_URLS = __VIBECAD_PRECACHE_URLS__;

async function broadcast(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) client.postMessage(message);
}

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  let done = 0;
  const total = PRECACHE_URLS.length;
  await broadcast({ type: 'precache-progress', done, total });
  for (const url of PRECACHE_URLS) {
    const request = new Request(url, { cache: 'reload' });
    const response = await fetch(request);
    if (!response.ok) throw new Error(`${url} : ${response.status}`);
    await cache.put(request, response);
    done++;
    await broadcast({ type: 'precache-progress', done, total });
  }
}

async function isComplete() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  return keys.length >= PRECACHE_URLS.length;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precache().catch(async (err) => {
      await broadcast({ type: 'precache-error', message: String(err && err.message ? err.message : err) });
      throw err;
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('vibecad-') && key !== CACHE_NAME) await caches.delete(key);
      }
      await self.clients.claim();
      if (await isComplete()) await broadcast({ type: 'precache-complete', version: CACHE_VERSION });
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'status') {
    event.waitUntil(
      isComplete().then((ok) =>
        event.source && event.source.postMessage({ type: ok ? 'status-ready' : 'status-not-ready', version: CACHE_VERSION }),
      ),
    );
  } else if (data.type === 'skip-waiting') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      if (request.mode === 'navigate') {
        const cached = await cache.match('index.html', { ignoreSearch: true, ignoreVary: true });
        try {
          const fresh = await fetch(request);
          return fresh.ok ? fresh : cached || fresh;
        } catch {
          if (cached) return cached;
          throw new Error('Hors ligne et page absente du cache');
        }
      }
      const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
      if (cached) return cached;
      return fetch(request);
    })(),
  );
});
