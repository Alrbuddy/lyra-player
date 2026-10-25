/* Lyra service worker — cache-first, fully offline. Bump VERSION after any cached-file change. */
const VERSION = "v28";
const CACHE = "lyra-" + VERSION;

const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "db.js",
  "id3.js",
  "player.js",
  "lyrics-sync.js",
  "app.js",
  "manifest.webmanifest",
  "vendor/jsmediatags.min.js",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Fetch every asset past the HTTP cache. plain addAll() reuses whatever the
    // browser already had, so a brand new VERSION could still be filled with
    // the previous build's app.js — a phone would then run mixed versions.
    await Promise.all(ASSETS.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: "reload" }));
        if (res && res.ok) await cache.put(url, res);
      } catch (err) { /* keep whatever we have rather than failing install */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // The worker script itself must come from the network, never from cache —
  // Settings reads its VERSION to tell you which build is deployed.
  if (new URL(e.request.url).pathname.endsWith("/sw.js")) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        if (res && res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      });
    })
  );
});
