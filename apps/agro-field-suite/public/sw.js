/**
 * Service Worker AgroGea — modalità PWA (fallback quando l'app gira nel
 * browser fuori dalla WebView Tauri). Strategie:
 *   - WASM/Worker pesanti (DuckDB, PGlite): cache-first → offline guaranteed.
 *   - Tile cartografiche: stale-while-revalidate, limite 5 000 tile per
 *     origine per non saturare la quota di Cache Storage.
 *   - Shell HTML + JS/CSS: network-first con fallback cache.
 */

const SHELL_CACHE = "agrogea-shell-v1";
const WASM_CACHE = "agrogea-wasm-v1";
const TILE_CACHE = "agrogea-tiles-v1";
const MAX_TILE_ENTRIES = 5000;

const SHELL_ASSETS = [
  "/",
  "/index.html",
];

const WASM_ORIGINS = [
  "cdn.jsdelivr.net",
  "cdn.syncedstore.org",
];

const TILE_ORIGINS = [
  "tiles.openfreemap.org",
  "api.protomaps.com",
  "tile.openstreetmap.org",
  "services.arcgisonline.com",
];

// ─── Install: pre-cache shell ───────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

// ─── Activate: pulisce cache obsolete ───────────────────────────────────────
self.addEventListener("activate", (event) => {
  const valid = new Set([SHELL_CACHE, WASM_CACHE, TILE_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !valid.has(k)).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

// ─── Fetch: routing per strategia ───────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // WASM / worker binaries: cache-first (mai cambiano a parità di versione).
  if (
    url.pathname.endsWith(".wasm") ||
    url.pathname.endsWith(".worker.js") ||
    WASM_ORIGINS.some((o) => url.hostname.includes(o))
  ) {
    event.respondWith(cacheFirst(request, WASM_CACHE));
    return;
  }

  // Tile cartografiche: stale-while-revalidate con cap sulla dimensione cache.
  if (TILE_ORIGINS.some((o) => url.hostname.includes(o))) {
    event.respondWith(tileStrategy(request));
    return;
  }

  // Shell (HTML/JS/CSS): network-first con fallback cache.
  if (
    url.origin === self.location.origin &&
    (url.pathname === "/" ||
      url.pathname.endsWith(".html") ||
      url.pathname.endsWith(".js") ||
      url.pathname.endsWith(".css"))
  ) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? new Response("Offline", { status: 503 });
  }
}

async function tileStrategy(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(async (response) => {
    if (!response.ok) return response;
    // Mantieni il cap: elimina le entry più vecchie se necessario.
    const keys = await cache.keys();
    if (keys.length >= MAX_TILE_ENTRIES) {
      await cache.delete(keys[0]);
    }
    cache.put(request, response.clone());
    return response;
  }).catch(() => cached ?? new Response(null, { status: 503 }));
  return cached ?? fetchPromise;
}
