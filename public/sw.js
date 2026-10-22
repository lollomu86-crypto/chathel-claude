/* Service worker MINIMO. Fa una sola cosa: se una navigazione fallisce per mancanza di rete,
   mostra /offline.html. NON mette in cache pagine, API, QR o dati: tutto cio' che e' personale
   (bonus, prenotazioni, chat) passa sempre dalla rete.  Le notifiche push (sotto) mostrano solo testo generico. */
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

/* Notifiche push: il testo e' generico (scelto dal server); un tocco apre la pagina indicata, solo se interna. */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  const title = typeof d.title === 'string' && d.title ? d.title : 'ChatHel';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof d.body === 'string' ? d.body : '',
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    tag: typeof d.tag === 'string' ? d.tag : undefined, renotify: true,
    data: { url: typeof d.url === 'string' && /^\/[^/]/.test(d.url) ? d.url : '/stay' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/stay';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(url).catch(() => undefined); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
