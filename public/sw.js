/* Service worker MINIMO. Fa una sola cosa: se una navigazione fallisce per mancanza di rete,
   mostra /offline.html. NON mette in cache pagine, API, QR o dati: tutto cio' che e' personale
   (bonus, prenotazioni, chat) passa sempre dalla rete. Niente push in questa versione. */
const CACHE = 'chathel-shell-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
});
