// aurora.js — the signature living backdrop. A handful of soft colour blobs drift
// in lissajous paths on a canvas with additive blending + a trailing fade, so the
// whole app sits on a slow, flowing aurora rather than a flat gradient. Sits behind
// all content. Lightweight (5 blobs, capped DPR); pauses when the tab is hidden;
// skipped entirely under prefers-reduced-motion (the CSS static aurora shows instead).

import { auroraRGB } from "../theme.js";

// Midpoint of two rgb triples, for the intermediate blob colours.
const mix = (a, b) => a.map((v, i) => Math.round((v + b[i]) / 2));

let started = false;

export function mountAurora() {
  if (started) return;
  started = true;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const cv = document.createElement("canvas");
  cv.id = "aurora-cv";
  cv.setAttribute("aria-hidden", "true");
  document.body.appendChild(cv);
  const ctx = cv.getContext("2d");
  const dpr = Math.min(1.6, window.devicePixelRatio || 1);
  let w = 0, h = 0;
  function size() {
    w = window.innerWidth; h = window.innerHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  size();
  window.addEventListener("resize", size);

  // Brand aurora palette, read from the ACTIVE THEME. Canvas can't use var(), so
  // these were a hardcoded copy and the backdrop ignored the theme entirely —
  // on the one surface that covers the whole screen.
  const [c1, c2, c3] = auroraRGB();
  const cols = [c1, c2, mix(c2, c3), c3, c2];
  const blobs = cols.map((c, i) => ({
    c, ax: i * 1.3, ay: i * 2.1,
    sx: 0.00014 + i * 0.000037, sy: 0.00016 + i * 0.000029,
    r: 0.42 + (i % 3) * 0.07,
  }));

  let raf = null, running = true;
  function frame(t) {
    if (!running) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(7,12,18,0.20)";            // trailing fade → smooth flow
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";        // additive → luminous blends
    for (const b of blobs) {
      const x = w * (0.5 + 0.46 * Math.sin(t * b.sx + b.ax));
      const y = h * (0.40 + 0.48 * Math.cos(t * b.sy + b.ay));
      const rad = Math.max(w, h) * b.r;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},0.34)`);
      g.addColorStop(1, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.2832); ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { running = false; if (raf) cancelAnimationFrame(raf); }
    else if (!running) { running = true; raf = requestAnimationFrame(frame); }
  });
}
