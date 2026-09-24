// yoga/asana-art.js — one 64x64 line figure per asana, in the same idiom as
// illustrations.js ART: monochrome currentColor paths, figures facing right,
// ground at y≈56 and the mat at y≈50 for floor work.
//
// WHY THE LINE STYLE AND NOT THE SCULPTED FIGURE. The lifting movements use
// figure.js POSES — hand-authored joint coordinates painted with muscle masses —
// because a lift is ABOUT which muscle is working. An asana is about a shape,
// and the shapes here include several the sculpted painter has no vocabulary
// for (bound, inverted, folded in half). The clear diagram is also the style the
// app already uses for stretches and mobility work, which is the family yoga
// actually belongs to.
//
// VARIANTS THAT ARE THE SAME SHAPE SHARE A FIGURE, deliberately. Marichyasana A
// through D differ by grip and by which leg is folded; janu sirsasana A/B/C by
// where the bent foot sits. At 64 pixels those are not drawable distinctions, and
// four figures that all look identical would claim a precision the drawing does
// not have. The name, the Sanskrit and the cue carry the difference.

const H = (x, y, r = 5) => `<circle cx="${x}" cy="${y}" r="${r}" style="fill:currentColor;stroke:none"/>`;
/** Standing ground line. */
const G = `<path d="M8 56 H56" style="opacity:.4"/>`;
/** Mat line for floor work — a little higher, so a lying figure sits on it. */
const M = `<path d="M6 52 H58" style="opacity:.4"/>`;
const WALL = (x) => `<path d="M${x} 6 V52" style="opacity:.45"/>`;
/** Dashed motion arc, for the poses whose point is the rotation. */
const ARC = (d) => `<path d="${d}" stroke-dasharray="2 3" style="opacity:.7"/>`;
const P = (d) => `<path d="${d}"/>`;

export const ASANA_ART = {
  // ---------------------------------------------------------------- centering
  sukhasana: M + H(32, 16) + P("M32 21 V38 M20 46 L32 38 L44 46 M20 46 H44 M26 28 L22 44 M38 28 L42 44"),
  padmasana: M + H(32, 16) + P("M32 21 V38 M22 44 Q32 34 42 44 M22 44 Q32 51 42 44 M26 28 L22 42 M38 28 L42 42"),
  dandasana: M + H(18, 15) + P("M18 20 L20 43 M20 43 L53 46 M19 26 L24 42"),
  virasana: M + H(32, 18) + P("M32 23 V40 M32 40 L20 50 M32 40 L44 50 M26 28 L26 42 M38 28 L38 42 M18 50 H46"),

  // ------------------------------------------------------- standing / uprights
  tadasana: G + H(32, 12) + P("M32 17 V38 M32 38 L28 55 M32 38 L36 55 M32 22 L26 36 M32 22 L38 36"),
  urdhva_hastasana: G + H(32, 16) + P("M32 21 V40 M32 40 L28 55 M32 40 L36 55 M32 24 L27 7 M32 24 L37 7"),
  uttanasana: G + H(27, 44, 4.5) + P("M36 28 L30 41 M33 34 L26 52 M36 28 L34 55 M36 28 L40 55"),
  ardha_uttanasana: G + H(16, 26, 4.5) + P("M38 28 L21 27 M30 27 L28 42 M38 28 L35 55 M38 28 L41 55"),
  utkatasana: G + H(28, 14) + P("M28 19 L28 34 M28 34 L42 38 L38 55 M28 35 L44 42 L44 55 M28 22 L16 9 M28 22 L20 7"),
  utkata_konasana: G + H(32, 12) + P("M32 17 V32 M32 32 L18 42 L16 55 M32 32 L46 42 L48 55 M32 21 L20 24 L18 12 M32 21 L44 24 L46 12"),
  malasana: G + H(32, 16) + P("M32 21 V40 M32 40 L20 34 L24 55 M32 40 L44 34 L40 55 M32 26 L23 34 M32 26 L41 34"),

  virabhadrasana_1: G + H(30, 12) + P("M30 17 V34 M30 34 L42 42 L42 55 M30 34 L18 48 L13 55 M30 20 L26 4 M30 20 L34 4"),
  virabhadrasana_2: G + H(32, 12) + P("M32 17 V34 M32 34 L44 42 L44 55 M32 34 L20 48 L15 55 M32 22 H51 M32 22 H13"),
  viparita_virabhadrasana: G + H(28, 15) + P("M28 20 L32 34 M32 34 L44 42 L44 55 M32 34 L20 48 L15 55 M29 23 L20 6 M31 27 L41 40"),
  high_lunge: G + H(30, 12) + P("M30 17 V34 M30 34 L42 42 L42 55 M30 34 L16 48 L12 55 M30 20 L26 4 M30 20 L34 4"),
  anjaneyasana: G + H(30, 12) + P("M30 17 V34 M30 34 L42 42 L42 55 M30 34 L18 50 L9 54 M30 20 L26 4 M30 20 L34 4"),
  parivrtta_anjaneyasana: G + H(26, 20) + P("M26 25 L32 36 M32 36 L44 43 L44 55 M32 36 L20 50 L11 54 M28 27 L26 45 M29 26 L39 11")
    + ARC("M34 16 q7 2 6 9"),

  utthita_trikonasana: G + H(22, 22) + P("M22 26 L34 34 M34 34 L47 55 M34 34 L20 55 M27 29 L19 46 M27 29 L36 11"),
  parivrtta_trikonasana: G + H(23, 22) + P("M23 26 L34 34 M34 34 L47 55 M34 34 L20 55 M27 30 L23 46 M27 29 L36 11")
    + ARC("M30 18 q8 2 7 9"),
  utthita_parsvakonasana: G + H(23, 26) + P("M23 30 L34 36 M34 36 L46 43 L46 55 M34 36 L22 48 L17 55 M26 31 L34 41 M25 27 L11 13"),
  parivrtta_parsvakonasana: G + H(22, 28) + P("M22 32 L34 38 M34 38 L46 44 L46 55 M34 38 L22 50 L17 55 M25 32 L38 34 M25 35 L31 46")
    + ARC("M28 24 q8 2 7 8"),
  parivrtta_utkatasana: G + H(26, 18) + P("M26 23 L32 36 M32 36 L44 42 L40 55 M28 26 L41 30 M28 28 L21 31")
    + ARC("M32 14 q8 2 7 9"),
  parsvottanasana: G + H(45, 37, 4.5) + P("M30 26 L42 34 M36 30 L46 46 M30 26 L48 55 M30 26 L21 55"),
  prasarita_a: G + H(32, 44, 4.5) + P("M32 24 V40 M32 24 L15 55 M32 24 L49 55 M32 30 L26 50 M32 30 L38 50"),
  prasarita_c: G + H(32, 44, 4.5) + P("M32 24 V40 M32 24 L15 55 M32 24 L49 55 M32 28 L23 13 L28 10"),

  // ------------------------------------------------------------------ balance
  vrksasana: G + H(32, 12) + P("M32 17 V36 M32 36 L34 55 M32 36 L20 44 L31 43 M32 22 L26 12 L30 5 M32 22 L38 12 L34 5"),
  garudasana: G + H(32, 14) + P("M32 19 V36 M32 36 L29 47 L33 55 M32 36 L36 46 L27 51 M32 24 L39 30 L30 34 L35 20"),
  utthita_hasta_padangusthasana: G + H(28, 12) + P("M28 17 V36 M28 36 L30 55 M28 36 L45 30 M28 22 L45 30"),
  virabhadrasana_3: G + H(15, 26, 4.8) + P("M20 27 L36 30 M36 30 L38 55 M36 30 L54 25 M20 27 L6 23 M20 30 L6 28"),
  ardha_chandrasana: G + H(18, 30, 4.8) + P("M22 31 L34 36 M34 36 L36 55 M34 36 L53 30 M24 34 L20 50 M24 32 L31 13"),
  natarajasana: G + H(24, 13) + P("M24 18 L26 34 M26 34 L28 55 M26 34 L42 42 L48 24 M25 20 L12 18 M25 22 L45 26"),

  // ------------------------------------------------------- sun salutation legs
  adho_mukha: M + H(20, 39, 4.5) + P("M36 14 L13 50 M36 14 L52 50 M24 32 L15 50"),
  phalakasana: M + H(47, 32, 4.8) + P("M44 34 L18 46 M18 46 V51 M44 34 L46 46 V51 M30 40 L30 51"),
  chaturanga: M + H(48, 38, 4.5) + P("M44 40 L18 48 M18 48 V51 M44 40 L43 47 L48 51 M30 44 L29 51"),
  ashtanga_namaskara: M + H(48, 47, 4.5) + P("M44 47 L26 50 L16 39 L12 50 M36 49 V51 M44 47 L46 39"),
  urdhva_mukha: M + H(44, 14) + P("M44 19 L40 32 M40 32 L18 46 L9 50 M43 21 L47 49"),
  bhujangasana: M + H(44, 22) + P("M44 27 L40 38 M40 38 L14 50 M43 29 L46 50"),
  salamba_bhujangasana: M + H(44, 26) + P("M44 31 L40 40 M40 40 L13 50 M42 33 L48 43 L39 50"),

  // ---------------------------------------------------------------- backbends
  salabhasana: M + H(48, 30) + P("M44 33 L22 42 L8 33 M44 34 L28 45 M20 46 H40"),
  dhanurasana: M + H(46, 28) + P("M44 32 L24 42 L13 27 M44 33 L16 29 M22 46 H38"),
  ustrasana: G + H(38, 21, 5) + P("M34 25 L26 40 M26 40 L24 55 M20 55 H44 M33 27 L39 50 M26 48 L38 54"),
  setu_bandha: M + H(12, 45, 4.5) + P("M17 46 L32 33 L44 40 L44 51 M17 46 L13 51"),
  urdhva_dhanurasana: M + H(19, 46, 4.5) + P("M13 51 L21 34 Q34 13 46 34 L49 51"),
  matsyasana: M + H(14, 46, 4.5) + P("M18 45 L27 34 L45 44 L53 47 M23 39 L21 51"),
  anahatasana: M + H(14, 46, 4.5) + P("M19 46 L40 34 M40 34 L45 51 M40 34 L38 51 M19 46 L7 49"),
  purvottanasana: M + H(46, 20) + P("M44 25 L26 34 L10 44 M8 44 L12 51 M45 26 L48 51"),

  // ------------------------------------------------------------ forward folds
  paschimottanasana: M + H(38, 32, 4.5) + P("M20 44 L33 34 M20 44 L52 47 M27 38 L50 44"),
  janu_sirsasana: M + H(38, 32, 4.5) + P("M20 44 L33 34 M20 44 L52 47 M20 44 L31 51 L14 49 M27 38 L50 44"),
  upavistha_konasana: M + H(38, 42, 4.5) + P("M16 44 L34 42 M16 44 L52 30 M16 44 L52 54 M20 41 L46 33 M20 47 L46 49"),
  marichyasana: M + H(36, 34, 4.5) + P("M20 44 L32 36 M20 44 L52 47 M20 44 L34 29 L36 46 M26 40 L38 34"),
  kurmasana: M + H(19, 44, 4.5) + P("M24 44 L40 40 M40 40 L54 30 M40 40 L54 50 M25 42 L44 36 M25 47 L44 47"),

  // ------------------------------------------------------------------- twists
  ardha_matsyendrasana: M + H(30, 18) + P("M30 23 V40 M30 40 L46 45 M30 40 L16 46 L27 38 M30 28 L42 34 M30 28 L20 30")
    + ARC("M36 14 q8 2 7 9"),
  bharadvajasana: M + H(30, 16) + P("M30 21 V38 M30 38 L14 46 L26 51 M30 38 L43 45 M30 26 L42 30 M30 26 L19 29")
    + ARC("M36 12 q8 2 7 9"),
  supta_matsyendrasana: M + H(10, 40, 4.5) + P("M15 41 H34 M34 41 L45 34 L53 38 M16 38 L13 29 M16 44 L13 50"),
  thread_needle: M + H(16, 44, 4.5) + P("M21 42 L40 32 M40 32 L45 51 M40 32 L37 51 M22 43 L36 46 M20 40 L13 50"),

  // -------------------------------------------------------------- hip openers
  baddha_konasana: M + H(32, 18) + P("M32 23 V42 M32 42 L16 47 L32 51 L48 47 L32 42 M27 28 L21 46 M37 28 L43 46"),
  sucirandhrasana: M + H(10, 42, 4.5) + P("M15 43 H32 M32 43 L41 30 L45 40 M32 43 L45 36 L38 25"),
  eka_pada_rajakapotasana: M + H(18, 26, 4.8) + P("M23 28 L34 40 M34 40 L54 50 M34 40 L16 46 M14 44 L31 44 M24 30 L20 44"),
  gomukhasana_legs: M + H(32, 18) + P("M32 23 V38 M32 38 L18 46 L30 49 M32 38 L46 44 L34 50 M26 28 L24 40 M38 28 L40 40"),
  agnistambhasana: M + H(30, 16) + P("M30 21 V38 M18 42 H46 M18 49 H46 M18 42 V49 M46 42 V49 M25 27 L22 40 M35 27 L40 40"),
  ananda_balasana: M + H(10, 42, 4.5) + P("M15 43 H32 M32 43 L28 30 L39 27 M32 43 L41 32 L47 29 M18 41 L28 30 M18 45 L41 33"),
  supta_padangusthasana: M + H(10, 44, 4.5) + P("M15 45 H32 M32 45 L34 23 M32 45 L53 48 M18 42 L34 25"),
  supta_virasana: M + H(10, 40, 4.5) + P("M15 41 H34 M34 41 L45 32 L38 47 M34 41 L47 45 M16 38 L12 30"),
  bananasana: M + H(13, 34, 4.5) + P("M18 36 Q34 48 53 40 M18 36 L9 27"),

  // ------------------------------------------------------- core / arm balance
  navasana: M + H(16, 20) + P("M20 24 L34 44 M34 44 L53 21 M20 26 L39 30 M28 48 H40"),
  vasisthasana: M + H(44, 20) + P("M42 24 L16 46 M16 46 L10 51 M42 25 L44 51 M42 22 L47 7"),
  bakasana: M + H(18, 32, 4.8) + P("M23 32 L42 24 M42 24 L53 14 M24 34 L28 51 M40 28 L36 51 M24 37 L35 44"),
  bhujapidasana: M + H(20, 36, 4.8) + P("M25 36 L40 30 M40 30 L54 25 M26 38 L28 51 M38 32 L34 51 M30 32 L47 34"),
  garbha_pindasana: M + H(28, 26, 4.8) + P("M32 29 Q43 34 39 44 Q28 51 22 42 Q20 33 28 30"),
  tolasana: M + H(32, 14) + P("M32 19 V32 M23 35 Q32 42 41 35 M25 29 L23 45 M39 29 L41 45 M20 45 H27 M37 45 H44"),

  // --------------------------------------------------------------- inversions
  salamba_sarvangasana: M + H(14, 50, 4.5) + P("M19 50 L27 44 L28 10 M27 44 L35 11 M22 48 L29 36"),
  halasana: M + H(48, 50, 4.5) + P("M43 50 L40 47 L22 23 M22 23 L12 44 L10 50 M41 47 L29 50"),
  sirsasana: M + H(32, 48, 5) + P("M32 43 V20 M32 20 L28 4 M32 20 L36 4 M25 51 L32 40 L39 51 M23 51 H41"),
  viparita_karani: WALL(52) + P("M6 50 H46") + H(11, 44, 4.5) + P("M16 45 H40 M40 45 L44 18 M40 45 L48 19"),

  // -------------------------------------------------------------- rest / down
  balasana: M + H(13, 46, 4.5) + P("M18 46 L40 37 M40 37 L46 51 M40 37 L34 51 M34 51 H47 M18 46 L6 49"),
  cat_cow: M + H(14, 30, 4.5) + P("M19 31 Q31 24 42 30 M42 30 L45 51 M42 30 L38 51 M19 31 L17 51 M19 31 L24 51")
    + ARC("M28 20 q4 -5 9 -3"),
  savasana: P("M6 50 H58") + H(11, 38, 5) + P("M16 39 L36 41 M36 41 L54 44 M20 41 L17 48 M34 43 L38 48"),
};

export const ASANA_ART_KEYS = new Set(Object.keys(ASANA_ART));
export const hasAsanaArt = (key) => ASANA_ART_KEYS.has(key);
export const asanaArt = (key) => ASANA_ART[key] || null;
