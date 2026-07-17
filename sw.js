/* Service worker: app installabile e usabile offline.
   La versione arriva dalla query di registrazione (sw.js?v=N in index.html):
   a ogni bump di ?v= il worker cambia, riprecacha e butta la cache vecchia. */

const V = location.search; // "?v=N"
const CACHE = "nutritrack" + V;
const ASSETS = [
  "./",
  "css/style.css" + V,
  "js/vendor/motion.js" + V,
  "js/foods.js" + V,
  "js/app.js" + V,
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // IA e Open Food Facts: sempre rete

  // Pagina: rete prima (aggiornamenti subito), cache solo offline
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("./")));
    return;
  }

  // Asset versionati: cache prima, rete come riempimento
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }))
  );
});
