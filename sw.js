/* SemesterOS service worker — app-shell cache with safe offline launch.
   All URLs are relative so the worker also works from a GitHub Pages
   project path such as https://user.github.io/SemesterOS/.

   Bump CACHE_VERSION whenever shell files change; old caches are removed
   on activation. */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `semesteros-shell-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/storage.js',
  './js/utils.js',
  './js/pwa.js',
  './js/courses.js',
  './js/tasks.js',
  './js/timetable.js',
  './js/grades.js',
  './js/study.js',
  './js/notes.js',
  './js/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('semesteros-shell-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

/* Navigations: fresh HTML when the network is available, cached shell when
   it is not (or when the connection stalls). */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetchWithTimeout(request, 4000);
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached =
      (await cache.match(request, { ignoreSearch: true })) ||
      (await cache.match('./index.html')) ||
      (await cache.match('./'));

    if (cached) return cached;

    return new Response(
      '<!doctype html><meta charset="utf-8"><title>SemesterOS offline</title><body style="font-family:system-ui;background:#060912;color:#e9edfb;padding:2rem"><h1>SemesterOS is offline</h1><p>This page was not cached yet. Reconnect and reload once to finish installing the offline app shell.</p></body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

/* Static assets: serve the cached copy immediately, refresh it in the
   background for the next visit. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const response = await network;
  if (response) return response;

  return new Response('', {
    status: 504,
    statusText: 'SemesterOS is offline and this file is not cached'
  });
}

function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}
