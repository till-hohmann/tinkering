// illustrations.js — animated, movement-specific exercise figures (on-brand,
// offline, license-free). Line figures that LOOP through the rep so a glance
// shows the exercise. Animation via SVG SMIL (supported on iOS Safari):
//   ROT — rotate a limb group around its joint (curls, raises, presses)
//   TR  — translate a group (squat/lunge dip, calf raise, hip thrust)
//   MD  — morph a path between two poses (legs bending)
// Stretches stay static (they're holds). Monochrome via currentColor; 64x64.

import { POSES, hasPose, renderFigure } from "./figure.js";

import { thumbURL } from "./exercise-photo.js";
// Asanas keep their own art map rather than joining ART below: it is 77 figures
// with their own drawing conventions (mat line, inverted and bound shapes), and
// the yoga side should be removable without unpicking this file.
import { ASANA_ART, hasAsanaArt } from "./yoga/asana-art.js";

const NS = "http://www.w3.org/2000/svg";
const SPL = "0.42 0 0.58 1;0.42 0 0.58 1";

const H = (x, y, r = 5) => `<circle cx="${x}" cy="${y}" r="${r}" style="fill:currentColor;stroke:none"/>`;
const GROUND = `<path d="M10 56 H54" style="opacity:.4"/>`;
const BAR = (x1, x2, y) => `<path d="M${x1} ${y} H${x2} M${x1} ${y - 5} V${y + 5} M${x1 + 3} ${y - 6} V${y + 6} M${x2 - 3} ${y - 6} V${y + 6} M${x2} ${y - 5} V${y + 5}"/>`;
const DB = (x1, x2, y) => `<path d="M${x1} ${y} H${x2} M${x1} ${y - 5} V${y + 5} M${x2} ${y - 5} V${y + 5}"/>`;

const MD = (d1, d2, dur = 1.5) =>
  `<path d="${d1}"><animate attributeName="d" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="${SPL}" values="${d1};${d2};${d1}"/></path>`;
const ROT = (px, py, a1, a2, inner, dur = 1.4) =>
  `<g><animateTransform attributeName="transform" attributeType="XML" type="rotate" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="${SPL}" values="${a1} ${px} ${py};${a2} ${px} ${py};${a1} ${px} ${py}"/>${inner}</g>`;
const TR = (dx, dy, inner, dur = 1.5) =>
  `<g><animateTransform attributeName="transform" type="translate" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="${SPL}" values="0 0;${dx} ${dy};0 0"/>${inner}</g>`;

// squat-style legs: straight <-> bent (matching path structure for morph)
const LEGS_UP = "M32 34 L26 45 L26 54 M32 34 L38 45 L38 54";
const LEGS_DN = "M32 41 L22 48 L26 54 M32 41 L42 48 L38 54";

const ART = {
  // ---------- cardio ----------
  run: H(40, 12) + `<path d="M40 17 L34 33"/>` +
    ROT(34, 33, 20, -24, `<path d="M34 33 L43 41 L40 51"/>`, 0.7) +
    ROT(34, 33, -24, 20, `<path d="M34 33 L26 41 L29 51"/>`, 0.7) +
    ROT(36, 21, -28, 22, `<path d="M36 21 L45 18"/>`, 0.7) +
    ROT(36, 21, 22, -28, `<path d="M36 21 L29 27"/>`, 0.7),
  bike: `<circle cx="17" cy="47" r="9"/><circle cx="47" cy="47" r="9"/>` + H(38, 13, 4) +
    `<path d="M17 47 L31 30 H41 L35 21 M31 30 H25 M41 21 H47 L43 27 M40 17 L41 30"/>` +
    ROT(31, 30, 0, 360, `<path d="M31 30 L34 47"/>`, 1.1),
  walk: H(34, 12) + `<path d="M34 17 V33 M34 22 L42 28 M34 22 L27 29"/>` +
    ROT(34, 33, 18, -18, `<path d="M34 33 L40 46 L39 53"/>`, 0.9) +
    ROT(34, 33, -18, 18, `<path d="M34 33 L28 47 L26 53"/>`, 0.9),

  // ---------- squat / hinge / lunge ----------
  squat_bar: GROUND + MD(LEGS_UP, LEGS_DN, 1.7) +
    TR(0, 7, H(32, 12) + BAR(16, 48, 20) + `<path d="M32 21 V34 M32 21 L24 20 M32 21 L40 20"/>`, 1.7),
  squat_bw: GROUND + MD(LEGS_UP, LEGS_DN, 1.6) +
    TR(0, 7, H(32, 12) + `<path d="M32 17 V34 M32 22 L22 26 M32 22 L42 26"/>`, 1.6),
  goblet: GROUND + MD(LEGS_UP, LEGS_DN, 1.6) +
    TR(0, 7, H(32, 12) + `<path d="M32 17 V34"/>` + `<rect x="27" y="21" width="10" height="9" rx="1.5" style="fill:currentColor;stroke:none"/>`, 1.6),
  hinge_bar: GROUND +
    ROT(34, 30, -18, 30, H(22, 14) + `<path d="M34 30 L23 16"/>`, 1.6) +  // torso + head hinge at hip
    `<path d="M34 30 L40 44 V54 M34 30 L28 44 V54"/>` + DB(20, 28, 30),
  lunge: `<path d="M14 54 H50" style="opacity:.4"/>` +
    MD("M36 30 L48 38 V50 M36 30 L26 43 L26 50", "M36 36 L48 44 V54 M36 36 L24 47 L24 54", 1.7) +
    TR(0, 6, H(36, 11) + `<path d="M36 16 V30 M30 22 L30 31 M42 22 L42 31"/>`, 1.7),
  split_squat: `<path d="M14 54 H40 M40 54 L50 40" style="opacity:.4"/>` +
    MD("M28 30 L22 42 V53 M28 30 L40 40 L48 38", "M28 36 L21 46 V53 M28 36 L42 44 L48 40", 1.7) +
    TR(0, 6, H(28, 11) + `<path d="M28 16 V30 M24 22 L24 30 M32 22 L32 30"/>`, 1.7),
  calf: GROUND + `<path d="M22 53 H26 M38 53 H42" style="opacity:.4"/>` +
    TR(0, -5, H(32, 11) + `<path d="M32 16 V35 M32 35 L27 48 L24 53 M32 35 L37 48 L40 53 M32 21 L24 26 M32 21 L40 26"/>`, 1.1),
  hipthrust: `<path d="M10 50 H26 M10 46 V54" style="opacity:.55"/>` + H(48, 28) +
    TR(0, 6, `<path d="M44 31 L34 33"/>`, 1.3) +
    MD("M22 47 L34 33 L46 31 M22 47 V42", "M22 51 L33 39 L46 35 M22 51 V46", 1.3),

  // ---------- bench / incline / press ----------
  bench: `<path d="M12 40 H48 M16 40 V50 M44 40 V50" style="opacity:.55"/>` + H(18, 34) +
    `<path d="M22 34 H40 L46 40"/>` +
    MD("M26 22 H46 M30 34 V22 M40 34 V22", "M26 30 H46 M30 34 V30 M40 34 V30", 1.4),
  incline: `<path d="M14 52 L46 28 M14 52 H22 M40 28 H48" style="opacity:.55"/>` + H(24, 38) +
    `<path d="M27 36 L36 30"/>` +
    MD("M30 18 H44 M34 30 L36 19 M38 19 L40 22", "M30 26 H42 M34 30 L35 26 M37 26 L39 28", 1.4),
  overhead: GROUND + H(32, 27) + `<path d="M32 31 V44 M32 44 L26 54 M32 44 L38 54"/>` +
    MD("M18 13 H46 M28 31 L26 13 M36 31 L38 13", "M18 22 H46 M28 31 L27 22 M36 31 L37 22", 1.5),
  overhead_ext: H(32, 13) + `<path d="M32 18 V40 M32 40 L27 53 M32 40 L37 53 M32 23 L26 27 M32 23 L38 27"/>` +
    ROT(26, 27, 0, -75, `<path d="M26 27 L23 17"/><rect x="20" y="12" width="8" height="5" rx="1.5" style="fill:currentColor;stroke:none"/>`, 1.4) +
    ROT(38, 27, 0, 75, `<path d="M38 27 L41 17"/><rect x="36" y="12" width="8" height="5" rx="1.5" style="fill:currentColor;stroke:none"/>`, 1.4),
  pushdown: `<path d="M50 10 L40 22 M48 8 H52" style="opacity:.55"/>` + H(30, 20) +
    `<path d="M30 24 V42 M30 42 L25 53 M30 42 L36 53 M32 24 L40 28"/>` +
    ROT(40, 28, -55, 0, `<path d="M40 28 L41 38"/>` + DB(37, 45, 38), 1.3),

  // ---------- rows / pulldown ----------
  row_bent: H(20, 16) + `<path d="M20 20 L34 28 M34 28 L46 28 M34 28 L46 40 V52 M34 28 L30 42 V52"/>` +
    ROT(40, 30, -28, 10, `<path d="M40 30 L46 22"/>` + DB(42, 50, 22), 1.3),
  row_onearm: `<path d="M12 44 H32 M12 40 V50" style="opacity:.55"/>` + H(44, 22) +
    `<path d="M44 26 L31 34 M31 34 L35 52 M31 34 L23 44"/>` +
    ROT(44, 28, 30, -8, `<path d="M44 28 L47 40"/>` + DB(43, 51, 40), 1.3),
  pulldown: `<path d="M18 10 H46 M22 8 V14 M42 8 V14" style="opacity:.55"/>` + H(32, 30) +
    `<path d="M32 34 V47 M32 47 L27 54 M32 47 L37 54"/>` +
    MD("M22 14 H42 M30 27 L22 14 M34 27 L42 14", "M24 24 H40 M30 27 L24 24 M34 27 L40 24", 1.4),
  facepull: `<path d="M52 12 L40 22 M50 10 H54" style="opacity:.55"/>` + H(26, 30) +
    `<path d="M26 34 V47 M26 47 L21 54 M26 47 L31 54"/>` +
    MD("M28 27 L40 22 M28 31 L40 24", "M28 25 L36 23 M28 31 L36 27", 1.3),

  // ---------- shoulders / arms ----------
  lateral: H(32, 13) + `<path d="M32 18 V40 M32 40 L27 53 M32 40 L37 53"/>` +
    MD("M32 23 L22 34 M19 32 H25 M32 23 L42 34 M39 32 H45", "M32 23 H17 M14 20 V26 M32 23 H47 M50 20 V26", 1.5),
  rearfly: H(32, 16) + `<path d="M32 20 L34 33 M34 33 L40 51 M34 33 L28 51"/>` +
    MD("M32 24 L24 30 M21 28 V34 M32 24 L40 30 M43 28 V34", "M32 24 H18 M15 21 V27 M32 24 H46 M49 21 V27", 1.5),
  curl: H(32, 12) + `<path d="M32 17 V40 M32 40 L27 53 M32 40 L37 53 M32 23 L24 33 M32 23 L40 33"/>` +
    ROT(24, 33, 0, -118, `<path d="M24 33 L27 42"/><path d="M22 42 H30 M22 40 V44 M30 40 V44"/>`, 1.3) +
    ROT(40, 33, 0, 118, `<path d="M40 33 L37 42"/><path d="M34 42 H42 M34 40 V44 M42 40 V44"/>`, 1.3),
  pallof: `<path d="M12 16 L26 28 M10 14 H14" style="opacity:.55"/>` + H(38, 16) +
    `<path d="M38 20 V40 M38 40 L33 53 M38 40 L43 53"/>` +
    TR(-8, 0, `<path d="M38 26 L28 28"/>`, 1.4),

  // ---------- core (static holds) ----------
  plank: `<path d="M10 52 H54" style="opacity:.4"/>` + H(46, 30) +
    `<path d="M44 33 L18 46 M18 46 V53 M30 41 L30 53 M44 33 L46 46 V53"/>`,

  // ---------- stretches & mobility (clear static diagrams) ----------
  // standing hamstring stretch: hinge over a straight, heel-down front leg
  hamstring: GROUND + H(44, 15) + `<path d="M44 19 L34 31 M34 31 L18 43 L22 41 M34 31 L41 52 M39 24 L22 39"/>`,
  // standing quad stretch: pull one foot up to the glute
  quad: GROUND + H(31, 12) + `<path d="M31 16 V35 M31 35 L29 52 M31 35 L40 43 L33 36 M31 23 L24 27 M31 23 L34 36"/>`,
  // half-kneeling hip-flexor lunge
  hip: GROUND + H(41, 13) + `<path d="M41 17 L39 33 M39 33 L27 40 L27 52 M39 33 L47 45 L54 51 M40 21 L33 27"/>`,
  // doorway chest stretch: forearm on the frame, lean through
  chest: `<path d="M49 9 V46" style="opacity:.5"/>` + H(29, 15) + `<path d="M29 19 V39 M29 39 L25 52 M29 39 L33 52 M29 23 L47 21 M29 23 L20 30"/>`,
  // overhead lat side-reach
  lat: H(27, 13) + `<path d="M27 17 L34 39 M34 39 L30 52 M34 39 L40 52 M27 19 L46 12 M29 24 L40 18"/>`,
  // seated spinal (t-spine) rotation
  twist: H(32, 13) + `<path d="M32 17 V35 M32 35 L46 38 M32 35 L41 46 M32 23 L43 29 M32 23 L23 28"/>` +
    `<path d="M40 19 q8 3 6 10" stroke-dasharray="2 3"/>`,
  // figure-4 glute stretch (seated, ankle over knee)
  glute: H(21, 16) + `<path d="M21 20 L30 36 M30 36 L43 31 L33 39 M30 36 L47 43 M23 26 L34 32"/>`,
  // wall calf stretch: front knee bent, back leg straight, hands on wall
  calf_stretch: `<path d="M11 9 V54" style="opacity:.5"/>` + GROUND + H(30, 15) +
    `<path d="M30 19 L28 33 M28 33 L24 43 L22 52 M28 33 L43 46 L49 52 M30 21 L15 25 M30 25 L17 31"/>`,
  // standing leg swing (one-hand support, motion arc)
  legswing: GROUND + H(32, 12) + `<path d="M32 16 V35 M32 35 L30 52 M32 35 L45 41 M32 22 L24 28 M32 22 L39 27"/>` +
    `<path d="M43 45 q6 4 4 9" stroke-dasharray="2 3"/>`,
  // arm circles (arms out, rotation arcs)
  arms: H(32, 14) + `<path d="M32 18 V40 M32 40 L28 52 M32 40 L36 52 M32 23 L17 22 M32 23 L47 22"/>` +
    `<path d="M13 18 a5 5 0 1 0 4 -2" stroke-dasharray="2 3"/><path d="M51 18 a5 5 0 1 1 -4 -2" stroke-dasharray="2 3"/>`,
  // ankle circles (lifted foot, rotation arc)
  ankle: H(32, 12) + `<path d="M32 16 V34 M32 34 L29 50 M32 34 L41 44 L45 47 M32 22 L25 27 M32 22 L39 27"/>` +
    `<path d="M44 44 a5 5 0 1 1 3 5" stroke-dasharray="2 3"/>`,
  // standing hip circles (hands on hips, motion ellipse at the pelvis)
  hipcircle: GROUND + H(32, 11) +
    `<path d="M32 15 V37 M32 37 L28 52 M32 37 L36 52 M32 21 L23 28 L30 37 M32 21 L41 28 L34 37"/>` +
    `<ellipse cx="32" cy="39" rx="10" ry="4.5" stroke-dasharray="2 3"/>`,
  // scapular wall slides (back to wall, goal-post arms sliding up)
  wallslide: `<path d="M9 8 V56" style="opacity:.45"/>` + H(30, 12) +
    `<path d="M30 16 V38 M30 38 L26 52 M30 38 L34 52 M30 23 L21 23 L19 13 M30 23 L39 23 L41 13"/>` +
    `<path d="M18 9 L19 5 L20 9 M40 9 L41 5 L42 9" stroke-dasharray="2 2"/>`,
  // world's greatest stretch (deep lunge, one hand down, other reaching up + rotate)
  worldsgreat: `<path d="M8 54 H58" style="opacity:.4"/>` + H(24, 20) +
    `<path d="M24 24 L32 34 M32 34 L44 41 V53 M32 34 L21 45 L16 53 M25 27 L18 45 M26 27 L37 15"/>` +
    `<path d="M34 18 q6 0 5 6" stroke-dasharray="2 3"/>`,

  barbell: BAR(10, 54, 32),
  dumbbell: `<path d="M14 32 H50 M14 23 V41 M20 26 V38 M44 26 V38 M50 23 V41"/>`,
  generic: `<circle cx="32" cy="32" r="7"/>`,
};

const MAP = {
  zone2: "run", intervals: "run", cardio: "run", easy_jog_builtin: "run", easy_cardio: "bike", easy_walk: "walk",
  bike_hard: "bike", bike_easy: "bike", zone2_strides: "run",
  back_squat: "squat_bar", bodyweight_squats: "squat_bw", db_goblet_squat: "goblet",
  rdl_barbell: "hinge_bar", db_rdl: "hinge_bar",
  db_walking_lunge: "lunge", db_reverse_lunge: "lunge", bw_lunge: "lunge", bulgarian_split_squat_db: "split_squat",
  standing_calf_raise_db: "calf", db_calf_raise: "calf", calves: "calf_stretch",
  db_hip_thrust: "hipthrust",
  bench_press: "bench", incline_db_press: "incline",
  bent_over_row: "row_bent", one_arm_db_row: "row_onearm", lat_pulldown: "pulldown",
  ohp_barbell: "overhead", seated_db_shoulder_press: "overhead", overhead_triceps_ext: "overhead_ext",
  db_lateral_raise: "lateral", db_reverse_fly: "rearfly", face_pull: "facepull",
  ez_curl: "curl", db_hammer_curl: "curl", triceps_pushdown: "pushdown",
  cable_pallof: "pallof", core_circuit: "plank", ramp_up_sets: "rampup",
  // substitute-only lifts → reuse the closest movement figure
  db_bench_press: "bench", db_bent_row: "row_bent", db_pullover: "pullover",
  db_curl: "curl", bw_pallof: "pallof",
  leg_swings: "legswing", hip_circles: "hipcircle", hip_flexors: "hip", worlds_greatest: "worldsgreat",
  scapular_wall_slides: "wallslide", arm_circles: "arms", ankle_rolls: "ankle",
  hamstrings: "hamstring", quads: "quad", chest_doorway: "chest", lats: "lat",
  tspine_rotation: "twist", glute_figure4: "glute", glutes: "glute",
  // supplemental mobility & stability program → dedicated poster poses
  couch_stretch: "couchstretch", hip_9090: "ninety", adductor_rockback: "rockback",
  ankle_rock: "anklerock", tib_raise: "tibraise", soleus_raise: "soleus",
  glute_bridge: "bridge", sl_hip_abduction: "sideleg", copenhagen: "copenhagen",
  wall_sit: "wallsit", step_down: "stepdown", backward_walk: "walk",
  dead_bug: "deadbug", side_plank: "sideplank", bird_dog: "birddog",
  adductors: "ninety",   // cool-down butterfly → seated hips-open figure
  // Block 2+ rotation + dead hangs
  dead_hang: "deadhang", barbell_hip_thrust: "hipthrust", db_step_up: "stepup",
  // --- library expansion -----------------------------------------------------
  // New dedicated poses.
  deadlift: "deadlift", front_squat: "frontsquat", dip: "dip",
  leg_press: "legpress", leg_extension: "legext", leg_curl: "legcurl",
  seated_cable_row: "seatedrow", db_shrug: "shrug", barbell_shrug: "shrug",
  farmers_carry: "carry", db_chest_fly: "chestfly", cable_fly: "chestfly",
  preacher_curl: "preacher", skullcrusher: "skullcrusher",
  hanging_knee_raise: "hangraise", ab_wheel: "abwheel",
  back_extension: "backext", seated_calf_raise: "seatedcalf",
  machine_chest_press: "machinepress",
  // Reused where the movement genuinely shares a silhouette. Anything that would
  // have been a MISLEADING reuse got its own pose above instead — the v136 audit
  // is the precedent for taking that seriously.
  chin_up: "pull_up",                       // same hang, grip differs
  incline_barbell_press: "incline",
  close_grip_bench: "bench",
  db_floor_press: "bench",
  pendlay_row: "row_bent", t_bar_row: "row_bent", chest_supported_row: "row_bent",
  machine_row: "seatedrow",
  cable_lateral_raise: "lateral",
  cable_curl: "curl", incline_db_curl: "curl", concentration_curl: "curl",
  cable_overhead_ext: "overhead_ext", db_skullcrusher: "skullcrusher",
  machine_shoulder_press: "overhead", arnold_press: "overhead", push_press: "overhead",
  goblet_curtsy_lunge: "lunge", front_rack_lunge: "lunge",
  hack_squat: "legpress", smith_squat: "squat_bar", box_squat: "squat_bar",
  sumo_deadlift: "deadlift", trap_bar_deadlift: "deadlift", rack_pull: "deadlift",
  good_morning: "hinge_bar", cable_pull_through: "hinge_bar",
  single_leg_rdl: "hinge_bar",
  standing_calf_raise_machine: "calf", donkey_calf_raise: "calf",
  cable_woodchop: "twist", russian_twist: "twist",
  plank: "plank", hollow_hold: "deadbug",
  reverse_curl: "curl", wrist_curl: "curl",
  face_pull_band: "facepull", band_pull_apart: "rearfly",
  landmine_press: "overhead", z_press: "overhead",
};

// direct pose keys (e.g. workoutFigure's "squat_bw"/"overhead") resolve to
// themselves so every workout tile renders the full poster figure
// Asanas are checked FIRST so a Sanskrit key can never be shadowed by a lifting
// pose or an alias that happens to collide.
export const illustrationKey = (id) =>
  (hasAsanaArt(id) ? id : hasPose(id) ? id : ART[id] ? id : MAP[id] || null);
export const hasIllustration = (id) => !!illustrationKey(id);

// --- v2 illustration tiles: a still, glowing gradient figure on a deep tinted
// tile (hybrid of the "neon glow" + "duotone scene" directions). Each movement
// takes its MUSCLE GROUP's colour theme — a coordinated hue + glow + dark base —
// so every exercise renders in one consistent, premium style. All SVG, offline.
const THEMES = {
  legs:      { c1: "#6effd2", c2: "#15b88a", glow: "#2fe6a6", bg: "#143029" }, // mint
  posterior: { c1: "#a7f59a", c2: "#3fbf57", glow: "#5ad36f", bg: "#163019" }, // lime (hamstring/glute)
  chest:     { c1: "#ffa3ae", c2: "#f43f5e", glow: "#fb7185", bg: "#341622" }, // coral
  back:      { c1: "#8ec9ff", c2: "#3b82f6", glow: "#5fa8ff", bg: "#10233c" }, // blue
  shoulders: { c1: "#ffd98a", c2: "#f59e0b", glow: "#fbbf24", bg: "#33260f" }, // amber
  arms:      { c1: "#cbb6ff", c2: "#8b5cf6", glow: "#a78bfa", bg: "#221a38" }, // violet
  core:      { c1: "#8af0e4", c2: "#14b8a6", glow: "#2dd4bf", bg: "#0f2f2c" }, // teal
  cardio:    { c1: "#9bdcff", c2: "#38bdf8", glow: "#56c5fb", bg: "#0e2839" }, // sky
  mobility:  { c1: "#cbb6ff", c2: "#a78bfa", glow: "#b89dff", bg: "#1d1838" }, // violet
};
// illustration KEY -> theme. (Note ART key "chest"/"lat" are the doorway/lat
// STRETCHES → mobility; the chest MUSCLE uses keys "bench"/"incline".)
const KEY_THEME = {
  run: "cardio", bike: "cardio", walk: "cardio",
  squat_bar: "legs", squat_bw: "legs", goblet: "legs", lunge: "legs", split_squat: "legs", calf: "legs",
  hinge_bar: "posterior", hipthrust: "posterior",
  bench: "chest", incline: "chest",
  overhead: "shoulders", lateral: "shoulders", rearfly: "shoulders", facepull: "shoulders",
  overhead_ext: "arms", pushdown: "arms", curl: "arms",
  row_bent: "back", row_onearm: "back", pulldown: "back",
  pallof: "core", plank: "core",
  hamstring: "mobility", quad: "mobility", hip: "mobility", chest: "mobility", lat: "mobility",
  twist: "mobility", glute: "mobility", legswing: "mobility", arms: "mobility", ankle: "mobility", calf_stretch: "mobility",
  hipcircle: "mobility", wallslide: "mobility", worldsgreat: "mobility",
  // mobility & stability program figures
  couchstretch: "mobility", ninety: "mobility", rockback: "mobility", anklerock: "mobility",
  tibraise: "legs", soleus: "legs", bridge: "posterior", sideleg: "posterior",
  deadhang: "back", pullover: "back", stepup: "legs",
  copenhagen: "core", wallsit: "legs", stepdown: "legs",
  deadbug: "core", sideplank: "core", birddog: "core",
  barbell: "legs", dumbbell: "shoulders", generic: "core",
};
let gidc = 0;   // unique gradient/filter ids so multiple tiles on one screen don't collide
const themeFor = (id) => THEMES[KEY_THEME[illustrationKey(id)] || "legs"] || THEMES.legs;

// Render the movement figure as plain currentColor line art (no white card),
// for use inside tinted tiles. Animation is stripped by default so it reads as
// a clear, static symbol (and so screenshots/Plan lists stay calm).
export function lineGlyph(id, { animated = false, strokeWidth = 3.4 } = {}) {
  const key = illustrationKey(id) || "barbell";
  let art = ASANA_ART[key] || ART[key] || ART.generic;
  if (!animated) {
    art = art.replace(/<animateTransform[^>]*\/>/g, "").replace(/<animate[^>]*\/>/g, "");
  }
  const u = "g" + (gidc++);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("class", "illo");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(strokeWidth));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  // soft glow in the tile's own colour (currentColor), so hero/intro figures pop
  svg.innerHTML = `<defs><filter id="${u}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="0.7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g filter="url(#${u})">${art}</g>`;
  return svg;
}

// Pick a representative movement figure for a planned day (literal, not abstract).
// Strength days use the day's primary lift, so each shows its real movement.
export function workoutFigure(template, day) {
  const type = day ? day.type : "rest";
  if (type === "rest") return "walk";
  if (type === "cardio") {
    const ct = (template && template.cardioType) || "";
    if (/bike|cycle|spin|ride/i.test(ct)) return "bike";
    return "run";
  }
  const primary = day && day.exercises && (day.exercises.find((e) => e.role === "compound") || day.exercises[0]);
  if (primary) return primary.exerciseId;
  const label = ((template && template.label) || "").toLowerCase();
  if (/lower|leg|squat|glute|hamstring|quad|calf/.test(label)) return "squat_bw";
  if (/upper|push|pull|chest|back|shoulder|arm|press|bench|curl/.test(label)) return "overhead";
  return "barbell";
}

export function illustration(id, cls = "illo") {
  // A REAL PHOTOGRAPH BEATS A DRAWING OF ONE, wherever it is legible.
  //
  // The renders were originally wired only into the exercise anatomy card, which
  // turns out to be reachable from exactly one place — tapping a row inside a day
  // preview — so in practice they were invisible. Everything else in the app draws
  // its exercise tiles through THIS function, so this is the one edit that lights
  // them up everywhere at once: day rows, the jump list, the session head, the
  // summary, records, the exercise picker.
  //
  // The thumbnail is the DEMO HALF only, cropped square. The full composite is
  // right at 340px on the card and mush at 40px in a list.
  //
  // Synchronous by necessity — every caller renders inline — so the manifest is
  // loaded once at boot. Before it resolves, or for a movement with no render,
  // this falls through to the hand-authored figure, which is also what keeps the
  // 40 exercises that have no photo looking deliberate rather than broken.
  const photo = thumbURL(id);
  if (photo) {
    const img = document.createElement("img");
    img.className = "exfig exphoto " + cls;
    img.src = photo;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    // a 404 (manifest out of step with disk) must not leave a hole in a list
    img.onerror = () => { const fb = illustrationSVG(id, cls); if (img.parentNode) img.parentNode.replaceChild(fb, img); };
    return img;
  }
  return illustrationSVG(id, cls);
}

function illustrationSVG(id, cls = "illo") {
  const key = illustrationKey(id) || "generic";
  const t = themeFor(id);
  const u = "x" + (gidc++);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "exfig " + cls);

  // anatomical pose (the v3 "poster" style) for strength + cardio movements —
  // sculpted figure with the worked muscles lit. Mobility/stretches keep the
  // clear line-diagram tile below (they're holds, not muscle work).
  if (hasPose(key)) {
    svg.setAttribute("viewBox", "0 0 200 200");
    svg.innerHTML =
      `<defs>` +
      // one shared tile background across ALL illustrations: the Today orb's own
      // plasma palette (mint → sky → violet, conic on the orb, radial here) with
      // its white top-left highlight — the dark sculpted figure reads instantly
      `<radialGradient id="bg${u}" cx="30%" cy="22%" r="110%"><stop offset="0" stop-color="#2fe6a6"/><stop offset=".45" stop-color="#38bdf8"/><stop offset=".78" stop-color="#7c93e8"/><stop offset="1" stop-color="#a78bfa"/></radialGradient>` +
      `<radialGradient id="hi${u}" cx="38%" cy="26%" r="52%"><stop offset="0" stop-color="#ffffff" stop-opacity=".34"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>` +
      `</defs>` +
      `<rect width="200" height="200" rx="44" fill="url(#bg${u})"/>` +
      `<rect width="200" height="200" rx="44" fill="url(#hi${u})"/>` +
      renderFigure(POSES[key]);
    return svg;
  }

  const art = (ASANA_ART[key] || ART[key] || ART.generic)
    .replace(/<animateTransform[^>]*\/>/g, "").replace(/<animate[^>]*\/>/g, "");   // STILL frame, no loop
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.innerHTML =
    `<defs>` +
    `<radialGradient id="bg${u}" cx="30%" cy="22%" r="110%"><stop offset="0" stop-color="#2fe6a6"/><stop offset=".45" stop-color="#38bdf8"/><stop offset=".78" stop-color="#7c93e8"/><stop offset="1" stop-color="#a78bfa"/></radialGradient>` +
    `</defs>` +
    `<rect width="64" height="64" rx="14" fill="url(#bg${u})"/>` +
    `<ellipse cx="32" cy="54.5" rx="18" ry="2.4" fill="#0c2030" opacity=".18"/>` +
    // dark line art on the bright plasma tile (bright-on-bright was unreadable)
    `<g fill="none" stroke="#12283a" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" color="#12283a">${art}</g>`;
  return svg;
}

export const ALL_KEYS = Object.keys(ART);
