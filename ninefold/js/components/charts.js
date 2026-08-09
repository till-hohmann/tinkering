// charts.js — tiny dependency-free SVG charts for the analytics screens.
// Rings, vertical bar charts, and line/area trend sparklines. All monochrome
// via CSS custom properties so they inherit the data palette, and all animate
// in on mount (respecting prefers-reduced-motion).

import { auroraStops } from "../theme.js";

const NS = "http://www.w3.org/2000/svg";
const reduce = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function svg(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  return n;
}
// Trigger an enter-transition's final state. Uses rAF when available, but ALWAYS
// also flips via setTimeout so the chart can't get stuck in its hidden initial
// state if rAF is throttled (backgrounded load). fn must be idempotent.
function nextFrame(fn) {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(fn));
  setTimeout(fn, 60);
}

const COLOR = { accent: "var(--accent)", cyan: "var(--cyan)", violet: "var(--violet)",
  coral: "var(--coral)", amber: "var(--amber)", blue: "var(--blue)" };
const col = (c) => COLOR[c] || c || COLOR.accent;

// Horizontal reference lines every `step` units across the value range (e.g. every
// 500 kcal on the nutrition chart), each with a small value label. Lines go into
// the (stretched) svg; labels are HTML overlays so they aren't x-distorted.
function drawHGrid(s, wrap, min, max, step, Y) {
  if (!step || step <= 0) return;
  let lastLabelY = Infinity;   // skip labels that would crowd the previous one
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-6; v += step) {
    const y = Y(v);
    s.appendChild(svg("line", { class: "chart-hgrid", x1: 0, y1: y.toFixed(2), x2: 100, y2: y.toFixed(2),
      stroke: "rgba(148,163,184,.36)", "stroke-width": 1, "vector-effect": "non-scaling-stroke" }));
    if (Math.abs(y - lastLabelY) < 15) continue;   // too close to the last label — line only
    lastLabelY = y;
    const lab = document.createElement("div");
    lab.className = "hgrid-lab"; lab.textContent = String(v); lab.style.top = y.toFixed(1) + "px";
    wrap.appendChild(lab);
  }
}

// shared <defs> for the design language: the signature aurora gradient (mint→sky→
// violet) + a soft glow filter, so rings/lines pop the same way the orb does.
let uidc = 0;
function auroraDefs(blur = 2) {
  const uid = "cg" + uidc++;
  const defs = svg("defs", {});
  const lg = svg("linearGradient", { id: uid, x1: "0", y1: "0", x2: "1", y2: "1" });
  // Read the stops from the ACTIVE THEME rather than carrying a hardcoded copy.
  // Inline SVG gradients can't use var(), so they resolve at build time instead.
  const stops = auroraStops();
  [["0%", stops[0]], ["50%", stops[1]], ["100%", stops[2]]].forEach(([o, c]) => lg.appendChild(svg("stop", { offset: o, "stop-color": c })));
  defs.appendChild(lg);
  const f = svg("filter", { id: uid + "g", x: "-40%", y: "-40%", width: "180%", height: "180%" });
  f.appendChild(svg("feGaussianBlur", { stdDeviation: String(blur), result: "b" }));
  const fm = svg("feMerge", {}); fm.appendChild(svg("feMergeNode", { in: "b" })); fm.appendChild(svg("feMergeNode", { in: "SourceGraphic" }));
  f.appendChild(fm); defs.appendChild(f);
  return { defs, grad: `url(#${uid})`, glow: `url(#${uid}g)` };
}

// Touch/drag-to-inspect: drag a thumb across a chart to read individual points.
// `tipText(i)` returns the label for data index i. Adds a moving marker line + a
// value chip; vertical page scroll still works (touch-action: pan-y).
function attachTooltip(wrap, n, tipText, color = "accent", xForIndex) {
  if (!n || n < 1 || typeof tipText !== "function") return;
  const xAt = xForIndex || ((i) => (n > 1 ? (i / (n - 1)) * 100 : 50));
  wrap.style.position = wrap.style.position || "relative";
  wrap.style.touchAction = "pan-y";
  // stop the iOS long-press text-selection / copy callout while dragging
  wrap.style.userSelect = "none";
  wrap.style.webkitUserSelect = "none";
  wrap.style.webkitTouchCallout = "none";
  const marker = document.createElement("div");
  marker.className = "charttip-marker";
  marker.style.background = col(color);
  const tip = document.createElement("div");
  tip.className = "charttip";
  marker.style.display = tip.style.display = "none";
  marker.style.pointerEvents = tip.style.pointerEvents = "none";   // never intercept the drag/scroll
  wrap.appendChild(marker); wrap.appendChild(tip);
  const show = (clientX) => {
    const r = wrap.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const i = Math.round(frac * (n - 1));
    const xPct = xAt(i);                          // align the marker with the actual plotted point
    marker.style.left = xPct + "%"; marker.style.display = "";
    tip.textContent = tipText(i);
    tip.style.left = xPct + "%";
    tip.style.transform = "translateX(" + (xPct < 18 ? "0" : xPct > 82 ? "-100%" : "-50%") + ")";
    tip.style.display = "";
  };
  // Persist: the marker + label STAY at the last point after you lift your finger
  // (no hide on pointerup/cancel) — a touch keeps showing the label you selected.
  wrap.addEventListener("pointerdown", (e) => { try { wrap.setPointerCapture(e.pointerId); } catch {} show(e.clientX); });
  wrap.addEventListener("pointermove", (e) => { if (e.buttons || (wrap.hasPointerCapture && wrap.hasPointerCapture(e.pointerId))) show(e.clientX); });
}

// --- Progress ring -------------------------------------------------------
// ringStat({ pct, value, sub, size, stroke, color })
export function ringStat({ pct = 0, value = "", sub = "", size = 116, stroke = 11, color = "accent" } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  const wrap = document.createElement("div");
  wrap.className = "ringwrap";
  wrap.style.width = wrap.style.height = size + "px";

  const s = svg("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  const rd = auroraDefs(2); s.appendChild(rd.defs);
  s.appendChild(svg("circle", { class: "ring-track", cx: size / 2, cy: size / 2, r, "stroke-width": stroke }));
  const val = svg("circle", { class: "ring-val", cx: size / 2, cy: size / 2, r, "stroke-width": stroke,
    stroke: rd.grad, filter: rd.glow, "stroke-linecap": "round", "stroke-dasharray": c, "stroke-dashoffset": c,
    transform: `rotate(-90 ${size / 2} ${size / 2})` });
  s.appendChild(val);
  wrap.appendChild(s);

  if (value !== "" || sub) {
    const t = document.createElement("div");
    t.className = "ringtext";
    if (value !== "") { const v = document.createElement("div"); v.className = "v"; v.textContent = value; t.appendChild(v); }
    if (sub) { const k = document.createElement("div"); k.className = "k"; k.textContent = sub; t.appendChild(k); }
    wrap.appendChild(t);
  }

  const target = c * (1 - clamped);
  if (reduce()) val.setAttribute("stroke-dashoffset", target);
  else nextFrame(() => { val.style.strokeDashoffset = target; });
  return wrap;
}

// --- Vertical bar chart --------------------------------------------------
// barChart({ values, labels, color, height, highlightLast, fmt, baseline })
export function barChart({ values = [], labels = [], color = "accent", height = 132,
  highlightLast = true, fmt = (v) => Math.round(v), gap = 0.34, tipText } = {}) {
  const wrap = document.createElement("div");
  wrap.style.position = "relative";
  const n = values.length || 1;
  const max = Math.max(1, ...values);
  const W = 100, H = height, pad = 14; // viewBox units (x in %, y in px)
  const slot = W / n;
  const bw = slot * (1 - gap);

  const s = svg("svg", { class: "chart chart-bars", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });
  s.style.height = H + "px";
  // vertical gradient (bright top → fade) for the highlighted bar
  const uid = "bc" + uidc++;
  const bdefs = svg("defs", {});
  const blg = svg("linearGradient", { id: uid, x1: "0", y1: "0", x2: "0", y2: "1" });
  blg.appendChild(svg("stop", { offset: "0%", "stop-color": col(color), "stop-opacity": "1" }));
  blg.appendChild(svg("stop", { offset: "100%", "stop-color": col(color), "stop-opacity": ".35" }));
  bdefs.appendChild(blg); s.appendChild(bdefs);

  const bars = [];
  values.forEach((v, i) => {
    const h = Math.max(2, (v / max) * (H - pad));
    const x = i * slot + (slot - bw) / 2;
    const y = H - h;
    const last = i === values.length - 1;
    const c = highlightLast && last ? `url(#${uid})` : "var(--bg-elev3)";
    const rect = svg("rect", { class: "bar", x, y, width: bw, height: h, rx: Math.min(3, bw / 2.5), fill: c });
    rect.dataset.h = h;
    if (reduce()) { /* leave as-is */ }
    else { rect.style.transform = "scaleY(0)"; }
    s.appendChild(rect);
    bars.push(rect);
  });
  wrap.appendChild(s);

  if (labels.length) {
    const ax = document.createElement("div");
    ax.className = "bar-axis";
    labels.forEach((l) => { const sp = document.createElement("span"); sp.textContent = l; ax.appendChild(sp); });
    wrap.appendChild(ax);
  }
  if (!reduce()) nextFrame(() => bars.forEach((b, i) => { b.style.transitionDelay = (i * 35) + "ms"; b.style.transform = "scaleY(1)"; }));
  attachTooltip(wrap, values.length, tipText, color);
  return wrap;
}

// --- Two-line chart with the gap between shaded ("delta") ----------------
// dualAreaChart({ a, b, ... }) — a and b are equal-length aligned series (e.g.
// calories in vs calories out). The band between them is filled, coloured by
// sign: a<b (deficit) negColor, a>b (surplus) posColor, splitting at crossings.
// Lines drawn on top in colorA / colorB.
export function dualAreaChart({ a = [], b = [], height = 110, pad = 3,
  colorA = "amber", colorB = "cyan", posColor = "coral", negColor = "accent", tipText, gridIdx, hStep } = {}) {
  const wrap = document.createElement("div");
  wrap.style.position = "relative"; wrap.style.height = height + "px";
  const n = Math.min(a.length, b.length);
  const W = 100, H = height;
  const s = svg("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });
  s.style.height = H + "px"; s.style.display = "block";
  if (n < 2) { wrap.appendChild(s); return wrap; }

  const all = a.slice(0, n).concat(b.slice(0, n));
  const min = Math.min(...all), max = Math.max(...all), span = max - min || 1;
  const X = (i) => (i / (n - 1)) * (W - pad * 2) + pad;
  const Y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
  drawHGrid(s, wrap, min, max, hStep, Y);
  (gridIdx || []).forEach((idx) => {
    if (idx <= 0 || idx >= n) return;
    s.appendChild(svg("line", { class: "chart-grid", x1: X(idx), y1: 0, x2: X(idx), y2: H,
      stroke: "var(--line)", "stroke-width": 1, "vector-effect": "non-scaling-stroke" }));
  });
  const seg = (x1, y1, x2, y2, x3, y3, color) =>
    svg("polygon", { points: `${x1},${y1} ${x2},${y2} ${x3},${y3}`, fill: col(color), "fill-opacity": ".2", stroke: "none" });
  const quad = (x1, aY1, bY1, x2, aY2, bY2, color) =>
    svg("polygon", { points: `${x1},${aY1} ${x2},${aY2} ${x2},${bY2} ${x1},${bY1}`, fill: col(color), "fill-opacity": ".2", stroke: "none" });

  // shaded band, split by sign of (a − b) with crossing interpolation
  for (let i = 0; i < n - 1; i++) {
    const xL = X(i), xR = X(i + 1);
    const aL = a[i], bL = b[i], aR = a[i + 1], bR = b[i + 1];
    const dL = aL - bL, dR = aR - bR;
    if (dL === 0 && dR === 0) continue;
    if (dL >= 0 === dR >= 0) {
      s.appendChild(quad(xL, Y(aL), Y(bL), xR, Y(aR), Y(bR), dL + dR > 0 ? posColor : negColor));
    } else {                                   // crossing inside the segment
      const t = dL / (dL - dR);
      const xc = xL + t * (xR - xL), meet = aL + t * (aR - aL);
      s.appendChild(seg(xL, Y(aL), xc, Y(meet), xL, Y(bL), dL > 0 ? posColor : negColor));
      s.appendChild(seg(xc, Y(meet), xR, Y(aR), xR, Y(bR), dR > 0 ? posColor : negColor));
    }
  }
  const path = (vals) => vals.slice(0, n).map((v, i) => (i ? "L" : "M") + X(i).toFixed(2) + " " + Y(v).toFixed(2)).join(" ");
  for (const [vals, c] of [[b, colorB], [a, colorA]]) {
    const line = svg("path", { class: "spark-line", d: path(vals), stroke: col(c), "vector-effect": "non-scaling-stroke", fill: "none" });
    s.appendChild(line);
  }
  s.style.opacity = reduce() ? 1 : 0;
  if (!reduce()) { s.style.transition = "opacity .5s var(--ease)"; nextFrame(() => { s.style.opacity = 1; }); }
  wrap.appendChild(s);
  // a dot on every data point of both lines (CSS divs stay circular under the x-stretch)
  const dot = (xPct, yPx, c) => { const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:${xPct}%;top:${yPx}px;width:5px;height:5px;border-radius:50%;` +
      `background:${col(c)};border:1.5px solid var(--bg-elev);transform:translate(-50%,-50%);pointer-events:none`;
    wrap.appendChild(d); };
  for (const [vals, c] of [[b, colorB], [a, colorA]]) for (let i = 0; i < n; i++) dot((X(i) / W) * 100, Y(vals[i]), c);
  attachTooltip(wrap, n, tipText, colorB, X);
  return wrap;
}

// --- Line / area trend ---------------------------------------------------
// sparkline({ values, color, height, fill, dots })
export function sparkline({ values = [], color = "accent", height = 90, fill = true, dots = true, pad = 3, tipText, gridIdx, hStep } = {}) {
  const wrap = document.createElement("div");
  wrap.style.position = "relative"; wrap.style.height = height + "px";
  const n = values.length;
  const W = 100, H = height;
  const xAt = (i) => (n > 1 ? (i / (n - 1)) * (W - pad * 2) + pad : 50);
  const tip = () => attachTooltip(wrap, n, tipText, color, xAt);
  const s = svg("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });
  s.style.height = H + "px"; s.style.display = "block";
  // CSS-positioned dot stays circular regardless of the non-uniform x-stretch
  const placeDot = (xPct, yPx, size = 5) => {
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:${xPct}%;top:${yPx}px;width:${size}px;height:${size}px;border-radius:50%;` +
      `background:${col(color)};border:1.5px solid var(--bg-elev);transform:translate(-50%,-50%);pointer-events:none`;
    wrap.appendChild(d);
  };
  if (n < 2) {
    wrap.appendChild(s);
    if (n === 1) placeDot(50, H / 2);
    tip();
    return wrap;
  }
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const X = (i) => (i / (n - 1)) * (W - pad * 2) + pad;
  const Y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
  drawHGrid(s, wrap, min, max, hStep, Y);
  // faint per-week divider lines (drawn first, behind the data)
  (gridIdx || []).forEach((idx) => {
    if (idx <= 0 || idx >= n) return;
    s.appendChild(svg("line", { class: "chart-grid", x1: X(idx), y1: 0, x2: X(idx), y2: H,
      stroke: "var(--line)", "stroke-width": 1, "vector-effect": "non-scaling-stroke" }));
  });
  const pts = values.map((v, i) => [X(i), Y(v)]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(2) + " " + p[1].toFixed(2)).join(" ");

  const gid = "sg" + Math.abs(values.reduce((a, b) => a + b, n) | 0) + "_" + n + "_" + String(color).replace(/\W/g, "");
  if (fill) {
    const defs = svg("defs", {});
    const grad = svg("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(svg("stop", { offset: "0%", "stop-color": col(color), "stop-opacity": ".28" }));
    grad.appendChild(svg("stop", { offset: "100%", "stop-color": col(color), "stop-opacity": "0" }));
    defs.appendChild(grad);
    s.appendChild(defs);
    const area = svg("path", { d: `${d} L ${W - pad} ${H} L ${pad} ${H} Z`, fill: `url(#${gid})`, stroke: "none" });
    s.appendChild(area);
  }
  const line = svg("path", { class: "spark-line", d, stroke: col(color), "vector-effect": "non-scaling-stroke" });
  s.appendChild(line);
  wrap.appendChild(s);
  // Opacity fade-in — a stroke-dashoffset "draw-on" renders as DASHES here: with
  // non-scaling-stroke on an x-stretched (preserveAspectRatio:none) viewBox,
  // getTotalLength() is in viewBox units but the dash renders in screen units, so
  // the line looked broken. Fade keeps it a solid, continuous stroke.
  s.style.opacity = reduce() ? 1 : 0;
  if (!reduce()) { s.style.transition = "opacity .55s var(--ease)"; nextFrame(() => { s.style.opacity = 1; }); }
  // a dot on every data point (CSS divs stay circular under the x-stretch).
  // Always drawn — every line chart shows its points (the `dots` arg is legacy).
  pts.forEach((p) => placeDot((p[0] / W) * 100, p[1]));
  tip();
  return wrap;
}
