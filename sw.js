// XDC - sw.js | Offline-Cache (Cache-first). Version anheben = neuer Cache.
const XDC_CACHE = 'xdc-v0.1.0';
const FILES = [
  './',
  './index.html',
  './css/app.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './js/core/homography.js',
  './js/core/trace.js',
  './js/core/units.js',
  './js/core/model.js',
  './js/ui/overlay.js',
  './js/ui/viewer.js',
  './js/ui/capture.js',
  './js/ui/calibrate.js',
  './js/ui/traceui.js',
  './js/ui/app.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js'
];

self.addEventListener('install', ev => {
  ev.waitUntil(
    caches.open(XDC_CACHE).then(c =>
      Promise.allSettled(FILES.map(f => c.add(f))) // vendor darf fehlen
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== XDC_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ev => {
  if (ev.request.method !== 'GET') return;
  ev.respondWith(
    caches.match(ev.request).then(hit => hit || fetch(ev.request))
  );
});
