// ApexTrack — service worker: funciona sin conexión y se actualiza solo.
const VERSION = 'apextrack-2.0.2';
const CORE = [
  './', './index.html', './manifest.webmanifest', './css/app.css', './fonts/archivo.woff2',
  './js/app.js', './js/more.js', './js/store.js', './js/foods.js', './js/ai.js', './js/ui.js', './js/util.js',
  './js/icons.js', './js/charts.js', './js/voice.js', './js/camera.js', './js/excel.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
];
const LAZY = ['./vendor/exceljs.min.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(async (c) => {
    await c.addAll(CORE);
    c.addAll(LAZY).catch(() => {});
  }));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // IA, Open Food Facts y otros servicios: siempre por red, nunca en caché
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(VERSION).then((c) => c.put('./index.html', cp)); return r; }).catch(() => caches.match('./index.html')));
    return;
  }
  // archivos propios: caché primero y actualización en segundo plano
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
