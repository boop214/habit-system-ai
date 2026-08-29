const CACHE_NAME = "habit-system-v2";

const BASE = new URL("./", self.location).pathname;

const PRECACHE_URLS = [
  BASE,
  BASE + "manifest.webmanifest",
  BASE + "css/styles.css",
  BASE + "js/periods.js",
  BASE + "js/db.js",
  BASE + "js/stats.js",
  BASE + "js/obstacles.js",
  BASE + "js/semantics.js",
  BASE + "js/identity.js",
  BASE + "js/seed.js",
  BASE + "js/services.js",
  BASE + "js/api.js",
  BASE + "js/format.js",
  BASE + "js/charts.js",
  BASE + "js/app.js",
  BASE + "icons/icon-192.png",
  BASE + "icons/icon-512.png",
  BASE + "icons/icon-512-maskable.png",
  BASE + "icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(BASE)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(BASE))
    );
    return;
  }

  event.respondWith(
    caches.match(request)
      .then((cached) => {
        if (cached) return cached;

        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
  );
});
