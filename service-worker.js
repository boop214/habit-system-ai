/**
 * service-worker.js — Offline-first cache for Habit System AI PWA.
 *
 * Strategy: cache-first for static assets, network-first for navigation.
 * IndexedDB remains the source of truth for user data (habits, events, etc.).
 * This SW only caches the application shell (HTML, JS, CSS, icons, manifest).
 */

const CACHE_NAME = "habit-system-v1";

const PRECACHE_URLS = [
  "/",
  "/static/manifest.webmanifest",
  "/static/css/styles.css",
  "/static/js/periods.js",
  "/static/js/db.js",
  "/static/js/stats.js",
  "/static/js/obstacles.js",
  "/static/js/semantics.js",
  "/static/js/identity.js",
  "/static/js/seed.js",
  "/static/js/services.js",
  "/static/js/api.js",
  "/static/js/format.js",
  "/static/js/charts.js",
  "/static/js/app.js",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
];

/* ---- Install: pre-cache app shell ---- */

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

/* ---- Activate: clean old caches ---- */

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
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

/* ---- Fetch: cache-first for same-origin static assets ---- */

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== "GET") return;

  // Only handle same-origin requests
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation requests: try network first, fall back to cached index.html
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // Static assets: cache-first, then network
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Cache successful responses for same-origin static assets
        if (response.ok && url.pathname.startsWith("/static/")) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
