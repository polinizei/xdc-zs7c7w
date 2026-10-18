// XDC - sw.js | Offline-Cache (Cache-first). Version anheben = neuer Cache.
const XDC_CACHE = 'xdc-v0.5.1';
const FILES = [
  './',
  './index.html',
  './impressum.html',
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
  './js/core/vision.js',
  './js/core/axes.js',
  './js/core/curves.js',
  './js/core/ocr.js',
  './js/core/autopilot.js',
  './js/ui/overlay.js',
  './js/ui/viewer.js',
  './js/ui/capture.js',
  './js/ui/analyse.js',
  './js/ui/app.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract/tesseract-core-lstm.wasm.js',
  './vendor/tesseract/eng.traineddata.gz'
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

// Seite und App-Code: Netz zuerst (Updates sofort sichtbar), offline aus dem Cache.
// Grosse unveraenderliche Bibliotheken (vendor/): Cache zuerst.
self.addEventListener('fetch', ev => {
  if (ev.request.method !== 'GET') return;
  const url = new URL(ev.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/vendor/')) {
    ev.respondWith(caches.match(ev.request).then(hit => hit || fetch(ev.request)));
    return;
  }
  ev.respondWith(
    fetch(ev.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(XDC_CACHE).then(c => c.put(ev.request, copy)); }
      return res;
    }).catch(() => caches.match(ev.request))
  );
});
