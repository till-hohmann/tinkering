// wake.js — keep the screen on while a workout needs it. One implementation.
//
// There were three copies (run player, extra run, routine) and none survived a
// lock: the browser drops a screen wake lock whenever the page is hidden, and
// nothing asked for it again, so after one glance at the lock screen the phone
// slept mid-run. The strength logger held none at all — the rest timer runs on
// animation frames, so with the screen asleep the end-of-rest beep never came.
//
// Holders are named, so a routine ending inside a strength session doesn't
// switch the screen off under the logger. The lock is re-taken whenever the page
// becomes visible while anyone still holds it, and a release that lands before
// the request has resolved is honoured when it does.

const holders = new Set();
let sentinel = null;
let pending = null;

function supported() {
  return typeof navigator !== "undefined" && navigator && "wakeLock" in navigator;
}

function acquire() {
  if (sentinel || pending || !holders.size || !supported()) return pending;
  pending = navigator.wakeLock.request("screen").then((s) => {
    pending = null;
    if (!holders.size) { s.release().catch(() => {}); return; }   // released while we waited
    sentinel = s;
    if (s.addEventListener) s.addEventListener("release", () => { if (sentinel === s) sentinel = null; });
  }).catch(() => { pending = null; });
  return pending;
}

/** Keep the screen on until `key` lets go. */
export function holdWake(key) {
  listen();
  holders.add(key);
  return acquire();
}

// Listening starts with the first hold, not at import, so it attaches to the
// document the page actually has.
let listening = false;
function listen() {
  if (listening || typeof document === "undefined" || !document.addEventListener) return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") acquire();
  });
}

/** `key` no longer needs the screen; it goes dark only when nobody does. */
export function releaseWake(key) {
  holders.delete(key);
  if (holders.size || !sentinel) return;
  const s = sentinel; sentinel = null;
  try { s.release().catch(() => {}); } catch { /* already released */ }
}

/** For tests and diagnostics. */
export function wakeState() { return { holders: [...holders], held: !!sentinel, pending: !!pending }; }

