// Mode hors ligne : l'application s'ouvre même sans réseau (pour pointer).
// Les fichiers versionnés (?v=…) sont gardés en cache ; la page d'accueil passe d'abord par le réseau.
// Les échanges avec la base (Supabase) ne passent jamais par le cache.
var CACHE = 'evy-app-1';
var BASE = ['./', 'index.html', 'manifest.webmanifest', 'assets/logo-evydent.jpg', 'assets/icone-180.png', 'assets/icone-192.png', 'assets/icone-512.png', 'js/vendor/jsqr.js?v=1', 'js/vendor/qrcode.js?v=1'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return Promise.all(BASE.map(function (u) { return c.add(u).catch(function () {}); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request; if (req.method !== 'GET') return;
  var u = new URL(req.url);
  if (/supabase\.(co|in)$/.test(u.hostname) && u.pathname.indexOf('/npm/') < 0) return;   // la base : jamais de cache
  var memeSite = u.origin === self.location.origin, bib = u.hostname === 'cdn.jsdelivr.net' || u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';
  if (!memeSite && !bib) return;
  if (req.mode === 'navigate' || (memeSite && /\/(index\.html)?$/.test(u.pathname))) {
    // page : réseau d'abord, sinon la dernière copie
    e.respondWith(fetch(req).then(function (r) { var c2 = r.clone(); caches.open(CACHE).then(function (c) { c.put('index.html', c2); }); return r; })
      .catch(function () { return caches.match('index.html').then(function (r) { return r || caches.match('./'); }); }));
    return;
  }
  // fichiers (css, js, images, bibliothèques) : cache d'abord, mis à jour en arrière-plan
  e.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (r) { if (r && (r.ok || r.type === 'opaque')) { var c2 = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, c2); }); } return r; }).catch(function () { return hit; });
    return hit || net;
  }));
});
