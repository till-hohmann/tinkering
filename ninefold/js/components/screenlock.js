// screenlock.js — a touch-blocking "screen lock" overlay for pocket use during a
// workout. The screen stays ON (the workout already holds a wake-lock) so the
// audio cues keep firing and the music keeps playing — but the overlay absorbs
// accidental taps so a pocketed phone can't hit Skip/End/etc. A deliberate
// slide-to-unlock dismisses it. The scrim is TRANSLUCENT (not opaque) and the
// lock UI is pinned top + bottom, so the run timer underneath stays visible at a
// glance mid-run; dark enough to still spare the OLED.

import { el } from "../ui.js";

let current = null;

const ns = "http://www.w3.org/2000/svg";
function svg(paths, { fill = "none" } = {}) {
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  for (const d of paths) {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", fill);
    if (fill === "none") { p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round"); }
    s.appendChild(p);
  }
  return s;
}
// closed padlock (for the lock state) / chevrons (for the slide knob)
const padlock = () => svg(["M6 10V8a6 6 0 0 1 12 0v2", "M5 10h14v10H5z"]);
const chevrons = () => svg(["M7 7l5 5-5 5", "M13 7l5 5-5 5"]);

export function showScreenLock() {
  if (current) return current;
  const ov = el("div.screenlock");
  ov.appendChild(el("div.sl-top", {}, [padlock(), el("div.sl-label", { text: "Screen locked" }), el("div.sl-sub", { text: "Cues still play · timer visible" })]));

  const knob = el("div.sl-knob");
  knob.appendChild(chevrons());
  const track = el("div.sl-track", {}, [el("span.sl-hint", { text: "slide to unlock" }), knob]);
  ov.appendChild(track);

  // Freeze the whole page while locked so a stray swipe can't rubber-band / drag
  // the PWA window (which on iOS can slip into the app switcher or close the app).
  // Two layers: (1) capture EVERY touchmove on the document and preventDefault it —
  // stops all scroll/overscroll on the page. The knob is dragged via POINTER events,
  // which are unaffected by touchmove.preventDefault, so slide-to-unlock still works.
  // (2) pin the document scroll so nothing underneath can move. Both are undone on
  // unlock. (The OS home-bar edge gesture is reserved by iOS and can't be blocked
  // from web content — this stops everything that is in web's control.)
  const blockTouchMove = (e) => { e.preventDefault(); };
  document.addEventListener("touchmove", blockTouchMove, { passive: false, capture: true });
  document.documentElement.classList.add("sl-locked");

  let dragging = false, startX = 0, dx = 0, max = 0;
  const setX = (x) => { dx = Math.max(0, Math.min(max, x)); knob.style.transform = `translateX(${dx}px)`; };

  function down(e) {
    dragging = true;
    max = Math.max(0, track.clientWidth - knob.offsetWidth - 6);
    startX = e.clientX - dx;
    knob.style.transition = "none";
    try { knob.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault(); e.stopPropagation();
  }
  function move(e) {
    if (!dragging) return;
    setX(e.clientX - startX);
    if (dx >= max * 0.9) { dragging = false; unlock(); }
  }
  function up() {
    if (!dragging) return;
    dragging = false;
    if (dx < max * 0.9) { knob.style.transition = "transform .18s ease"; setX(0); }
  }
  knob.addEventListener("pointerdown", down);
  knob.addEventListener("pointermove", move);
  knob.addEventListener("pointerup", up);
  knob.addEventListener("pointercancel", up);
  // swallow every other tap/scroll on the overlay so nothing underneath fires
  const swallow = (e) => { if (e.target !== knob && !knob.contains(e.target)) { e.preventDefault(); e.stopPropagation(); } };
  ov.addEventListener("touchmove", swallow, { passive: false });
  ov.addEventListener("click", swallow, true);

  function unlock() {
    document.removeEventListener("touchmove", blockTouchMove, { capture: true });
    document.documentElement.classList.remove("sl-locked");
    ov.remove();
    if (current === handle) current = null;
  }

  document.body.appendChild(ov);
  const handle = { close: unlock };
  current = handle;
  return handle;
}

// Force-dismiss any open lock (e.g. when the workout ends or the view tears down).
export function closeScreenLock() { if (current) current.close(); }

// A clearly-labeled "Lock" button that opens the overlay. Drop it in a run/
// routine header — labeled (not a bare icon) so it's easy to find mid-workout.
export function lockButton() {
  const btn = el("button.btn.ghost", { "aria-label": "Lock screen",
    style: "gap:6px;padding:0 12px;min-height:40px;white-space:nowrap", onclick: () => showScreenLock() });
  const ic = padlock(); ic.style.width = ic.style.height = "18px"; ic.style.flex = "none";
  btn.appendChild(ic);
  btn.appendChild(document.createTextNode("Lock"));
  return btn;
}
