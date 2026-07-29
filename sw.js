const CACHE = "hgc-v17";
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
      Promise.all(ASSETS.map((url) => c.add(url).catch(() => null)))
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

function isAppShell(url) {
  const u = new URL(url);
  const p = u.pathname;
  return (
    p.endsWith("/") ||
    p.endsWith("/index.html") ||
    p.endsWith(".css") ||
    p.endsWith(".js") ||
    p.endsWith("/sw.js")
  );
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  // HTML/CSS/JS: โหลดใหม่ก่อน แล้วค่อย cache — ลดอาการติดเวอร์ชันเก่า
  if (isAppShell(req.url)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match(new URL("./index.html", BASE).href)))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(new URL("./index.html", BASE).href));
    })
  );
});
