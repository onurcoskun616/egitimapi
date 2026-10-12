// Eğitim Stüdyosu servis çalışanı: uygulama kabuğunu önbelleğe alır, çevrimdışıyken uyarı sayfası gösterir.
// API istekleri ve videolar her zaman ağdan gelir (önbelleğe alınmaz).
const V = 'es-v1';
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
