// figure.js — anatomical exercise figures (the "poster" art, v3 style approved
// 2026-07-03). Each strength/cardio movement is a hand-authored POSE (joint
// coordinates in a 200×200 box, all figures face right) rendered by a shared
// painter: sculpted torso, tapered limbs, far-side limbs for depth, and the
// worked muscles drawn as their real shapes ALONG THE BONES — quads sweep the
// femur into the knee, the glute is a compact mass at the sacrum, the calf
// bulges the upper shin. Primary movers coral, secondary amber, core teal.
// Pure string-building; illustrations.js wraps the output in the app tile.

const r1 = (n) => Math.round(n * 10) / 10;
const P = (p) => `${r1(p.x)} ${r1(p.y)}`;
const V = (a, b) => ({ x: b.x - a.x, y: b.y - a.y });
const len = (v) => Math.hypot(v.x, v.y) || 1;
const unit = (v) => { const l = len(v); return { x: v.x / l, y: v.y / l }; };
const perp = (u) => ({ x: -u.y, y: u.x });
const add = (p, v, k = 1) => ({ x: p.x + v.x * k, y: p.y + v.y * k });
const cross = (u, w) => u.x * w.y - u.y * w.x;

// Catmull-Rom → cubic bezier smooth path through points.
function smooth(pts, close = true) {
  const n = pts.length;
  let d = `M${P(pts[0])}`;
  const seg = close ? n : n - 1;
  for (let i = 0; i < seg; i++) {
    const p0 = pts[close ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const p1 = pts[i], p2 = pts[(i + 1) % n];
    const p3 = pts[close ? (i + 2) % n : Math.min(n - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${P(c1)} ${P(c2)} ${P(p2)}`;
  }
  return d + (close ? "Z" : "");
}

// Tapered limb segment with rounded caps (half-widths wa → wb).
function taper(a, b, wa, wb, fill) {
  const u = unit(V(a, b)), n = perp(u);
  const p1 = add(a, n, wa), p2 = add(b, n, wb), p3 = add(b, n, -wb), p4 = add(a, n, -wa);
  const cb = add(b, u, wb * 1.15), ca = add(a, u, -wa * 1.15);
  return `<path d="M${P(p1)} L${P(p2)} Q${P(cb)} ${P(p3)} L${P(p4)} Q${P(ca)} ${P(p1)}Z" fill="${fill}"/>`;
}

// --- palette ---------------------------------------------------------------
const C = {
  torso: "#26333f", limb: "#22303c", limb2: "#283644", far: "#17232e",
  hand: "#2c3a48", rim: "#4a6072", face: "#3c4f61",
  gear: "#121d28", gearLine: "#24354a", gearRing: "#1c2d3d", gearHub: "#2a3b4a",
  cap: "#41546a", capHi: "#5d7286", bench: "#1b2836", benchLeg: "#16222e",
};
const TONE = {
  p: { main: "#ff5546", hi: "#ffb3a6" },
  s: { main: "#f5a83f", hi: "#ffd08a" },
  c: { main: "#35d0ba", hi: "#8af0e4" },
};

// --- muscle painters (bone-relative) ----------------------------------------
// Teardrop along one edge of a bone: halo + body + highlight ridge.
function muscleAlong(a, b, side, w, tone, { t0 = 0.08, t1 = 0.94 } = {}) {
  const u = unit(V(a, b)), n = perp(u), L = len(V(a, b));
  const at = (t, s) => ({ x: a.x + u.x * t * L + n.x * s * side, y: a.y + u.y * t * L + n.y * s * side });
  const span = t1 - t0;
  const pts = [at(t0, w * 0.3), at(t0 + span * 0.32, w * 1.08), at(t0 + span * 0.62, w * 1.0),
    at(t1, w * 0.28), at(t0 + span * 0.55, w * 0.42)];
  const d = smooth(pts);
  const ridge = smooth([at(t0 + span * 0.12, w * 0.72), at(t0 + span * 0.4, w * 1.02), at(t0 + span * 0.72, w * 0.86)], false);
  return `<path d="${d}" stroke="${tone.main}" stroke-width="${w * 0.9}" opacity=".14" fill="none"/>` +
    `<path d="${d}" fill="${tone.main}"/>` +
    `<path d="${ridge}" stroke="${tone.hi}" stroke-width="2.6" stroke-linecap="round" fill="none" opacity=".8"/>`;
}
// Compact rounded mass (glute, delt-as-muscle, traps) at a centre point.
function muscleBlob(cpt, rx, ry, axis, tone) {
  const u = unit(axis), n = perp(u);
  const at = (tu, tn) => ({ x: cpt.x + u.x * rx * tu + n.x * ry * tn, y: cpt.y + u.y * rx * tu + n.y * ry * tn });
  const pts = [at(-1, 0), at(-0.65, -0.85), at(0.25, -1), at(0.95, -0.4), at(0.9, 0.5), at(0.15, 0.95), at(-0.7, 0.8)];
  const d = smooth(pts);
  const ridge = smooth([at(-0.75, -0.5), at(-0.15, -0.88), at(0.5, -0.6)], false);
  return `<path d="${d}" stroke="${tone.main}" stroke-width="${Math.min(rx, ry) * 0.8}" opacity=".14" fill="none"/>` +
    `<path d="${d}" fill="${tone.main}"/>` +
    `<path d="${ridge}" stroke="${tone.hi}" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".8"/>`;
}
// Band along the torso front/back (abs, erectors) as a lit stroke.
function muscleBand(a, b, tone, w = 6) {
  const mid = { x: (a.x + b.x) / 2 + (b.y - a.y) * 0.08, y: (a.y + b.y) / 2 - (b.x - a.x) * 0.08 };
  const d = smooth([a, mid, b], false);
  return `<path d="${d}" stroke="${tone.main}" stroke-width="${w * 2}" stroke-linecap="round" opacity=".14" fill="none"/>` +
    `<path d="${d}" stroke="${tone.main}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
}

// --- equipment ---------------------------------------------------------------
const plateBack = (p, r) =>
  `<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r}" fill="${C.gear}" stroke="${C.gearLine}" stroke-width="1.5"/>` +
  `<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r1(r * 0.66)}" fill="none" stroke="${C.gearRing}" stroke-width="1.5"/>` +
  `<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r1(r * 0.3)}" fill="none" stroke="${C.gearRing}" stroke-width="1.5"/>` +
  `<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r1(r * 0.12)}" fill="${C.gearHub}"/>`;
const barCap = (p) =>
  `<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="7" fill="${C.cap}"/><circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="3" fill="${C.capHi}"/>`;
const dbAt = (p, ang = 0, s = 9) =>
  `<g transform="rotate(${ang} ${r1(p.x)} ${r1(p.y)})">` +
  `<rect x="${r1(p.x - s)}" y="${r1(p.y - 1.6)}" width="${s * 2}" height="3.2" rx="1.6" fill="${C.cap}"/>` +
  `<rect x="${r1(p.x - s - 3)}" y="${r1(p.y - 5.5)}" width="5" height="11" rx="2" fill="${C.gearHub}"/>` +
  `<rect x="${r1(p.x + s - 2)}" y="${r1(p.y - 5.5)}" width="5" height="11" rx="2" fill="${C.gearHub}"/></g>`;
const cableLine = (anchor, hand) =>
  `<circle cx="${r1(anchor.x)}" cy="${r1(anchor.y)}" r="3.5" fill="${C.gearHub}"/>` +
  `<path d="M${P(anchor)} L${P(hand)}" stroke="${C.gearLine}" stroke-width="2"/>`;
const benchPad = (a, b, h = 7) => {
  const u = unit(V(a, b)), n = perp(u);
  const leg = (p) => `<path d="M${P(p)} L${r1(p.x)} 176" stroke="${C.benchLeg}" stroke-width="6"/>`;
  return leg(add(add(a, u, 12), n, h)) + leg(add(add(b, u, -12), n, h)) +
    `<path d="M${P(add(a, n, -h / 2))} L${P(add(b, n, -h / 2))}" stroke="${C.bench}" stroke-width="${h * 2}" stroke-linecap="round"/>`;
};
const groundArt = (y, cx, rx) =>
  `<line x1="${r1(cx - rx - 14)}" y1="${y}" x2="${r1(cx + rx + 14)}" y2="${y}" stroke="#1c2b38" stroke-width="1.5"/>` +
  `<ellipse cx="${cx}" cy="${y + 1}" rx="${rx}" ry="5" fill="#050c12" opacity=".7"/>`;

// --- body painters ------------------------------------------------------------
function torsoArt(sh, hip, opts = {}) {
  const u = unit(V(hip, sh));
  let f = perp(u);
  if (f.x < -0.2 || (Math.abs(f.x) < 0.2 && f.y > 0)) f = { x: -f.x, y: -f.y };
  if (opts.flip) f = { x: -f.x, y: -f.y };
  const L = len(V(hip, sh));
  const shW = opts.shW || 13, hipW = opts.hipW || 10.5;
  const at = (t, s) => ({ x: hip.x + u.x * t * L + f.x * s, y: hip.y + u.y * t * L + f.y * s });
  const path = smooth([
    at(1.04, 4), at(0.78, shW + 1.5), at(0.42, hipW + 1.5), at(0.04, hipW),
    at(-0.06, 1), at(0.04, -hipW + 1), at(0.48, -shW + 2.5), at(0.88, -shW - 0.5), at(1.06, -3.5),
  ]);
  return { art: `<path d="${path}" fill="${C.torso}"/>`, at, f, u, shW, hipW };
}

function headArt(c, r, u) {
  // u = spine-up unit at the neck; face nudges toward +x
  const nose = add(add(c, { x: 1, y: 0 }, r), { x: 0, y: -r * 0.15 });
  return `<circle cx="${r1(c.x)}" cy="${r1(c.y)}" r="${r}" fill="${C.torso}"/>` +
    `<path d="M${r1(c.x - r * 0.62)} ${r1(c.y - r * 0.72)} Q${r1(c.x)} ${r1(c.y - r * 1.18)} ${r1(c.x + r * 0.66)} ${r1(c.y - r * 0.62)}" stroke="${C.rim}" stroke-width="2.2" stroke-linecap="round" fill="none" opacity=".8"/>` +
    `<path d="M${r1(nose.x)} ${r1(nose.y - 4)} Q${r1(nose.x + 3)} ${r1(nose.y)} ${r1(nose.x - 1)} ${r1(nose.y + 4)}" stroke="${C.face}" stroke-width="2.2" stroke-linecap="round" fill="none"/>` +
    `<circle cx="${r1(c.x + r * 0.42)} " cy="${r1(c.y - r * 0.18)}" r="1.5" fill="${C.face}"/>` +
    `<circle cx="${r1(c.x - r * 0.18)}" cy="${r1(c.y + r * 0.05)}" r="2.4" fill="${C.face}"/>`;
}

function legArt(l, fill, fill2) {
  const uT = unit(V(l.hip, l.knee)), uS = unit(V(l.knee, l.ankle));
  const bend = cross(uT, uS);
  const heel = l.heel || add(l.ankle, unit(V(l.toe, l.ankle)), 8);
  const foot = smooth([heel, { x: l.toe.x, y: l.toe.y }, add(l.ankle, { x: 0, y: -3 })]);
  return {
    art: taper(l.hip, l.knee, 12, 8, fill) + taper(l.knee, l.ankle, 7, 4.5, fill2 || fill) +
      `<path d="${foot}" fill="${fill2 || fill}"/>`,
    quadSide: bend >= 0 ? -1 : 1, calfSide: bend >= 0 ? 1 : -1,
  };
}
function farLeg(l) {
  const heel = l.heel || add(l.ankle, unit(V(l.toe, l.ankle)), 8);
  return `<path d="M${P(l.hip)} L${P(l.knee)}" stroke="${C.far}" stroke-width="20" stroke-linecap="round" fill="none"/>` +
    `<path d="M${P(l.knee)} L${P(l.ankle)}" stroke="${C.far}" stroke-width="12" stroke-linecap="round" fill="none"/>` +
    `<path d="M${P(heel)} L${P(l.toe)}" stroke="${C.far}" stroke-width="6" stroke-linecap="round" fill="none"/>`;
}
function armArt(a, lit) {
  const uU = unit(V(a.sh, a.elbow)), uF = unit(V(a.elbow, a.hand));
  const bend = cross(uU, uF);
  let out = taper(a.sh, a.elbow, 7.5, 6, C.limb2) + taper(a.elbow, a.hand, 5.5, 4, C.limb2) +
    `<circle cx="${r1(a.hand.x)}" cy="${r1(a.hand.y)}" r="4.5" fill="${C.hand}"/>`;
  const deltTone = lit && lit.delts;
  out += deltTone
    ? muscleBlob(a.sh, 8.5, 8, uU, deltTone)
    : `<circle cx="${r1(a.sh.x)}" cy="${r1(a.sh.y)}" r="8" fill="${C.hand}"/>`;
  if (lit && lit.biceps) out += muscleAlong(a.sh, a.elbow, bend >= 0 ? -1 : 1, lit.bicepsBig ? 7 : 5.5, lit.biceps, { t0: 0.18, t1: 0.92 });
  if (lit && lit.triceps) out += muscleAlong(a.sh, a.elbow, bend >= 0 ? 1 : -1, 5.5, lit.triceps, { t0: 0.15, t1: 0.9 });
  if (lit && lit.forearms) out += muscleAlong(a.elbow, a.hand, bend >= 0 ? -1 : 1, 4, lit.forearms, { t0: 0.1, t1: 0.7 });
  return out;
}

// --- the renderer ---------------------------------------------------------------
// spec: { ground, head:{x,y,r}, torso:{sh,hip,flip?}, legs:[...near-first], farLegs:[...],
//         arms:[...], farArms? (drawn dark before torso), m:{muscle:"p"|"s"|"c"},
//         gearBack:[...svg], gearFront:[...svg], shadowX, shadowR }
export function renderFigure(spec) {
  const m = spec.m || {};
  const tone = (k) => (m[k] ? TONE[m[k]] : null);
  let out = "";
  if (spec.ground != null) out += groundArt(spec.ground, spec.shadowX || 100, spec.shadowR || 46);
  out += (spec.gearBack || []).join("");
  for (const l of spec.farLegs || []) out += farLeg(l);
  for (const a of spec.farArms || [])
    out += `<path d="M${P(a.sh)} L${P(a.elbow)}" stroke="${C.far}" stroke-width="12" stroke-linecap="round" fill="none"/>` +
      `<path d="M${P(a.elbow)} L${P(a.hand)}" stroke="${C.far}" stroke-width="8" stroke-linecap="round" fill="none"/>`;

  const T = torsoArt(spec.torso.sh, spec.torso.hip, spec.torso);
  out += T.art;
  // torso-attached muscles
  if (tone("lats") || tone("back")) out += muscleAlong(spec.torso.hip, spec.torso.sh, -1 * (T.f.x >= 0 ? 1 : -1), T.shW * 0.8, tone("lats") || tone("back"), { t0: 0.18, t1: 0.8 });
  if (tone("erectors")) out += muscleBand(T.at(0.12, -T.hipW * 0.72), T.at(0.72, -T.shW * 0.68), tone("erectors"), 5.5);
  if (tone("core")) {
    out += muscleBand(T.at(0.2, T.hipW * 0.8), T.at(0.66, T.shW * 0.72), tone("core"), 5.5);
  }
  if (tone("chest")) out += muscleBlob(T.at(0.74, T.shW * 0.66), 10, 7.5, T.u, tone("chest"));
  if (tone("traps")) out += muscleBlob(T.at(0.94, -T.shW * 0.4), 7, 5, T.u, tone("traps"));

  // glutes sit at the hip, on the back side
  if (tone("glutes")) out += muscleBlob(add(spec.torso.hip, T.f, -(T.hipW + 1)), 8, 10.5, T.u, tone("glutes"));

  for (const l of spec.legs || []) {
    const L = legArt(l, C.limb, C.limb);
    out += L.art;
    if (tone("quads")) out += muscleAlong(l.hip, l.knee, L.quadSide, 8, tone("quads"), { t0: 0.12, t1: 0.96 });
    if (tone("hams")) out += muscleAlong(l.hip, l.knee, -L.quadSide, 6.5, tone("hams"), { t0: 0.15, t1: 0.85 });
    if (tone("calves")) out += muscleAlong(l.knee, l.ankle, L.calfSide, m.calves === "p" ? 9.5 : 5.5, tone("calves"), { t0: 0.05, t1: m.calves === "p" ? 0.8 : 0.62 });
  }
  for (const a of spec.arms || []) out += armArt(a, { delts: tone("delts"), biceps: tone("biceps"), bicepsBig: m.biceps === "p",
    triceps: tone("triceps"), forearms: tone("forearms") });
  out += headArt(spec.head, spec.head.r, T.u);
  out += (spec.gearFront || []).join("");
  return out;
}

// --- pose library -----------------------------------------------------------------
// Coordinates authored in a 200×200 box, figures face right, ground y=176.
const G = 176;
function leg(hip, knee, ankle, toe, heel) { return { hip, knee, ankle, toe, heel }; }
const pt = (x, y) => ({ x, y });

export const POSES = {
  squat_bar: {
    ground: G, shadowX: 112, shadowR: 52,
    head: { x: 112, y: 36, r: 11 },
    torso: { sh: pt(101, 56), hip: pt(72, 118) },
    legs: [leg(pt(72, 118), pt(131, 125), pt(124, 172), pt(150, 176), pt(110, 176))],
    farLegs: [leg(pt(64, 120), pt(122, 128), pt(115, 174), pt(140, 178))],
    arms: [{ sh: pt(101, 58), elbow: pt(80, 82), hand: pt(91, 48) }],
    m: { quads: "p", glutes: "p", hams: "s", erectors: "s", calves: "s", core: "c" },
    gearBack: [plateBack(pt(96, 44), 38)],
    gearFront: [barCap(pt(96, 44))],
  },
  squat_bw: {
    ground: G, shadowX: 108, shadowR: 48,
    head: { x: 108, y: 40, r: 11 },
    torso: { sh: pt(98, 60), hip: pt(72, 120) },
    legs: [leg(pt(72, 120), pt(130, 127), pt(123, 172), pt(149, 176), pt(109, 176))],
    farLegs: [leg(pt(64, 122), pt(121, 130), pt(114, 174), pt(139, 178))],
    arms: [{ sh: pt(98, 62), elbow: pt(124, 70), hand: pt(148, 64) }],
    m: { quads: "p", glutes: "p", hams: "s", calves: "s", core: "c" },
  },
  goblet: {
    ground: G, shadowX: 108, shadowR: 48,
    head: { x: 108, y: 40, r: 11 },
    torso: { sh: pt(98, 60), hip: pt(72, 120) },
    legs: [leg(pt(72, 120), pt(130, 127), pt(123, 172), pt(149, 176), pt(109, 176))],
    farLegs: [leg(pt(64, 122), pt(121, 130), pt(114, 174), pt(139, 178))],
    arms: [{ sh: pt(98, 62), elbow: pt(96, 88), hand: pt(114, 76) }],
    m: { quads: "p", glutes: "p", hams: "s", calves: "s", core: "c" },
    gearFront: [dbAt(pt(119, 72), 90, 7)],
  },
  hinge_bar: {
    ground: G, shadowX: 104, shadowR: 50,
    head: { x: 148, y: 62, r: 10.5 },
    torso: { sh: pt(134, 70), hip: pt(88, 102) },
    legs: [leg(pt(88, 102), pt(96, 140), pt(94, 172), pt(118, 176), pt(80, 176))],
    farLegs: [leg(pt(80, 104), pt(88, 142), pt(86, 174), pt(110, 178))],
    arms: [{ sh: pt(134, 72), elbow: pt(136, 98), hand: pt(137, 124) }],
    m: { hams: "p", glutes: "p", erectors: "s", traps: "s", forearms: "s" },
    gearBack: [plateBack(pt(137, 138), 20)],
    gearFront: [barCap(pt(137, 130))],
  },
  lunge: {
    ground: G, shadowX: 104, shadowR: 56,
    head: { x: 102, y: 40, r: 11 },
    torso: { sh: pt(98, 60), hip: pt(94, 114) },
    legs: [leg(pt(94, 114), pt(128, 142), pt(126, 172), pt(150, 176), pt(112, 176))],
    farLegs: [leg(pt(90, 116), pt(66, 148), pt(52, 172), pt(44, 178))],
    arms: [{ sh: pt(98, 62), elbow: pt(102, 92), hand: pt(104, 120) }],
    m: { quads: "p", glutes: "p", hams: "s", calves: "s", core: "c" },
    gearFront: [dbAt(pt(104, 126), 84, 8)],
  },
  split_squat: {
    ground: G, shadowX: 96, shadowR: 56,
    head: { x: 96, y: 44, r: 11 },
    torso: { sh: pt(92, 64), hip: pt(86, 118) },
    legs: [leg(pt(86, 118), pt(118, 146), pt(116, 172), pt(140, 176), pt(102, 176))],
    farLegs: [leg(pt(82, 120), pt(52, 144), pt(40, 152), pt(28, 150))],
    arms: [{ sh: pt(92, 66), elbow: pt(96, 96), hand: pt(98, 124) }],
    m: { quads: "p", glutes: "p", hams: "s", core: "c" },
    gearBack: [`<rect x="16" y="152" width="34" height="24" rx="3" fill="${C.bench}"/>`],
    gearFront: [dbAt(pt(98, 130), 84, 8)],
  },
  calf: {
    ground: G, shadowX: 102, shadowR: 40,
    head: { x: 104, y: 26, r: 11 },
    torso: { sh: pt(100, 46), hip: pt(96, 96) },
    legs: [leg(pt(96, 96), pt(102, 134), pt(99, 164), pt(116, 170), pt(90, 164))],
    farLegs: [leg(pt(90, 98), pt(96, 136), pt(93, 166), pt(110, 172))],
    arms: [{ sh: pt(100, 48), elbow: pt(106, 76), hand: pt(112, 102) }],
    m: { calves: "p", core: "c" },
    gearFront: [dbAt(pt(114, 108), 84, 8)],
  },
  hipthrust: {
    ground: G, shadowX: 110, shadowR: 62,
    head: { x: 46, y: 100, r: 10.5 },
    torso: { sh: pt(62, 112), hip: pt(108, 110), flip: false },
    legs: [leg(pt(108, 110), pt(140, 118), pt(140, 168), pt(158, 174), pt(130, 174))],
    farLegs: [leg(pt(102, 112), pt(130, 122), pt(130, 170), pt(148, 176))],
    arms: [{ sh: pt(64, 114), elbow: pt(76, 132), hand: pt(92, 128) }],
    m: { glutes: "p", hams: "s", quads: "s", core: "c" },
    gearBack: [benchPad(pt(30, 130), pt(70, 130))],
    gearFront: [dbAt(pt(106, 96), 0, 10)],
  },
  // --- bodyweight push/pull ---------------------------------------------------
  // These three exist because a bodyweight-only user previously had NO
  // horizontal push, NO horizontal pull and NO vertical pull available, so the
  // program builder could only hand them holds and squats. Pose keys match the
  // exercise ids exactly, so illustrationKey() resolves them without a MAP entry.

  // Mid-rep press-up: body one straight line from heel to head, elbows tracked
  // back rather than flared, hands under the shoulders.
  push_up: {
    ground: G, shadowX: 122, shadowR: 68,
    head: { x: 56, y: 106, r: 10.5 },
    // Shoulder -> hip -> ankle sit on one straight line (slope ~0.44 throughout).
    // The first pass put the hip at y130, which piked the hips above the line and
    // read as a downward dog rather than the "body in one line" the cue asks for.
    torso: { sh: pt(76, 116), hip: pt(124, 137) },
    legs: [leg(pt(124, 137), pt(149, 148), pt(172, 158), pt(180, 172), pt(176, 152))],
    farLegs: [leg(pt(118, 139), pt(143, 151), pt(166, 162), pt(174, 174))],
    arms: [{ sh: pt(76, 116), elbow: pt(66, 142), hand: pt(84, 168) }],
    farArms: [{ sh: pt(78, 118), elbow: pt(70, 144), hand: pt(88, 170) }],
    m: { chest: "p", triceps: "s", delts: "s", core: "c" },
  },

  // Inverted row: face-up under a fixed bar, heels down, body rigid, pulling the
  // sternum to the bar. The scalable horizontal pull when there's no weight.
  inverted_row: {
    ground: G, shadowX: 126, shadowR: 62,
    head: { x: 62, y: 128, r: 10.5 },
    torso: { sh: pt(82, 130), hip: pt(128, 140) },
    legs: [leg(pt(128, 140), pt(154, 152), pt(176, 164), pt(182, 152), pt(178, 174))],
    farLegs: [leg(pt(122, 142), pt(148, 156), pt(170, 168), pt(176, 156))],
    arms: [{ sh: pt(82, 130), elbow: pt(78, 108), hand: pt(86, 84) }],
    farArms: [{ sh: pt(84, 132), elbow: pt(90, 110), hand: pt(94, 84) }],
    m: { back: "p", biceps: "s", core: "s", delts: "s" },
    gearBack: [`<path d="M40 82 L160 82" stroke="${C.gearLine}" stroke-width="7" stroke-linecap="round"/>`,
      `<path d="M46 82 L46 176 M154 82 L154 176" stroke="${C.gearLine}" stroke-width="5" stroke-linecap="round" opacity=".45"/>`],
  },

  // Pull-up at the top: chin level with the bar, elbows driven down to the ribs,
  // legs slightly behind. Same rig as the dead hang so the pair read as a family.
  pull_up: {
    ground: G, shadowX: 100, shadowR: 32,
    head: { x: 100, y: 48, r: 10.5 },
    torso: { sh: pt(100, 68), hip: pt(103, 120) },
    legs: [leg(pt(103, 120), pt(110, 143), pt(99, 161), pt(92, 167), pt(105, 165))],
    farLegs: [leg(pt(99, 122), pt(106, 145), pt(95, 163), pt(88, 169))],
    arms: [{ sh: pt(100, 68), elbow: pt(86, 52), hand: pt(93, 30) }],
    farArms: [{ sh: pt(103, 70), elbow: pt(117, 52), hand: pt(110, 30) }],
    m: { lats: "p", biceps: "s", back: "s", forearms: "s" },
    gearBack: [`<path d="M46 26 L154 26" stroke="${C.gearLine}" stroke-width="7" stroke-linecap="round"/>`,
      `<path d="M52 26 L52 62 M148 26 L148 62" stroke="${C.gearLine}" stroke-width="5" stroke-linecap="round" opacity=".55"/>`],
  },

  bench: {
    ground: G, shadowX: 100, shadowR: 64,
    head: { x: 52, y: 124, r: 10.5 },
    torso: { sh: pt(74, 130), hip: pt(120, 132) },
    legs: [leg(pt(120, 132), pt(148, 148), pt(150, 172), pt(166, 176), pt(140, 176))],
    farLegs: [leg(pt(114, 134), pt(140, 152), pt(142, 174), pt(158, 178))],
    arms: [{ sh: pt(74, 130), elbow: pt(80, 104), hand: pt(74, 82) }],
    m: { chest: "p", delts: "s", triceps: "s", core: "c" },
    gearBack: [benchPad(pt(36, 148), pt(120, 148)), plateBack(pt(74, 76), 26)],
    gearFront: [barCap(pt(74, 76))],
  },
  incline: {
    ground: G, shadowX: 100, shadowR: 60,
    head: { x: 62, y: 92, r: 10.5 },
    torso: { sh: pt(78, 108), hip: pt(112, 136) },
    legs: [leg(pt(112, 136), pt(140, 150), pt(142, 172), pt(158, 176), pt(132, 176))],
    farLegs: [leg(pt(106, 138), pt(132, 154), pt(134, 174), pt(150, 178))],
    arms: [{ sh: pt(78, 108), elbow: pt(86, 84), hand: pt(84, 60) }],
    m: { chest: "p", delts: "s", triceps: "s", core: "c" },
    gearBack: [benchPad(pt(52, 132), pt(110, 156)), plateBack(pt(84, 54), 22)],
    gearFront: [barCap(pt(84, 54))],
  },
  overhead: {
    ground: G, shadowX: 100, shadowR: 42,
    head: { x: 92, y: 42, r: 11 },
    torso: { sh: pt(98, 62), hip: pt(96, 114) },
    legs: [leg(pt(96, 114), pt(100, 144), pt(98, 172), pt(120, 176), pt(86, 176))],
    farLegs: [leg(pt(90, 116), pt(94, 146), pt(92, 174), pt(114, 178))],
    arms: [{ sh: pt(98, 62), elbow: pt(112, 44), hand: pt(108, 22) }],
    m: { delts: "p", triceps: "s", traps: "s", core: "c" },
    gearBack: [plateBack(pt(108, 18), 16)],
    gearFront: [barCap(pt(108, 18))],
  },
  overhead_ext: {
    ground: G, shadowX: 100, shadowR: 42,
    head: { x: 94, y: 44, r: 11 },
    torso: { sh: pt(98, 64), hip: pt(96, 116) },
    legs: [leg(pt(96, 116), pt(100, 146), pt(98, 172), pt(120, 176), pt(86, 176))],
    farLegs: [leg(pt(90, 118), pt(94, 148), pt(92, 174), pt(114, 178))],
    arms: [{ sh: pt(98, 64), elbow: pt(112, 42), hand: pt(96, 30) }],
    m: { triceps: "p", core: "c" },
    gearFront: [dbAt(pt(90, 28), 60, 7)],
  },
  pushdown: {
    ground: G, shadowX: 98, shadowR: 42,
    head: { x: 94, y: 42, r: 11 },
    torso: { sh: pt(98, 62), hip: pt(94, 114) },
    legs: [leg(pt(94, 114), pt(98, 144), pt(96, 172), pt(118, 176), pt(84, 176))],
    farLegs: [leg(pt(88, 116), pt(92, 146), pt(90, 174), pt(112, 178))],
    arms: [{ sh: pt(98, 64), elbow: pt(106, 92), hand: pt(124, 100) }],
    m: { triceps: "p", core: "c" },
    gearBack: [cableLine(pt(148, 12), pt(126, 98))],
    gearFront: [`<path d="M116 104 L136 96" stroke="${C.cap}" stroke-width="4" stroke-linecap="round"/>`],
  },
  row_bent: {
    ground: G, shadowX: 104, shadowR: 50,
    head: { x: 146, y: 58, r: 10.5 },
    torso: { sh: pt(130, 66), hip: pt(86, 100) },
    legs: [leg(pt(86, 100), pt(94, 140), pt(92, 172), pt(116, 176), pt(78, 176))],
    farLegs: [leg(pt(78, 102), pt(86, 142), pt(84, 174), pt(108, 178))],
    arms: [{ sh: pt(130, 68), elbow: pt(128, 96), hand: pt(122, 104) }],
    m: { back: "p", biceps: "s", erectors: "s", hams: "s" },
    gearBack: [plateBack(pt(122, 116), 18)],
    gearFront: [barCap(pt(122, 108))],
  },
  row_onearm: {
    ground: G, shadowX: 104, shadowR: 62,
    head: { x: 54, y: 96, r: 10.5 },
    torso: { sh: pt(74, 108), hip: pt(124, 112) },
    legs: [leg(pt(124, 112), pt(150, 134), pt(152, 170), pt(168, 176), pt(142, 174))],
    farLegs: [leg(pt(120, 112), pt(114, 130), pt(116, 130), pt(126, 128))],
    farArms: [{ sh: pt(76, 110), elbow: pt(70, 124), hand: pt(66, 134) }],
    arms: [{ sh: pt(74, 110), elbow: pt(88, 128), hand: pt(86, 144) }],
    m: { back: "p", biceps: "s", delts: "s" },
    gearBack: [benchPad(pt(46, 140), pt(122, 140))],
    gearFront: [dbAt(pt(86, 150), 0, 8)],
  },
  pulldown: {
    ground: G, shadowX: 104, shadowR: 46,
    head: { x: 90, y: 66, r: 11 },
    torso: { sh: pt(96, 88), hip: pt(100, 142) },
    legs: [leg(pt(100, 142), pt(130, 148), pt(128, 172), pt(146, 176), pt(118, 176))],
    farLegs: [leg(pt(94, 144), pt(122, 152), pt(120, 174), pt(138, 178))],
    arms: [{ sh: pt(96, 88), elbow: pt(114, 62), hand: pt(122, 36) }],
    m: { back: "p", biceps: "s", delts: "s" },
    gearBack: [`<path d="M120 30 L126 8" stroke="${C.gearLine}" stroke-width="2"/>`,
      `<path d="M84 32 L152 32" stroke="${C.cap}" stroke-width="4" stroke-linecap="round"/>`],
  },
  facepull: {
    ground: G, shadowX: 98, shadowR: 42,
    head: { x: 92, y: 44, r: 11 },
    torso: { sh: pt(96, 64), hip: pt(92, 116) },
    legs: [leg(pt(92, 116), pt(96, 146), pt(94, 172), pt(116, 176), pt(82, 176))],
    farLegs: [leg(pt(86, 118), pt(90, 148), pt(88, 174), pt(110, 178))],
    arms: [{ sh: pt(96, 64), elbow: pt(122, 62), hand: pt(136, 54) }],
    m: { delts: "p", traps: "s", biceps: "s" },
    gearBack: [cableLine(pt(158, 34), pt(138, 52))],
  },
  lateral: {
    ground: G, shadowX: 100, shadowR: 48,
    head: { x: 98, y: 40, r: 11 },
    torso: { sh: pt(98, 60), hip: pt(96, 114) },
    legs: [leg(pt(96, 114), pt(100, 144), pt(98, 172), pt(120, 176), pt(86, 176))],
    farLegs: [leg(pt(90, 116), pt(94, 146), pt(92, 174), pt(114, 178))],
    farArms: [{ sh: pt(94, 62), elbow: pt(70, 60), hand: pt(50, 58) }],
    arms: [{ sh: pt(100, 62), elbow: pt(126, 60), hand: pt(148, 58) }],
    m: { delts: "p", traps: "s", core: "c" },
    gearFront: [dbAt(pt(154, 57), 90, 7), dbAt(pt(44, 57), 90, 7)],
  },
  rearfly: {
    ground: G, shadowX: 104, shadowR: 50,
    head: { x: 142, y: 62, r: 10.5 },
    torso: { sh: pt(126, 70), hip: pt(86, 102) },
    legs: [leg(pt(86, 102), pt(94, 142), pt(92, 172), pt(116, 176), pt(78, 176))],
    farLegs: [leg(pt(78, 104), pt(86, 144), pt(84, 174), pt(108, 178))],
    farArms: [{ sh: pt(124, 72), elbow: pt(106, 84), hand: pt(92, 90) }],
    arms: [{ sh: pt(126, 72), elbow: pt(142, 92), hand: pt(152, 106) }],
    m: { delts: "p", back: "s", traps: "s" },
    gearFront: [dbAt(pt(154, 112), 30, 7)],
  },
  curl: {
    ground: G, shadowX: 98, shadowR: 42,
    head: { x: 96, y: 42, r: 11 },
    torso: { sh: pt(98, 62), hip: pt(96, 116) },
    legs: [leg(pt(96, 116), pt(100, 146), pt(98, 172), pt(120, 176), pt(86, 176))],
    farLegs: [leg(pt(90, 118), pt(94, 148), pt(92, 174), pt(114, 178))],
    arms: [{ sh: pt(98, 64), elbow: pt(102, 96), hand: pt(126, 80) }],
    m: { biceps: "p", forearms: "s" },
    gearFront: [dbAt(pt(132, 77), 32, 9)],
  },
  pallof: {
    ground: G, shadowX: 100, shadowR: 44,
    head: { x: 96, y: 44, r: 11 },
    torso: { sh: pt(98, 64), hip: pt(96, 118) },
    legs: [leg(pt(96, 118), pt(112, 146), pt(110, 172), pt(132, 176), pt(98, 176))],
    farLegs: [leg(pt(88, 120), pt(74, 148), pt(72, 174), pt(90, 178))],
    arms: [{ sh: pt(98, 64), elbow: pt(116, 76), hand: pt(132, 86) }],
    m: { core: "p", delts: "s" },
    gearBack: [cableLine(pt(36, 52), pt(130, 84))],
  },
  plank: {
    ground: G, shadowX: 108, shadowR: 66,
    head: { x: 52, y: 112, r: 10.5 },
    torso: { sh: pt(72, 124), hip: pt(118, 132) },
    legs: [leg(pt(118, 132), pt(144, 142), pt(166, 154), pt(172, 172), pt(176, 160))],
    farLegs: [leg(pt(112, 134), pt(138, 146), pt(160, 158), pt(166, 174))],
    arms: [{ sh: pt(72, 124), elbow: pt(70, 154), hand: pt(92, 158) }],
    m: { core: "p", delts: "s", glutes: "s" },
  },
  run: {
    ground: G, shadowX: 100, shadowR: 52,
    head: { x: 110, y: 36, r: 11 },
    torso: { sh: pt(102, 56), hip: pt(94, 108) },
    legs: [leg(pt(94, 108), pt(122, 132), pt(112, 164), pt(130, 172), pt(102, 168))],
    farLegs: [leg(pt(90, 110), pt(66, 130), pt(52, 156), pt(40, 166))],
    farArms: [{ sh: pt(98, 58), elbow: pt(78, 74), hand: pt(66, 60) }],
    arms: [{ sh: pt(102, 58), elbow: pt(122, 74), hand: pt(138, 60) }],
    m: { quads: "p", calves: "p", hams: "s", glutes: "s", core: "c" },
  },

  // --- warm-up / cool-down / mobility (mobility-violet theme in the tile) -------
  walk: {
    ground: G, shadowX: 100, shadowR: 50,
    head: { x: 106, y: 38, r: 11 },
    torso: { sh: pt(100, 58), hip: pt(96, 112) },
    legs: [leg(pt(96, 112), pt(114, 140), pt(120, 170), pt(138, 174), pt(110, 174))],
    farLegs: [leg(pt(90, 114), pt(78, 140), pt(68, 166), pt(58, 172))],
    farArms: [{ sh: pt(98, 60), elbow: pt(82, 72), hand: pt(74, 86) }],
    arms: [{ sh: pt(100, 60), elbow: pt(116, 74), hand: pt(124, 88) }],
    m: { quads: "s", calves: "s", hams: "s", core: "c" },
  },
  bike: {
    ground: G, shadowX: 100, shadowR: 58,
    head: { x: 128, y: 58, r: 10.5 },
    torso: { sh: pt(114, 72), hip: pt(86, 110) },
    legs: [leg(pt(86, 110), pt(98, 140), pt(88, 156), pt(102, 160), pt(80, 156))],
    farLegs: [leg(pt(82, 112), pt(102, 134), pt(112, 150), pt(124, 150))],
    farArms: [{ sh: pt(112, 74), elbow: pt(126, 88), hand: pt(140, 98) }],
    arms: [{ sh: pt(116, 74), elbow: pt(130, 88), hand: pt(144, 98) }],
    m: { quads: "s", calves: "s", core: "c" },
    gearBack: [
      `<circle cx="58" cy="156" r="22" fill="none" stroke="${C.gearLine}" stroke-width="3"/><circle cx="58" cy="156" r="3" fill="${C.gearLine}"/>`,
      `<circle cx="146" cy="156" r="22" fill="none" stroke="${C.gearLine}" stroke-width="3"/><circle cx="146" cy="156" r="3" fill="${C.gearLine}"/>`,
      `<path d="M58 156 L100 156 L86 110 M100 156 L118 108 L146 156 M100 156 L100 148" stroke="${C.gearLine}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
      `<circle cx="100" cy="156" r="4" fill="${C.gearLine}"/><path d="M100 148 L88 156" stroke="${C.gearLine}" stroke-width="2.5"/>`,
      `<path d="M118 108 L142 98 M86 110 L80 100" stroke="${C.gearLine}" stroke-width="3" stroke-linecap="round"/>`,
    ],
  },
  hamstring: {
    ground: G, shadowX: 118, shadowR: 54,
    head: { x: 150, y: 82, r: 10.5 },
    torso: { sh: pt(138, 92), hip: pt(100, 108) },
    legs: [leg(pt(100, 108), pt(122, 142), pt(142, 172), pt(160, 176), pt(132, 176))],
    farLegs: [leg(pt(94, 110), pt(86, 146), pt(84, 174), pt(106, 178))],
    arms: [{ sh: pt(138, 94), elbow: pt(146, 124), hand: pt(152, 152) }],
    m: { hams: "p", erectors: "s", calves: "s", glutes: "s" },
  },
  quad: {
    ground: G, shadowX: 92, shadowR: 40,
    head: { x: 96, y: 42, r: 11 },
    torso: { sh: pt(98, 62), hip: pt(94, 116) },
    legs: [leg(pt(94, 116), pt(101, 150), pt(90, 114), pt(80, 106), pt(99, 122))],
    farLegs: [leg(pt(88, 118), pt(92, 150), pt(90, 174), pt(112, 178))],
    farArms: [{ sh: pt(94, 64), elbow: pt(114, 64), hand: pt(132, 60) }],
    arms: [{ sh: pt(98, 64), elbow: pt(96, 92), hand: pt(87, 114) }],
    m: { quads: "p", core: "c" },
  },
  hip: {
    ground: G, shadowX: 96, shadowR: 62,
    head: { x: 98, y: 46, r: 11 },
    torso: { sh: pt(98, 66), hip: pt(94, 120) },
    legs: [leg(pt(94, 120), pt(124, 146), pt(124, 174), pt(146, 176), pt(110, 176))],
    farLegs: [leg(pt(90, 122), pt(66, 174), pt(44, 176), pt(32, 178))],
    arms: [{ sh: pt(98, 68), elbow: pt(106, 96), hand: pt(120, 110) }],
    m: { quads: "s", glutes: "s", core: "c" },
  },
  calf_stretch: {
    ground: G, shadowX: 100, shadowR: 60,
    head: { x: 120, y: 60, r: 10.5 },
    torso: { sh: pt(126, 72), hip: pt(98, 104) },
    legs: [leg(pt(98, 104), pt(80, 138), pt(64, 172), pt(84, 176), pt(54, 176))],
    farLegs: [leg(pt(102, 106), pt(128, 138), pt(130, 170), pt(150, 176))],
    arms: [{ sh: pt(126, 74), elbow: pt(146, 72), hand: pt(164, 70) }],
    m: { calves: "p", glutes: "s", core: "c" },
    gearBack: [`<path d="M172 34 L172 176" stroke="${C.gearLine}" stroke-width="5" stroke-linecap="round"/>`],
  },
  chest: {
    ground: G, shadowX: 100, shadowR: 46,
    head: { x: 98, y: 44, r: 11 },
    torso: { sh: pt(102, 64), hip: pt(96, 116) },
    legs: [leg(pt(96, 116), pt(112, 146), pt(110, 172), pt(132, 176), pt(98, 176))],
    farLegs: [leg(pt(88, 118), pt(74, 148), pt(72, 174), pt(90, 178))],
    arms: [{ sh: pt(102, 66), elbow: pt(126, 64), hand: pt(128, 40) }],
    m: { chest: "p", delts: "s", core: "c" },
    gearFront: [`<path d="M132 28 L132 104" stroke="${C.gearLine}" stroke-width="5" stroke-linecap="round"/>`],
  },
  lat: {
    ground: G, shadowX: 100, shadowR: 46,
    head: { x: 100, y: 44, r: 11 },
    torso: { sh: pt(100, 64), hip: pt(94, 116) },
    legs: [leg(pt(94, 116), pt(98, 146), pt(96, 172), pt(118, 176), pt(84, 176))],
    farLegs: [leg(pt(88, 118), pt(92, 148), pt(90, 174), pt(112, 178))],
    farArms: [{ sh: pt(96, 66), elbow: pt(92, 92), hand: pt(90, 116) }],
    arms: [{ sh: pt(102, 64), elbow: pt(112, 40), hand: pt(124, 26) }],
    m: { lats: "p", core: "c" },
  },
  twist: {
    ground: G, shadowX: 108, shadowR: 62,
    head: { x: 104, y: 82, r: 11 },
    torso: { sh: pt(100, 100), hip: pt(96, 150) },
    legs: [leg(pt(96, 150), pt(122, 138), pt(140, 170), pt(158, 172), pt(132, 176))],
    farLegs: [leg(pt(92, 152), pt(70, 168), pt(46, 174), pt(34, 176))],
    farArms: [{ sh: pt(96, 102), elbow: pt(80, 122), hand: pt(66, 140) }],
    arms: [{ sh: pt(102, 102), elbow: pt(124, 112), hand: pt(142, 106) }],
    m: { core: "p", erectors: "s" },
    gearFront: [`<path d="M108 92 q16 4 12 16" stroke="#b89dff" stroke-width="2.4" fill="none" stroke-dasharray="3 3" opacity=".65"/>`],
  },
  glute: {
    ground: G, shadowX: 104, shadowR: 58,
    head: { x: 108, y: 92, r: 11 },
    torso: { sh: pt(102, 108), hip: pt(94, 152) },
    legs: [leg(pt(94, 152), pt(120, 142), pt(122, 172), pt(142, 174), pt(112, 176))],
    farLegs: [leg(pt(90, 152), pt(98, 128), pt(128, 140), pt(142, 134))],
    arms: [{ sh: pt(102, 110), elbow: pt(114, 124), hand: pt(130, 130) }],
    m: { glutes: "p", core: "c" },
  },
  worldsgreat: {
    ground: G, shadowX: 96, shadowR: 66,
    head: { x: 112, y: 52, r: 10.5 },
    torso: { sh: pt(104, 66), hip: pt(94, 116) },
    legs: [leg(pt(94, 116), pt(128, 146), pt(126, 172), pt(150, 176), pt(112, 176))],
    farLegs: [leg(pt(88, 118), pt(62, 150), pt(46, 172), pt(36, 178))],
    farArms: [{ sh: pt(102, 68), elbow: pt(108, 102), hand: pt(114, 140) }],
    arms: [{ sh: pt(104, 66), elbow: pt(118, 48), hand: pt(126, 26) }],
    m: { glutes: "p", quads: "s", core: "c", delts: "s" },
  },
  legswing: {
    ground: G, shadowX: 92, shadowR: 42,
    head: { x: 92, y: 42, r: 11 },
    torso: { sh: pt(94, 62), hip: pt(94, 116) },
    legs: [leg(pt(94, 116), pt(126, 122), pt(156, 118), pt(172, 112), pt(150, 126))],
    farLegs: [leg(pt(90, 118), pt(94, 148), pt(92, 174), pt(112, 178))],
    arms: [{ sh: pt(94, 64), elbow: pt(76, 74), hand: pt(58, 70) }],
    m: { quads: "s", hams: "s", glutes: "s", core: "c" },
    gearFront: [`<path d="M150 150 q18 4 20 -14" stroke="#b89dff" stroke-width="2.4" fill="none" stroke-dasharray="3 3" opacity=".65"/>`],
  },
  arms: {
    ground: G, shadowX: 100, shadowR: 46,
    head: { x: 98, y: 42, r: 11 },
    torso: { sh: pt(98, 62), hip: pt(96, 116) },
    legs: [leg(pt(96, 116), pt(100, 146), pt(98, 172), pt(120, 176), pt(86, 176))],
    farLegs: [leg(pt(90, 118), pt(94, 148), pt(92, 174), pt(114, 178))],
    farArms: [{ sh: pt(94, 62), elbow: pt(72, 74), hand: pt(50, 84) }],
    arms: [{ sh: pt(100, 62), elbow: pt(124, 52), hand: pt(148, 42) }],
    m: { delts: "p", traps: "s", core: "c" },
    gearFront: [`<path d="M150 42 a7 7 0 1 0 5 -3" stroke="#b89dff" stroke-width="2.4" fill="none" stroke-dasharray="3 3" opacity=".7"/>`,
      `<path d="M50 84 a7 7 0 1 1 -5 3" stroke="#b89dff" stroke-width="2.4" fill="none" stroke-dasharray="3 3" opacity=".7"/>`],
  },
  ankle: {
    ground: G, shadowX: 92, shadowR: 42,
    head: { x: 94, y: 42, r: 11 },
    torso: { sh: pt(96, 62), hip: pt(94, 116) },
    legs: [leg(pt(94, 116), pt(108, 146), pt(114, 166), pt(128, 164), pt(106, 170))],
    farLegs: [leg(pt(88, 118), pt(92, 150), pt(90, 174), pt(112, 178))],
    arms: [{ sh: pt(96, 64), elbow: pt(78, 72), hand: pt(60, 68) }],
    m: { calves: "s", core: "c" },
    gearFront: [`<path d="M126 164 a6 6 0 1 1 4 6" stroke="#b89dff" stroke-width="2.4" fill="none" stroke-dasharray="3 3" opacity=".7"/>`],
  },
  hipcircle: {
    ground: G, shadowX: 96, shadowR: 46,
    head: { x: 96, y: 42, r: 11 },
    torso: { sh: pt(98, 62), hip: pt(96, 118) },
    legs: [leg(pt(96, 118), pt(108, 148), pt(106, 174), pt(128, 178), pt(96, 176))],
    farLegs: [leg(pt(88, 120), pt(84, 150), pt(86, 174), pt(108, 178))],
    farArms: [{ sh: pt(94, 64), elbow: pt(78, 80), hand: pt(90, 116) }],
    arms: [{ sh: pt(100, 64), elbow: pt(118, 82), hand: pt(104, 116) }],
    m: { glutes: "s", core: "p" },
    gearFront: [`<ellipse cx="96" cy="122" rx="22" ry="9" stroke="#b89dff" stroke-width="2.4" fill="none" stroke-dasharray="3 3" opacity=".7"/>`],
  },
  wallslide: {
    ground: G, shadowX: 100, shadowR: 44,
    head: { x: 98, y: 42, r: 11 },
    torso: { sh: pt(100, 64), hip: pt(98, 118) },
    legs: [leg(pt(98, 118), pt(112, 148), pt(110, 174), pt(132, 178), pt(98, 176))],
    farLegs: [leg(pt(92, 120), pt(96, 150), pt(94, 176), pt(116, 180))],
    farArms: [{ sh: pt(96, 66), elbow: pt(78, 62), hand: pt(76, 38) }],
    arms: [{ sh: pt(102, 66), elbow: pt(122, 62), hand: pt(124, 36) }],
    m: { back: "p", delts: "s", traps: "s" },
    gearBack: [`<path d="M84 34 L84 176" stroke="${C.gearLine}" stroke-width="5" stroke-linecap="round"/>`],
    gearFront: [`<path d="M122 30 l0 -6 m-3 3 l3 -3 l3 3" stroke="#b89dff" stroke-width="2.2" fill="none" stroke-dasharray="3 2" opacity=".7"/>`,
      `<path d="M76 32 l0 -6 m-3 3 l3 -3 l3 3" stroke="#b89dff" stroke-width="2.2" fill="none" stroke-dasharray="3 2" opacity=".7"/>`],
  },

  // ---- mobility & stability program (2026-07-23) --------------------------
  // Half-kneeling hip flexor stretch, rear foot up on the couch behind.
  couchstretch: {
    ground: G, shadowX: 96, shadowR: 64,
    head: { x: 100, y: 52, r: 11 },
    torso: { sh: pt(100, 70), hip: pt(94, 122) },
    legs: [leg(pt(94, 122), pt(128, 142), pt(126, 172), pt(148, 176), pt(112, 176))],
    farLegs: [leg(pt(90, 124), pt(64, 168), pt(38, 150), pt(30, 138))],
    arms: [{ sh: pt(100, 72), elbow: pt(112, 98), hand: pt(124, 124) }],
    m: { quads: "s", glutes: "p", core: "c" },
    gearBack: [benchPad(pt(16, 148), pt(56, 148), 9),
      `<path d="M14 148 L14 112" stroke="${C.bench}" stroke-width="9" stroke-linecap="round"/>`],
    gearFront: [`<path d="M88 106 l10 2 m-4 -5 l4 5 l-5 3" stroke="#b89dff" stroke-width="2.2" fill="none" stroke-dasharray="3 2" opacity=".7"/>`],
  },
  // 90/90 seated hip switch — front shin flat ahead, rear shin folded behind;
  // the dashed arc shows the knees sweeping side to side.
  ninety: {
    ground: G, shadowX: 96, shadowR: 60,
    head: { x: 82, y: 58, r: 11 },
    torso: { sh: pt(84, 76), hip: pt(82, 136) },
    legs: [leg(pt(82, 136), pt(122, 146), pt(152, 162), pt(166, 168), pt(148, 172))],
    farLegs: [leg(pt(78, 138), pt(50, 154), pt(36, 132), pt(32, 120))],
    arms: [{ sh: pt(84, 78), elbow: pt(98, 102), hand: pt(112, 124) }],
    m: { glutes: "s", core: "c" },
    gearFront: [`<path d="M52 166 q46 16 96 -2 m-8 -4 l8 4 l-7 5" stroke="#b89dff" stroke-width="2.4" fill="none" stroke-dasharray="3 3" opacity=".65"/>`],
  },
  // Adductor rock-back: quadruped, one leg long to the side, hips easing back —
  // the dashed arrow shows the rock toward the heels.
  rockback: {
    ground: G, shadowX: 110, shadowR: 66,
    head: { x: 58, y: 96, r: 10.5 },
    torso: { sh: pt(76, 108), hip: pt(116, 114) },
    legs: [leg(pt(116, 114), pt(150, 130), pt(180, 146), pt(190, 152), pt(182, 156))],
    farLegs: [leg(pt(112, 116), pt(134, 150), pt(150, 170), pt(162, 174))],
    arms: [{ sh: pt(76, 108), elbow: pt(74, 140), hand: pt(76, 166) }],
    farArms: [{ sh: pt(74, 110), elbow: pt(66, 140), hand: pt(64, 166) }],
    m: { hams: "s", glutes: "s", core: "c" },
    gearFront: [`<path d="M132 96 q-14 -8 -28 -4 m6 -4 l-6 4 l7 4" stroke="#b89dff" stroke-width="2.4" fill="none" stroke-dasharray="3 3" opacity=".7"/>`],
  },
  // Knee-over-toes ankle rock — half-kneel at the wall, knee driving past toes;
  // the dashed arrow marks the knee travelling forward over the foot.
  anklerock: {
    ground: G, shadowX: 96, shadowR: 60,
    head: { x: 104, y: 64, r: 11 },
    torso: { sh: pt(104, 82), hip: pt(96, 130) },
    legs: [leg(pt(96, 130), pt(136, 138), pt(122, 170), pt(142, 176), pt(112, 176))],
    farLegs: [leg(pt(92, 132), pt(70, 168), pt(46, 164), pt(34, 168))],
    arms: [{ sh: pt(104, 84), elbow: pt(118, 106), hand: pt(132, 128) }],
    m: { calves: "p", quads: "s", core: "c" },
    gearBack: [`<path d="M154 44 L154 176" stroke="${C.gearLine}" stroke-width="6" stroke-linecap="round"/>`],
    gearFront: [`<path d="M128 124 q10 4 14 12 m-1 -7 l1 7 l-7 1" stroke="#b89dff" stroke-width="2.4" fill="none" stroke-dasharray="3 3" opacity=".7"/>`],
  },
  // Tibialis raise — back on the wall, heels out front, both forefeet lifted
  // high (the toes-up is the whole movement, so it's exaggerated).
  tibraise: {
    ground: G, shadowX: 100, shadowR: 48,
    head: { x: 76, y: 42, r: 11 },
    torso: { sh: pt(74, 60), hip: pt(82, 112) },
    legs: [leg(pt(82, 112), pt(98, 142), pt(108, 166), pt(130, 144), pt(102, 176))],
    farLegs: [leg(pt(78, 114), pt(92, 144), pt(102, 168), pt(124, 148))],
    arms: [{ sh: pt(74, 62), elbow: pt(82, 90), hand: pt(90, 114) }],
    m: { core: "c" },
    gearBack: [`<path d="M58 30 L58 176" stroke="${C.gearLine}" stroke-width="6" stroke-linecap="round"/>`],
    gearFront: [`<path d="M138 168 q6 -10 0 -20 m4 7 l-4 -7 l-6 5" stroke="#b89dff" stroke-width="2.4" fill="none" stroke-dasharray="3 3" opacity=".7"/>`],
  },
  // Bent-knee (soleus) calf raise, hands on the wall for balance.
  soleus: {
    ground: G, shadowX: 104, shadowR: 44,
    head: { x: 102, y: 32, r: 11 },
    torso: { sh: pt(100, 50), hip: pt(94, 102) },
    legs: [leg(pt(94, 102), pt(114, 136), pt(106, 162), pt(124, 172), pt(92, 158))],
    farLegs: [leg(pt(90, 104), pt(108, 140), pt(100, 164), pt(118, 174))],
    arms: [{ sh: pt(100, 52), elbow: pt(122, 62), hand: pt(146, 70) }],
    m: { calves: "p", core: "c" },
    gearBack: [`<path d="M152 40 L152 176" stroke="${C.gearLine}" stroke-width="6" stroke-linecap="round"/>`],
    gearFront: [`<path d="M76 168 q2 -10 12 -14 m-8 1 l8 -1 l1 8" stroke="#b89dff" stroke-width="2.4" fill="none" stroke-dasharray="3 3" opacity=".7"/>`],
  },
  // Floor glute bridge — shoulders down, hips pressed high; dashed arrow = drive up.
  bridge: {
    ground: G, shadowX: 104, shadowR: 62,
    head: { x: 44, y: 152, r: 10.5 },
    torso: { sh: pt(62, 150), hip: pt(106, 122) },
    legs: [leg(pt(106, 122), pt(138, 130), pt(140, 168), pt(154, 174), pt(132, 174))],
    farLegs: [leg(pt(102, 124), pt(132, 134), pt(134, 170), pt(148, 176))],
    arms: [{ sh: pt(64, 152), elbow: pt(84, 164), hand: pt(104, 170) }],
    m: { glutes: "p", hams: "s", core: "c" },
    gearFront: [`<path d="M104 104 l0 -14 m-5 5 l5 -5 l5 5" stroke="#b89dff" stroke-width="2.4" fill="none" stroke-dasharray="3 2" opacity=".7"/>`],
  },
  // Side plank — forearm support, body one straight diagonal, top arm raised.
  sideplank: {
    ground: G, shadowX: 110, shadowR: 66,
    head: { x: 48, y: 92, r: 10.5 },
    torso: { sh: pt(66, 106), hip: pt(108, 126) },
    legs: [leg(pt(108, 126), pt(138, 142), pt(164, 158), pt(178, 166), pt(168, 170))],
    farLegs: [leg(pt(104, 128), pt(134, 146), pt(160, 162), pt(174, 170))],
    arms: [{ sh: pt(66, 106), elbow: pt(62, 144), hand: pt(84, 152) },
           { sh: pt(66, 104), elbow: pt(70, 80), hand: pt(74, 56) }],
    m: { core: "p", glutes: "s", delts: "s" },
  },
  // Dead bug — supine, one arm reaching up, opposite leg extending long + low;
  // the other leg holds table-top. Dashed arrows = the slow extend.
  deadbug: {
    ground: G, shadowX: 100, shadowR: 68,
    head: { x: 40, y: 160, r: 10.5 },
    torso: { sh: pt(58, 158), hip: pt(102, 160) },
    legs: [leg(pt(102, 160), pt(118, 122), pt(146, 126), pt(156, 134), pt(144, 120))],
    farLegs: [leg(pt(98, 162), pt(138, 152), pt(172, 148), pt(184, 146))],
    arms: [{ sh: pt(58, 158), elbow: pt(54, 124), hand: pt(52, 94) }],
    farArms: [{ sh: pt(56, 160), elbow: pt(36, 156), hand: pt(18, 152) }],
    m: { core: "p" },
    gearFront: [`<path d="M164 138 l14 -4 m-7 -3 l7 3 l-5 6" stroke="#b89dff" stroke-width="2.2" fill="none" stroke-dasharray="3 2" opacity=".7"/>`,
      `<path d="M44 96 l-8 -10 m8 1 l-8 -1 l0 9" stroke="#b89dff" stroke-width="2.2" fill="none" stroke-dasharray="3 2" opacity=".7"/>`],
  },
  // Side-lying leg raise — bottom leg long on the floor, top leg lifting;
  // dashed arc = the lift from the hip.
  sideleg: {
    ground: G, shadowX: 100, shadowR: 70,
    head: { x: 36, y: 150, r: 10.5 },
    torso: { sh: pt(56, 150), hip: pt(100, 154) },
    legs: [leg(pt(100, 154), pt(132, 138), pt(162, 122), pt(174, 114), pt(168, 130))],
    farLegs: [leg(pt(96, 156), pt(130, 162), pt(162, 166), pt(176, 170))],
    arms: [{ sh: pt(56, 150), elbow: pt(40, 164), hand: pt(24, 152) }],
    m: { glutes: "p", core: "c" },
    gearFront: [`<path d="M156 148 q14 -10 16 -26 m3 8 l-3 -8 l-8 4" stroke="#b89dff" stroke-width="2.4" fill="none" stroke-dasharray="3 3" opacity=".7"/>`],
  },
  // Copenhagen plank — forearm down, top foot on the pad, bottom knee bent under.
  copenhagen: {
    ground: G, shadowX: 104, shadowR: 66,
    head: { x: 44, y: 88, r: 10.5 },
    torso: { sh: pt(62, 102), hip: pt(104, 124) },
    legs: [leg(pt(104, 124), pt(134, 134), pt(156, 144), pt(168, 146), pt(158, 150))],
    farLegs: [leg(pt(100, 126), pt(122, 148), pt(136, 168), pt(148, 172))],
    arms: [{ sh: pt(62, 102), elbow: pt(58, 140), hand: pt(80, 148) }],
    m: { core: "p", hams: "s", delts: "s" },
    gearBack: [benchPad(pt(126, 150), pt(176, 150))],
  },
  // Wall sit — back flat on the wall, thighs level, shins vertical.
  wallsit: {
    ground: G, shadowX: 104, shadowR: 52,
    head: { x: 66, y: 58, r: 11 },
    torso: { sh: pt(68, 76), hip: pt(74, 126) },
    legs: [leg(pt(74, 126), pt(116, 128), pt(112, 170), pt(132, 176), pt(104, 176))],
    farLegs: [leg(pt(70, 128), pt(110, 132), pt(106, 172), pt(124, 178))],
    arms: [{ sh: pt(68, 78), elbow: pt(84, 102), hand: pt(100, 122) }],
    m: { quads: "p", core: "c" },
    gearBack: [`<path d="M56 36 L56 176" stroke="${C.gearLine}" stroke-width="6" stroke-linecap="round"/>`],
  },
  // Slow step-down — stance foot on the step, free leg hanging clear off the
  // edge, heel lowering to a tap (dashed arrow = the 3 s descent).
  stepdown: {
    ground: G, shadowX: 118, shadowR: 58,
    head: { x: 124, y: 32, r: 11 },
    torso: { sh: pt(122, 52), hip: pt(116, 106) },
    legs: [leg(pt(116, 106), pt(134, 124), pt(126, 144), pt(142, 148), pt(114, 148))],
    farLegs: [leg(pt(112, 108), pt(102, 138), pt(88, 164), pt(96, 170))],
    arms: [{ sh: pt(122, 54), elbow: pt(142, 68), hand: pt(158, 60) }],
    m: { quads: "p", glutes: "s", core: "c" },
    gearBack: [benchPad(pt(108, 148), pt(164, 148))],
    gearFront: [`<path d="M78 148 l0 20 m-5 -6 l5 6 l5 -6" stroke="#b89dff" stroke-width="2.4" fill="none" stroke-dasharray="3 2" opacity=".7"/>`],
  },
  // Dead hang — full grip on the rack's pull-up bar, feet clear of the floor,
  // shoulders relaxed long (spinal decompression). A cool-down item.
  deadhang: {
    ground: G, shadowX: 100, shadowR: 34,
    head: { x: 100, y: 58, r: 10.5 },
    torso: { sh: pt(100, 76), hip: pt(102, 126) },
    legs: [leg(pt(102, 126), pt(104, 148), pt(101, 166), pt(106, 173), pt(98, 172))],
    farLegs: [leg(pt(98, 128), pt(99, 150), pt(96, 168), pt(101, 175))],
    arms: [{ sh: pt(100, 76), elbow: pt(95, 52), hand: pt(93, 30) }],
    farArms: [{ sh: pt(102, 78), elbow: pt(107, 52), hand: pt(109, 30) }],
    m: { lats: "p", delts: "s", forearms: "s" },
    gearBack: [`<path d="M46 26 L154 26" stroke="${C.gearLine}" stroke-width="7" stroke-linecap="round"/>`,
      `<path d="M52 26 L52 62 M148 26 L148 62" stroke="${C.gearLine}" stroke-width="5" stroke-linecap="round" opacity=".55"/>`],
    gearFront: [`<path d="M124 118 l0 16 m-4 -5 l4 5 l4 -5" stroke="#b89dff" stroke-width="2.2" fill="none" stroke-dasharray="3 2" opacity=".65"/>`],
  },
  // DB pullover — lying on the bench, one dumbbell in both hands reaching long
  // behind the head (dashed arc = the overhead reach); lats + chest stretched.
  pullover: {
    ground: G, shadowX: 100, shadowR: 64,
    head: { x: 52, y: 124, r: 10.5 },
    torso: { sh: pt(74, 130), hip: pt(120, 132) },
    legs: [leg(pt(120, 132), pt(148, 148), pt(150, 172), pt(166, 176), pt(140, 176))],
    farLegs: [leg(pt(114, 134), pt(140, 152), pt(142, 174), pt(158, 178))],
    arms: [{ sh: pt(74, 130), elbow: pt(52, 112), hand: pt(32, 96) }],
    m: { lats: "p", chest: "s", triceps: "s", core: "c" },
    gearBack: [benchPad(pt(36, 148), pt(120, 148))],
    gearFront: [dbAt(pt(32, 96), -35, 9),
      `<path d="M64 78 q-20 4 -30 20 m10 -6 l-10 6 l9 6" stroke="#b89dff" stroke-width="2.4" fill="none" stroke-dasharray="3 3" opacity=".7"/>`],
  },
  // DB step-up — the step-down pose driven the other way: dashed arrow UP,
  // free leg rising to the box instead of lowering off it.
  stepup: {
    ground: G, shadowX: 118, shadowR: 58,
    head: { x: 124, y: 32, r: 11 },
    torso: { sh: pt(122, 52), hip: pt(116, 106) },
    legs: [leg(pt(116, 106), pt(134, 124), pt(126, 144), pt(142, 148), pt(114, 148))],
    farLegs: [leg(pt(112, 108), pt(100, 136), pt(92, 160), pt(102, 166))],
    arms: [{ sh: pt(122, 54), elbow: pt(138, 74), hand: pt(146, 94) }],
    m: { quads: "p", glutes: "p", core: "c" },
    gearBack: [benchPad(pt(108, 148), pt(164, 148))],
    gearFront: [dbAt(pt(146, 96), 0, 8),
      `<path d="M78 168 l0 -20 m-5 6 l5 -6 l5 6" stroke="#b89dff" stroke-width="2.4" fill="none" stroke-dasharray="3 2" opacity=".7"/>`],
  },
  // Ramp-up sets — standing at the bar, light plates, about to work up.
  rampup: {
    ground: G, shadowX: 104, shadowR: 48,
    head: { x: 104, y: 40, r: 11 },
    torso: { sh: pt(102, 60), hip: pt(96, 114) },
    legs: [leg(pt(96, 114), pt(104, 144), pt(102, 172), pt(124, 176), pt(92, 176))],
    farLegs: [leg(pt(90, 116), pt(96, 146), pt(94, 174), pt(116, 178))],
    arms: [{ sh: pt(102, 62), elbow: pt(108, 92), hand: pt(113, 120) }],
    m: { forearms: "s", core: "c" },
    gearBack: [plateBack(pt(113, 132), 14)],
    gearFront: [barCap(pt(113, 126))],
  },
  // Bird dog — quadruped, opposite arm and leg reaching long, hips level;
  // dashed arrows = both ends reaching away from each other.
  birddog: {
    ground: G, shadowX: 110, shadowR: 70,
    head: { x: 56, y: 90, r: 10.5 },
    torso: { sh: pt(74, 102), hip: pt(118, 108) },
    legs: [leg(pt(118, 108), pt(150, 102), pt(180, 96), pt(192, 92), pt(184, 102))],
    farLegs: [leg(pt(114, 110), pt(138, 144), pt(154, 168), pt(166, 172))],
    arms: [{ sh: pt(74, 102), elbow: pt(48, 96), hand: pt(24, 90) }],
    farArms: [{ sh: pt(76, 104), elbow: pt(76, 138), hand: pt(78, 164) }],
    m: { glutes: "p", core: "p", erectors: "s" },
    gearFront: [`<path d="M30 80 l-12 -4 m8 -3 l-8 3 l3 8" stroke="#b89dff" stroke-width="2.2" fill="none" stroke-dasharray="3 2" opacity=".7"/>`,
      `<path d="M182 84 l12 -4 m-8 -3 l8 3 l-3 8" stroke="#b89dff" stroke-width="2.2" fill="none" stroke-dasharray="3 2" opacity=".7"/>`],
  },
};

export const hasPose = (key) => !!POSES[key];
