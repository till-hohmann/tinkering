// sw.js — offline-first service worker (requirements §2/§4).
// Cache-first for the app shell so the app opens with zero network.
// Bump CACHE when shipping changes so clients pick up new files.

const CACHE = "fittrack-v161";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./fonts/sora-600.woff2",
  "./fonts/sora-700.woff2",
  "./fonts/sora-800.woff2",
  "./js/app.js",
  "./js/ui.js",
  "./js/db.js",
  "./js/store.js",
  "./js/cloudsync.js",
  "./js/model.js",
  "./js/progression.js",
  "./js/substitution.js",
  "./js/volume.js",
  "./js/standards.js",
  "./js/anatomy.js",
  "./js/exercise-anatomy.js",
  "./js/exercise-photo.js",
  "./js/cardio-intel.js",
  "./js/whoop.js",
  "./js/icons.js",
  "./js/illustrations.js",
  "./js/figure.js",
  "./js/export.js",
  "./js/mobility.js",
  "./js/components/aurora.js",
  "./js/components/orb.js",
  "./js/components/confetti.js",
  "./js/components/plate-calc.js",
  "./js/components/db-scroller.js",
  "./js/components/timer.js",
  "./js/components/charts.js",
  "./js/components/runplayer.js",
  "./js/components/screenlock.js",
  "./js/components/interrupt.js",
  "./js/views/home.js",
  "./js/views/progress.js",
  "./js/views/records.js",
  "./js/views/nutrition.js",
  "./js/views/session.js",
  "./js/views/routine.js",
  "./js/views/strength.js",
  "./js/views/cardio.js",
  "./js/views/summary.js",
  "./js/views/weeksummary.js",
  "./js/views/history.js",
  "./js/views/week.js",
  "./js/views/calendar.js",
  "./js/views/day.js",
  "./js/views/settings.js",
  "./js/views/mobility.js",
  "./js/views/mobsummary.js",
  "./js/views/exercise.js",
  "./data/program-1.json",
  "./data/program-2.json",
  "./icons/icon.svg",
  "./audio/position.wav",
  "./audio/stretch.wav",
  "./audio/easy-jog.wav",
  "./audio/speed-up.wav",
  "./audio/slow-down.wav",
  "./audio/cool-down.wav",
  "./audio/done.wav",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      await Promise.allSettled(SHELL.map((u) => c.add(u)));
      await self.skipWaiting();
    })()
  );
});

// Report the running build version to the page (authoritative — this is the
// active SW, so it reflects exactly what code the app is running).
self.addEventListener("message", (e) => {
  if (e.data === "version" && e.ports && e.ports[0]) e.ports[0].postMessage({ version: CACHE });
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          // runtime-cache same-origin successes (e.g. seed-sessions.json locally)
          if (res && res.ok && new URL(req.url).origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html")); // SPA fallback
    })
  );
});
