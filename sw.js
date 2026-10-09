// Fonctionnement hors connexion : l'appli reste lisible sans réseau, et les données sont rafraîchies dès que le réseau revient.
const CACHE = "p27-v13";
const SHELL = ["./", "./index.html", "./data.json", "./manifest.webmanifest", "./icons/logo2027-180.png", "./icons/logo2027-192.png", "./icons/logo2027-512.png", "./fonts/instrument-sans-latin-400-normal.woff2", "./fonts/instrument-sans-latin-600-normal.woff2", "./fonts/bricolage-grotesque-latin-700-normal.woff2", "./fonts/bricolage-grotesque-latin-800-normal.woff2"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const fresh = e.request.mode === "navigate" || url.pathname.endsWith("/data.json") || url.pathname.endsWith("/index.html") || url.pathname.endsWith(".webmanifest");
  if (fresh) {
    // réseau d'abord pour la page et les données, copie locale en secours
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(url.pathname.endsWith("/data.json") ? "./data.json" : e.request, copy)); return res;
    }).catch(() => caches.match(url.pathname.endsWith("/data.json") ? "./data.json" : e.request).then(r => r || caches.match("./index.html"))));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
  })));
});
