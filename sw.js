/* Thuisbasis service worker: pushmeldingen + app werkt ook even zonder netwerk */
const CACHE = 'thuisbasis-v7';
const SHELL = ['./', 'index.html', 'config.js', 'runtime.js', 'manifest.webmanifest', 'icons/v3/icon-192.png'];
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
  const o = { body: d.body || '', icon: d.icon || 'icons/v3/icon-192.png', badge: 'icons/badge-96.png', tag: d.tag || undefined, data: { url: d.url || './', id: d.id || '' } };
  /* alarm: blijft staan, trilt lang, opnieuw melden bij elke herhaling, met knoppen */
  if (d.sticky) Object.assign(o, { requireInteraction: true, data: Object.assign(o.data, { running: 1 }) });
  if (d.silent) Object.assign(o, { silent: true, renotify: false });
  else if (d.tag) o.renotify = true;
  if (d.alarm) Object.assign(o, { requireInteraction: true, renotify: true, silent: false, vibrate: [500, 200, 500, 200, 500, 200, 800],
    actions: [{ action: 'done', title: 'Gedaan' }, { action: 'snooze', title: '10 min later' }] });
  e.waitUntil(self.registration.showNotification(d.title || 'Thuisbasis', o));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {}, act = e.action || (data.id ? 'stop' : '');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if ('focus' in w) { if (act && data.id) w.postMessage({ alarm: act, id: data.id }); return w.focus(); } }
    return self.clients.openWindow(act && data.id ? './#alarm=' + act + ':' + data.id : (data.url || './'));
  }));
});
