// Minimal service worker — required for installable PWA on most platforms.
// Network-first strategy: always try the network (data is constantly
// changing — production schedule, weather, jobs). Falls back to cache
// for the app shell when offline so the dashboard at least loads.

const CACHE_VERSION = "cc-prod-v11-multi-touch";
const APP_SHELL = ["/", "/production", "/leads", "/focus", "/login"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only handle GETs for HTML/CSS/JS/images/font. Skip API + non-GET.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache successful responses for the app shell paths
        if (res.ok && APP_SHELL.includes(url.pathname)) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
