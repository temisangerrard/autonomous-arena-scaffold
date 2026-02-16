const CACHE_NAME = 'arena-world-cache-v1';
const META_URL = 'https://world-cache.local/__meta__';
const MAX_WORLDS = 2;
const WORLD_GCS_HOST = 'storage.googleapis.com';

function isWorldRequest(url, selfOrigin) {
  if (!url || !url.pathname || !url.pathname.endsWith('.glb')) {
    return false;
  }
  if (url.origin === selfOrigin && url.pathname.startsWith('/assets/world/')) {
    return true;
  }
  if (url.hostname === WORLD_GCS_HOST && url.pathname.includes('/world/')) {
    return true;
  }
  return false;
}

function worldKeyFromUrl(url) {
  const path = String(url.pathname || '');
  const name = path.split('/').pop() || '';
  return name.toLowerCase();
}

async function readMeta(cache) {
  try {
    const response = await cache.match(META_URL);
    if (!response) return { lru: {} };
    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || !payload.lru || typeof payload.lru !== 'object') {
      return { lru: {} };
    }
    return payload;
  } catch {
    return { lru: {} };
  }
}

async function writeMeta(cache, meta) {
  const body = JSON.stringify(meta || { lru: {} });
  await cache.put(
    META_URL,
    new Response(body, {
      headers: { 'content-type': 'application/json; charset=utf-8' }
    })
  );
}

async function touchKey(cache, key) {
  const meta = await readMeta(cache);
  meta.lru = meta.lru || {};
  meta.lru[key] = Date.now();
  await writeMeta(cache, meta);
}

async function enforceLimit(cache) {
  const keys = await cache.keys();
  const meta = await readMeta(cache);
  const lru = meta.lru || {};
  const worldRequests = keys.filter((req) => {
    const value = String(req.url || '');
    return value !== META_URL && value.includes('.glb');
  });

  if (worldRequests.length <= MAX_WORLDS) {
    return;
  }

  const sorted = worldRequests
    .map((req) => {
      const key = worldKeyFromUrl(new URL(req.url));
      return { req, key, ts: Number(lru[key] || 0) };
    })
    .sort((a, b) => a.ts - b.ts);

  const removeCount = Math.max(0, sorted.length - MAX_WORLDS);
  for (let i = 0; i < removeCount; i += 1) {
    const item = sorted[i];
    if (!item) continue;
    await cache.delete(item.req);
    delete lru[item.key];
    console.debug('[world-cache] evict', item.key);
  }

  await writeMeta(cache, { lru });
}

self.addEventListener('install', (event) => {
  console.debug('[world-cache] install');
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  console.debug('[world-cache] activate');
  event.waitUntil((async () => {
    await self.clients.claim();
    const cache = await caches.open(CACHE_NAME);
    await enforceLimit(cache);
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!request || request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (!isWorldRequest(url, self.location.origin)) {
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const key = worldKeyFromUrl(url);
    const cached = await cache.match(request, { ignoreSearch: false });

    if (cached) {
      console.debug('[world-cache] hit', url.toString());
      await touchKey(cache, key);
      event.waitUntil((async () => {
        try {
          const network = await fetch(request);
          if (network && (network.ok || network.type === 'opaque')) {
            await cache.put(request, network.clone());
            await touchKey(cache, key);
            await enforceLimit(cache);
            console.debug('[world-cache] update', url.toString());
          }
        } catch (error) {
          console.warn('[world-cache] revalidate_error', String(error || 'unknown'));
        }
      })());
      return cached;
    }

    console.debug('[world-cache] miss', url.toString());
    try {
      const network = await fetch(request);
      if (network && (network.ok || network.type === 'opaque')) {
        await cache.put(request, network.clone());
        await touchKey(cache, key);
        await enforceLimit(cache);
      }
      return network;
    } catch (error) {
      console.error('[world-cache] error', String(error || 'unknown'));
      throw error;
    }
  })());
});
