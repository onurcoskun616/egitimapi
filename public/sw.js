// Eğitim Stüdyosu servis çalışanı: uygulama kabuğunu önbelleğe alır, çevrimdışıyken uyarı sayfası gösterir.
// API istekleri ve videolar her zaman ağdan gelir (önbelleğe alınmaz).
const V = 'es-v27';
const SHELL = ['/', '/style.css', '/app.js', '/engine.js', '/izle.js', '/offline.html', '/icons/icon-192.png', '/manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/offline.html')));
    return;
  }
  // kabuk dosyaları: önce ağ (güncel kalsın), olmazsa önbellek
  e.respondWith(fetch(e.request).then(r => { if (r.ok && SHELL.some(s => u.pathname === s)) { const c = r.clone(); caches.open(V).then(x => x.put(u.pathname, c)); } return r; }).catch(() => caches.match(u.pathname)));
});

// Bildirimler
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Eğitim Stüdyosu', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Eğitim Stüdyosu', { body: d.body || '', icon: d.icon || '/icons/icon-192.png', badge: d.badge || '/icons/favicon-32.png', tag: d.tag, renotify: !!d.tag, data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) if (new URL(c.url).origin === self.location.origin && 'focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
