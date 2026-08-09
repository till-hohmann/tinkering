// exercise-photo.js — resolves the photoreal anatomy renders (the Nano Banana
// series described in tools/illustration-prompts.md) for an exercise id.
//
// The app is buildless and served as static files, so it cannot list a directory.
// `tools/build-exercise-images.py` writes img/exercises/manifest.json listing the
// ids that actually shipped; this module fetches that once and answers from it.
// Everything degrades to the SVG figure when a render is missing, so partial
// coverage is fine — generate the library a few exercises at a time.

import { APP_VERSION } from "./version.js";

const DIR = "./img/exercises/";
let manifest = null;      // Set of exercise ids, or null until loaded
let pending = null;

// Fallbacks: warm-up/cool-down ids and substitute lifts borrow the render of the
// movement they mirror. Only consulted when the id has no render of its OWN —
// the prompt pack does ship dedicated prompts for the substitute lifts, and a
// dedicated render must always win over a borrowed one.
const SHARES = {
  // --- day-type figures: what workoutFigure() returns for a cardio or rest day.
  // Without these a cardio day and a rest day were the only tiles left drawing a
  // line-art icon, which made them look like a different app.
  run: "easy_jog_builtin",
  bike: "easy_cardio",
  walk: "easy_walk",
  squat_bw: "bodyweight_squats",
  overhead: "ohp_barbell",
  barbell: "back_squat",
  generic: "bodyweight_squats",

  // --- substitutes and warm-up ids borrowing the movement they mirror ---------
  db_bench_press: "bench_press",
  db_bent_row: "bent_over_row",
  bw_pallof: "cable_pallof",
  glutes: "hip_9090",
  glute_figure4: "hip_9090",
  adductors: "hip_9090",
  hip_flexors: "couch_stretch",
  quads: "couch_stretch",
  hamstrings: "db_rdl",
  calves: "soleus_raise",
  lats: "lat_pulldown",
  backward_walk: "step_down",

  // --- library movements with no render of their own -------------------------
  // Only where the borrowed photo genuinely shows the same shape. A wrong
  // picture is worse than an honest drawing, so anything without a real
  // analogue is left out and keeps its hand-authored figure: leg press, hack
  // squat, leg extension/curl machines, farmer's carry, wrist curl, dips and
  // back extensions. A dip is not a bench press with the bench removed.
  deadlift: "rdl_barbell",
  sumo_deadlift: "rdl_barbell",
  trap_bar_deadlift: "rdl_barbell",
  rack_pull: "rdl_barbell",
  good_morning: "rdl_barbell",
  single_leg_rdl: "db_rdl",
  cable_pull_through: "rdl_barbell",
  front_squat: "back_squat",
  box_squat: "back_squat",
  smith_squat: "back_squat",
  goblet_curtsy_lunge: "db_goblet_squat",
  front_rack_lunge: "db_reverse_lunge",
  incline_barbell_press: "incline_db_press",
  close_grip_bench: "bench_press",
  db_floor_press: "db_bench_press",
  machine_chest_press: "bench_press",
  db_chest_fly: "db_reverse_fly",
  cable_fly: "db_reverse_fly",
  machine_shoulder_press: "seated_db_shoulder_press",
  arnold_press: "seated_db_shoulder_press",
  push_press: "ohp_barbell",
  z_press: "seated_db_shoulder_press",
  landmine_press: "ohp_barbell",
  chin_up: "dead_hang",
  pull_up: "dead_hang",
  inverted_row: "bent_over_row",
  seated_cable_row: "bent_over_row",
  machine_row: "bent_over_row",
  pendlay_row: "bent_over_row",
  t_bar_row: "bent_over_row",
  chest_supported_row: "one_arm_db_row",
  band_pull_apart: "face_pull",
  face_pull_band: "face_pull",
  cable_lateral_raise: "db_lateral_raise",
  preacher_curl: "ez_curl",
  cable_curl: "db_curl",
  incline_db_curl: "db_curl",
  concentration_curl: "db_curl",
  reverse_curl: "ez_curl",
  skullcrusher: "overhead_triceps_ext",
  db_skullcrusher: "overhead_triceps_ext",
  cable_overhead_ext: "overhead_triceps_ext",
  hanging_knee_raise: "dead_hang",
  ab_wheel: "plank",
  russian_twist: "cable_woodchop",
  hollow_hold: "dead_bug",
  push_up: "plank",
  bw_lunge: "db_reverse_lunge",
  core_circuit: "plank",
  seated_calf_raise: "db_calf_raise",
  standing_calf_raise_machine: "standing_calf_raise_db",
  donkey_calf_raise: "db_calf_raise",
  leg_curl: "db_rdl",
  ramp_up_sets: "back_squat",
};

// Load the manifest once. Never throws — a missing manifest just means "no
// renders yet", which is the correct state before the first batch is generated.
export function loadPhotoManifest() {
  if (manifest) return Promise.resolve(manifest);
  if (pending) return pending;
  // ?v= is load-bearing: the filename never changes, so without it the edge
  // serves the previous build's manifest and every render silently vanishes.
  pending = fetch(`${DIR}manifest.json?v=${APP_VERSION}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { manifest = new Set((j && j.ids) || []); return manifest; })
    .catch(() => { manifest = new Set(); return manifest; });
  return pending;
}

// The render URL for an exercise, or null if none shipped. Call after
// loadPhotoManifest() has resolved.
export function photoURL(exerciseId) {
  if (!manifest) return null;
  if (manifest.has(exerciseId)) return `${DIR}${exerciseId}.webp`;
  const alt = SHARES[exerciseId];
  return alt && manifest.has(alt) ? `${DIR}${alt}.webp` : null;
}

export const hasPhoto = (exerciseId) => !!photoURL(exerciseId);

// The DEMO-half thumbnail, for tiles and list rows. The full composite carries a
// muscle panel that is unreadable below ~200px, so anything small gets the
// photograph alone — see tools/build-exercise-images.py convert_thumb().
export function thumbURL(exerciseId) {
  if (!manifest) return null;
  if (manifest.has(exerciseId)) return `${DIR}${exerciseId}.thumb.webp`;
  const alt = SHARES[exerciseId];
  return alt && manifest.has(alt) ? `${DIR}${alt}.thumb.webp` : null;
}
