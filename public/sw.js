/**
 * App-shell service worker.
 *
 * SAFETY RULE: only same-origin GET navigations and static assets are cached.
 * Requests to product data providers (cross-origin) are always passed straight
 * to the network so allergen information is never served from a stale cache.
 */

const CACHE_NAME = 'allergicguard-shell-v1';

// The app may be hosted under a sub-path (GitHub Pages), so every shell URL is
// resolved against the directory this worker was served from.
const BASE = new URL('./', self.location.href).href;
const INDEX_URL = `${BASE}index.html`;
const APP_SHELL = [BASE, INDEX_URL, `${BASE}manifest.webmanifest`];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Never touch provider APIs.

  // Network-first: always prefer a fresh app build, fall back to cache offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match(INDEX_URL))),
  );
});
