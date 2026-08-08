// theme.js — the app's theme registry and applier.
//
// THE CONSTRAINT THAT SHAPES ALL OF THIS: the palette does two different jobs
// at once, and only one of them may be themed.
//
//   BRAND colours are decoration — the CTA, the progress ring, the aurora, the
//   glow. Changing them changes how the app feels and nothing else.
//
//   DATA colours are MEANING. Mint is strength, cyan is cardio, violet is
//   recovery, coral is intensity. Those four appear unlabelled in charts, on
//   the muscle map, in the volume bars and on the illustration tiles (which are
//   keyed to muscle group). Recolouring them per theme would not restyle the
//   app, it would make every chart in it say something different.
//
// So a theme varies surfaces and the brand accent, and the data palette is
// declared once and never overridden. The old CSS conflated the two — `--accent`
// was simultaneously the brand mint AND the strength data colour — so this
// splits them: `--accent` stays the themeable brand colour (it is used in
// hundreds of places for CTAs and would be churn to rename), and `--data-*` are
// the fixed semantic hues that charts and maps must use.
//
// All five themes are dark. A light theme is not a palette swap: the aurora
// backdrop, the glass surfaces and every contrast decision invert, so it is its
// own piece of work rather than a sixth entry in this list.

export const THEMES = [
  {
    id: "aurora",
    name: "Aurora",
    blurb: "Mint on near-black. The original.",
    swatch: ["#0a0b0e", "#2fe6a6"],
    vars: {
      "--bg": "#0a0b0e", "--bg-1": "#101216", "--bg-elev": "#14171d",
      "--bg-elev2": "#1c2027", "--bg-elev3": "#262b34", "--bg-elev-hero": "#1b202a",
      "--line": "#23272f", "--line-soft": "#1a1d23",
      "--text": "#f1f4f9", "--text-dim": "#8b93a1", "--text-faint": "#565d6a",
      "--accent": "#2fe6a6", "--accent-press": "#20c98e", "--accent-ghost": "#0f2a22",
      "--on-accent": "#042016", "--accent-shadow": "47,230,166",
      "--grad-cta": "linear-gradient(118deg, #5effcd 0%, #16b88a 100%)",
      "--grad-vibrant": "linear-gradient(125deg, #34e3a0 0%, #38bdf8 55%, #a78bfa 100%)",
      "--glow": "0 0 0 1px rgba(47,230,166,.15), 0 8px 30px rgba(47,230,166,.12)",
      "--aurora-1": "47,230,166", "--aurora-2": "56,189,248", "--aurora-3": "167,139,250",
    },
  },
  {
    id: "ice",
    name: "Ice",
    blurb: "Cold blue on deep navy. Calm and clinical.",
    swatch: ["#080b12", "#4cc9ff"],
    vars: {
      "--bg": "#080b12", "--bg-1": "#0d1220", "--bg-elev": "#121a2b",
      "--bg-elev2": "#1a2437", "--bg-elev3": "#243149", "--bg-elev-hero": "#1b263c",
      "--line": "#233149", "--line-soft": "#182132",
      "--text": "#eef4ff", "--text-dim": "#8c9bb5", "--text-faint": "#566277",
      "--accent": "#4cc9ff", "--accent-press": "#2ba7e0", "--accent-ghost": "#0d2436",
      "--on-accent": "#041a26", "--accent-shadow": "76,201,255",
      "--grad-cta": "linear-gradient(118deg, #7fdcff 0%, #2b8fd6 100%)",
      "--grad-vibrant": "linear-gradient(125deg, #4cc9ff 0%, #7c93e8 55%, #b89dff 100%)",
      "--glow": "0 0 0 1px rgba(76,201,255,.16), 0 8px 30px rgba(76,201,255,.13)",
      "--aurora-1": "76,201,255", "--aurora-2": "124,147,232", "--aurora-3": "167,139,250",
    },
  },
  {
    id: "ember",
    name: "Ember",
    blurb: "Warm amber on charcoal. Reads well in a dim gym.",
    swatch: ["#0d0b09", "#fbaa3c"],
    vars: {
      "--bg": "#0d0b09", "--bg-1": "#15110d", "--bg-elev": "#1b1712",
      "--bg-elev2": "#241f18", "--bg-elev3": "#302921", "--bg-elev-hero": "#241e17",
      "--line": "#2e2820", "--line-soft": "#221d17",
      "--text": "#f8f2ea", "--text-dim": "#a39684", "--text-faint": "#6b6053",
      "--accent": "#fbaa3c", "--accent-press": "#dc8c22", "--accent-ghost": "#2e2110",
      "--on-accent": "#241505", "--accent-shadow": "251,170,60",
      "--grad-cta": "linear-gradient(118deg, #ffc76b 0%, #e08b1c 100%)",
      "--grad-vibrant": "linear-gradient(125deg, #fbaa3c 0%, #fb7185 55%, #a78bfa 100%)",
      "--glow": "0 0 0 1px rgba(251,170,60,.16), 0 8px 30px rgba(251,170,60,.12)",
      "--aurora-1": "251,170,60", "--aurora-2": "251,113,133", "--aurora-3": "167,139,250",
    },
  },
  {
    id: "violet",
    name: "Violet",
    blurb: "Ultraviolet on true black. High contrast, low light.",
    swatch: ["#07070c", "#a78bfa"],
    vars: {
      "--bg": "#07070c", "--bg-1": "#0e0d18", "--bg-elev": "#151327",
      "--bg-elev2": "#1e1b33", "--bg-elev3": "#292544", "--bg-elev-hero": "#1f1b36",
      "--line": "#2a2542", "--line-soft": "#1e1a31",
      "--text": "#f3f0ff", "--text-dim": "#9a92b8", "--text-faint": "#605a7a",
      "--accent": "#a78bfa", "--accent-press": "#8b6ce8", "--accent-ghost": "#1d1638",
      "--on-accent": "#150a2e", "--accent-shadow": "167,139,250",
      "--grad-cta": "linear-gradient(118deg, #c4b1ff 0%, #7c5ce0 100%)",
      "--grad-vibrant": "linear-gradient(125deg, #a78bfa 0%, #38bdf8 55%, #34e3a0 100%)",
      "--glow": "0 0 0 1px rgba(167,139,250,.18), 0 8px 30px rgba(167,139,250,.14)",
      "--aurora-1": "167,139,250", "--aurora-2": "56,189,248", "--aurora-3": "52,227,160",
    },
  },
  {
    id: "slate",
    name: "Slate",
    blurb: "Neutral grey, muted accent. Nothing shouts.",
    swatch: ["#0c0d0f", "#9aa6b2"],
    vars: {
      "--bg": "#0c0d0f", "--bg-1": "#131519", "--bg-elev": "#181b20",
      "--bg-elev2": "#20242b", "--bg-elev3": "#2b3038", "--bg-elev-hero": "#1f232a",
      "--line": "#282d35", "--line-soft": "#1d2128",
      "--text": "#eef1f5", "--text-dim": "#8d96a3", "--text-faint": "#59616c",
      "--accent": "#9aa6b2", "--accent-press": "#7d8894", "--accent-ghost": "#1e232a",
      "--on-accent": "#10151a", "--accent-shadow": "154,166,178",
      "--grad-cta": "linear-gradient(118deg, #c3ccd6 0%, #77828f 100%)",
      "--grad-vibrant": "linear-gradient(125deg, #9aa6b2 0%, #7c93e8 55%, #a78bfa 100%)",
      "--glow": "0 0 0 1px rgba(154,166,178,.14), 0 8px 26px rgba(0,0,0,.5)",
      "--aurora-1": "154,166,178", "--aurora-2": "124,147,232", "--aurora-3": "140,150,165",
    },
  },
];

export const DEFAULT_THEME = "aurora";
export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];

// Apply a theme by writing its variables onto the root element. Deliberately
// inline styles rather than a stylesheet swap: it is instant, needs no extra
// network request, and survives the service worker serving a stale CSS file.
export function applyTheme(id) {
  const t = themeById(id);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
  root.setAttribute("data-theme", t.id);
  // Keep the browser chrome (iOS status bar, Android toolbar) in step with the
  // page. The manifest's theme_color is baked at install time and can't follow,
  // so this meta tag is the only part that can.
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
  meta.content = t.vars["--bg"];
  return t;
}

// Read a resolved CSS variable. Canvas and inline SVG can't use var(), so the
// aurora canvas and the chart gradients read their colours back out through
// this instead of carrying their own hardcoded copies — which is what made them
// ignore the theme before.
export function cssVar(name, fallback = "") {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch (_) { return fallback; }
}

// The three aurora stops as [r,g,b] triples, for the canvas backdrop.
export function auroraRGB() {
  const parse = (n, fb) => {
    const raw = cssVar(n);
    const parts = raw.split(",").map((x) => Number(x.trim()));
    return parts.length === 3 && parts.every(Number.isFinite) ? parts : fb;
  };
  return [
    parse("--aurora-1", [47, 230, 166]),
    parse("--aurora-2", [56, 189, 248]),
    parse("--aurora-3", [167, 139, 250]),
  ];
}

// The signature gradient's three stops, for inline SVG <linearGradient>.
export function auroraStops() {
  const [a, b, c] = auroraRGB();
  const hex = ([r, g, bl]) => "#" + [r, g, bl].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("");
  return [hex(a), hex(b), hex(c)];
}
