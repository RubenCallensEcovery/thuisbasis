/* Thuisbasis service worker: pushmeldingen + app werkt ook even zonder netwerk */
const CACHE = 'thuisbasis-v1';
const SHELL = ['./', 'index.html', 'config.js', 'runtime.js', 'manifest.webmanifest', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
/* eigen bestanden: eerst netwerk (altijd de nieuwste versie), anders uit de cache */
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Thuisbasis', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Thuisbasis', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: d.tag || undefined, data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if ('focus' in w) return w.focus(); }
    return self.clients.openWindow(e.notification.data && e.notification.data.url || './');
  }));
});
