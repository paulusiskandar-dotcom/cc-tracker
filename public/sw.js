// Paulus Finance Service Worker
const CACHE_VERSION = 'pf-v1';
const OFFLINE_URL = '/offline.html';

// Install: precache offline page
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

// Activate: cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first, fallback to offline page for navigation requests only
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.mode !== 'navigate') return;

  event.respondWith(
    fetch(request).catch(() => caches.match(OFFLINE_URL))
  );
});
