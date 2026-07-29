const CACHE = "hgc-v11";
const BASE = self.location.href.replace(/sw\.js(\?.*)?$/, "");
const ASSET_PATHS = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/app.js",
  "./js/data.js",
  "./js/fitdays.js",
  "./manifest.json",
  "./icons/icon.svg",
  "./assets/exercises/press.jpg",
  "./assets/exercises/ohp.jpg",
  "./assets/exercises/lateral.jpg",
  "./assets/exercises/pullup.jpg",
  "./assets/exercises/row.jpg",
  "./assets/exercises/rear.jpg",
  "./assets/exercises/band.jpg",
  "./assets/exercises/arms.jpg",
  "./assets/exercises/squat.jpg",
  "./assets/exercises/rdl.jpg",
  "./assets/exercises/split.jpg",
  "./assets/exercises/calf.jpg",
  "./assets/exercises/core.jpg",
  "./assets/exercises/cardio.jpg",
];
const ASSETS = ASSET_PATHS.map((p) => new URL(p, BASE).href);

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(
        ASSETS.map((url) => c.add(url).catch(() => null))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).catch(() =>
        caches.match(new URL("./index.html", BASE).href)
      );
    })
  );
});
