// yoga/styles.js — the four style families and the parameters that make a
// sequence belong to one rather than another. Pure data.
//
// THE DISTINCTION THAT MATTERS IS FIXED vs COMPOSED, NOT VIGOUR. Ashtanga's
// Primary Series is identical every practice, so it ships as authored data
// (yoga/ashtanga.js) while everything else is generated. Generating an
// "Ashtanga-style" sequence would just be Power yoga wearing the name.
//
// HOLDS COME IN TWO UNITS AND BOTH ARE REAL. A vinyasa hold is counted in
// BREATHS (3-5) because the movement is tied to the breath; a yin hold is
// counted in MINUTES because the target tissue needs time, and nobody counts
// 60 breaths. So a style declares one or the other, and the generator resolves
// whichever it gets into the seconds the player actually runs on.

/** Seconds per breath at a normal practice pace. Configurable per person. */
export const BREATH_SECONDS_DEFAULT = 5;
export const BREATH_SECONDS_RANGE = [3, 8];

export const STYLES = {
  vinyasa: {
    id: "vinyasa",
    name: "Vinyasa",
    family: "Vinyasa / Power",
    blurb: "One breath, one movement. Continuous, warming, built around a peak.",
    holdBreaths: [3, 5],
    holdSeconds: null,
    flowLinked: true,            // sun salutations run as linked movement
    transitionSeconds: 4,        // standing-to-standing needs almost nothing
    floorTransitionSeconds: 8,
    savasanaShare: [0.10, 0.15],
    peakAt: [0.60, 0.70],        // fraction of session elapsed at the peak
    intensityBand: [2, 5],
    mets: 3.3,
    // How many poses specifically prepare the peak. More complex peaks need more:
    // the teaching convention is 6-8 for a wheel, 3-4 for a triangle.
    prepCount: { 1: 4, 2: 6, 3: 8 },
    allowPeak: true,
    props: false,
  },
  hatha: {
    id: "hatha",
    name: "Hatha",
    family: "Hatha / Iyengar",
    blurb: "Discrete poses held longer, with alignment and props rather than flow.",
    holdBreaths: [6, 10],
    holdSeconds: null,
    flowLinked: false,
    transitionSeconds: 8,
    floorTransitionSeconds: 12,
    savasanaShare: [0.10, 0.20],
    peakAt: [0.60, 0.70],
    intensityBand: [1, 4],
    mets: 2.9,
    prepCount: { 1: 3, 2: 5, 3: 6 },
    allowPeak: true,
    props: true,
  },
  yin: {
    id: "yin",
    name: "Yin",
    family: "Yin / Restorative",
    blurb: "Few poses, held for minutes, muscles deliberately passive.",
    holdBreaths: null,
    holdSeconds: [150, 300],     // 2.5-5 min, the connective-tissue window
    flowLinked: false,
    transitionSeconds: 20,       // getting into a propped shape takes real time
    floorTransitionSeconds: 20,
    savasanaShare: [0.12, 0.20],
    peakAt: null,                // NO PEAK. A yin sequence has no arc to climb.
    // Wide enough to include a supported twist or a sleeping swan. At [1,2] the
    // eligible pool collapsed to restorative and supine shapes and a wind-down
    // was two families deep, which is not a practice, it is a nap with steps.
    intensityBand: [1, 3],
    mets: 2.3,
    prepCount: {},
    allowPeak: false,
    props: true,
  },
  restorative: {
    id: "restorative",
    name: "Restorative",
    family: "Yin / Restorative",
    blurb: "Fully supported shapes held long. Closer to rest than to exercise.",
    holdBreaths: null,
    holdSeconds: [300, 600],
    flowLinked: false,
    transitionSeconds: 30,
    floorTransitionSeconds: 30,
    savasanaShare: [0.15, 0.25],
    peakAt: null,
    intensityBand: [1, 2],
    mets: 2.0,
    prepCount: {},
    allowPeak: false,
    props: true,
  },
  ashtanga: {
    id: "ashtanga",
    name: "Ashtanga",
    family: "Ashtanga",
    blurb: "The Primary Series, unchanged every practice. Five breaths, fixed order.",
    // Five breaths is the method, but the FINISHING postures are traditionally
    // held far longer — shoulderstand and headstand for fifteen breaths or more.
    // A [5,5] band graded the series' own closing sequence as a defect.
    holdBreaths: [5, 15],
    holdSeconds: null,
    flowLinked: true,
    transitionSeconds: 4,
    floorTransitionSeconds: 6,
    savasanaShare: [0.08, 0.15],
    peakAt: null,                // the series IS the arc; nothing is chosen
    intensityBand: [1, 5],
    mets: 4.0,
    prepCount: {},
    allowPeak: false,            // authored, not generated
    props: false,
    authored: true,
  },
};

export const STYLE_KEYS = Object.keys(STYLES);
export const styleById = (id) => STYLES[id] || null;

/** Styles the generator can compose. Ashtanga is excluded by definition. */
export const GENERATED_STYLES = STYLE_KEYS.filter((k) => !STYLES[k].authored);

/**
 * Resolve a style's hold into seconds.
 *   breath-counted styles: breaths x the practitioner's breath rate
 *   time-counted styles:   the seconds directly
 * `t` is 0..1 — where in the style's own range to land (0 = short, 1 = long).
 */
export function holdSecondsFor(style, { breathSeconds = BREATH_SECONDS_DEFAULT, t = 0.5, breaths = null } = {}) {
  if (style.holdSeconds) {
    const [lo, hi] = style.holdSeconds;
    return Math.round((lo + (hi - lo) * t) / 15) * 15;      // yin holds round to 15 s
  }
  const [lo, hi] = style.holdBreaths;
  const n = breaths != null ? breaths : Math.round(lo + (hi - lo) * t);
  return Math.max(1, n) * breathSeconds;
}

/** How many breaths a hold represents, or null for a time-counted style. */
export function holdBreathsFor(style, { t = 0.5, breaths = null } = {}) {
  if (!style.holdBreaths) return null;
  if (breaths != null) return breaths;
  const [lo, hi] = style.holdBreaths;
  return Math.round(lo + (hi - lo) * t);
}

/**
 * Yoga's own intensity scale, kept separate from the lifting side on purpose.
 *
 * The energy-cost review puts full sessions at 3.3 ± 1.6 METs and individual
 * asanas at 2.2, with Surya Namaskar the single outlier at 7.4. A Zone 2 run
 * sits around 8-9 METs. So the top of this scale is still below the bottom of a
 * cardio session, and the app must never offer yoga as a cardio substitute.
 */
export const CARDIO_SUBSTITUTE = false;
export const ZONE2_METS = 8.5;

/**
 * The largest share of a practice any ONE pose may occupy.
 *
 * Without this, a style's hold band ignores the length that was asked for and a
 * short practice in a long-hold style is arithmetically impossible: restorative
 * holds run 5-10 minutes, so a requested 10-minute practice came out at 37 — one
 * pose per phase, each already half the session. Capping at a share means a
 * 10-minute restorative session holds each shape for about two minutes, which is
 * what a 10-minute restorative session IS.
 *
 * Both the generator and the QC pass read it, so the check grades against the
 * band the generator was actually working to rather than the style's nominal one.
 */
export const MAX_ITEM_SHARE = 0.22;
/** Transitions shrink with the session too — 30 s of settling inside 10 minutes is 5% of it per pose. */
export const MAX_TRANSITION_SHARE = 0.04;

/** The hold band a style is working to for a session of `targetSeconds`. */
export function effectiveHoldBand(style, { targetSeconds = 0, breathSeconds = BREATH_SECONDS_DEFAULT } = {}) {
  let lo, hi;
  if (style.holdSeconds) [lo, hi] = style.holdSeconds;
  else if (style.holdBreaths) [lo, hi] = style.holdBreaths.map((b) => b * breathSeconds);
  else return null;
  const cap = targetSeconds ? targetSeconds * MAX_ITEM_SHARE : Infinity;
  return [Math.min(lo, cap), Math.min(hi, cap)];
}
