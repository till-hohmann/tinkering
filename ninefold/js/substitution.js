// substitution.js — cross-location exercise substitution + effort-based
// back-calculation (pure logic + curated data; no DOM, no storage).
//
// When you train in the OTHER location, lifts whose equipment isn't there get
// swapped for a 1:1 movement match that IS available, prescribed at the same
// targeted intensity. You log the substitute; the app then back-calculates an
// EQUIVALENT performance on the originally-planned lift and writes THAT into the
// planned lift's history — so progressive overload carries on when you're back
// in the right place. The conversion is effort-based (reps + RIR, via est-1RM,
// RELATIVE to the prescribed target) so the substitute's absolute weight largely
// cancels; you review/adjust the result before it's saved.
//
// The app is offline, so the substitution map is curated here at build time
// (by movement pattern), not generated on-device. Only the implements a place
// LACKS need swaps — barbell / EZ / cable are the usual gaps at a home or hotel
// setup; dumbbell & bodyweight lifts work anywhere (the engine just rounds to
// whatever is actually on the rack there).

import { e1rm, roundLoad } from "./progression.js";
import { byId as libraryById } from "./exercise-library.js";

// Substitute-only exercises (not in any day template — referenced only as swaps).
// metaFor() falls back here when an id isn't in the program's own library.
export const SUB_EXERCISES = {
  db_bench_press: { name: "DB Bench Press", cue: "Flat or low-incline, press from the chest", implement: "dumbbell_pair" },
  db_bent_row:    { name: "Bent-over DB Row", cue: "Hinge, row both DBs to the lower ribs", implement: "dumbbell_pair" },
  db_pullover:    { name: "DB Pullover", cue: "Stretch the lats overhead, pull the DB over", implement: "dumbbell_single" },
  db_curl:        { name: "DB Biceps Curl", cue: "Supinated, control the negative", implement: "dumbbell_pair" },
  bw_pallof:      { name: "Anti-rotation hold (side plank / dead-bug)", cue: "Brace hard, resist rotation", implement: "bodyweight" },
};

// Candidate substitutes per planned lift, best first. Used only when the planned
// implement is unavailable at the place you're actually training.
export const SUB_CANDIDATES = {
  back_squat:       ["db_goblet_squat", "bulgarian_split_squat_db", "db_reverse_lunge"],
  rdl_barbell:      ["db_rdl", "db_hip_thrust"],
  bench_press:      ["db_bench_press", "incline_db_press"],
  bent_over_row:    ["db_bent_row", "one_arm_db_row"],
  ohp_barbell:      ["seated_db_shoulder_press"],
  lat_pulldown:     ["db_pullover", "one_arm_db_row"],
  face_pull:        ["db_reverse_fly"],
  ez_curl:          ["db_curl", "db_hammer_curl"],
  triceps_pushdown: ["overhead_triceps_ext"],
  cable_pallof:     ["bw_pallof", "core_circuit"],
  barbell_hip_thrust: ["db_hip_thrust", "db_rdl"],
};

// Lifts with no exact equivalent in the other location (no cable / vertical pull).
// Their back-calc is flagged approximate so the review screen draws attention.
export const APPROX = new Set(["lat_pulldown", "face_pull", "cable_pallof"]);

// Seed ratio = suggested substitute load ÷ planned load (per-hand for DB pairs,
// stack value for the original). Only seeds the FIRST suggestion — logged RIR and
// the review step correct any imprecision. Keyed "<original>><sub>".
const SEED_RATIO = {
  "back_squat>db_goblet_squat": 0.5, "back_squat>bulgarian_split_squat_db": 0.3, "back_squat>db_reverse_lunge": 0.32,
  "rdl_barbell>db_rdl": 0.45, "rdl_barbell>db_hip_thrust": 0.6,
  "bench_press>db_bench_press": 0.4, "bench_press>incline_db_press": 0.38,
  "bent_over_row>db_bent_row": 0.45, "bent_over_row>one_arm_db_row": 0.45,
  "ohp_barbell>seated_db_shoulder_press": 0.45,
  "lat_pulldown>db_pullover": 0.45, "lat_pulldown>one_arm_db_row": 0.5,
  "face_pull>db_reverse_fly": 0.6,
  "ez_curl>db_curl": 0.5, "ez_curl>db_hammer_curl": 0.5,
  "triceps_pushdown>overhead_triceps_ext": 0.6,
  "barbell_hip_thrust>db_hip_thrust": 0.35, "barbell_hip_thrust>db_rdl": 0.35,
};

// Implement available in a location? (bodyweight always; rest from equipmentProfile.locations)
export function implementAvailable(implement, location, equip) {
  if (implement === "bodyweight") return true;
  const avail = (equip && equip.locations && equip.locations[location]) || [];
  return avail.includes(implement);
}
export function needsSub(implement, location, equip) {
  return !implementAvailable(implement, location, equip);
}

export const candidatesFor = (originalId) => SUB_CANDIDATES[originalId] || [];
export const primarySubstitute = (originalId) => (SUB_CANDIDATES[originalId] || [])[0] || null;
export const isApprox = (originalId) => APPROX.has(originalId);

// Resolve display meta for any id: the program's own map first (it may carry a
// renamed or customised entry), then the substitute-only lifts, then the shared
// exercise library.
//
// THE LIBRARY STEP IS NOT COSMETIC. Most SUB_CANDIDATES ids live in the library
// and NOT in any given program's exercise map — a plan that never programmed a
// goblet squat has no entry for one. Without this lookup they fell through to
// the last resort, which rendered the raw id ("db_goblet_squat") in the swap
// picker AND claimed every one of them was a `dumbbell_pair`. That second half
// is the real damage: the implement drives seedSubLoad's ratio and the rounding,
// so a one-dumbbell goblet squat was seeded and rounded as a pair, and a
// bodyweight core circuit was handed a load instead of zero.
//
// Anyone who trains away from their planned place regularly sees this on almost
// every session, which is precisely who the substitution engine is for.
export function metaFor(program, id) {
  return (program.exercises && program.exercises[id])
    || SUB_EXERCISES[id]
    || libraryById(id)
    || { name: id, cue: "", implement: "dumbbell_pair" };
}

// EQUAL ALTERNATIVES for a lift you can't do today — the "the rack is taken,
// give me something that trains the same thing" question, as opposed to the
// "this gym has no barbell at all" question the rest of this module answers.
//
// Two sources, in this order, because they fail in opposite directions:
//   1. SUB_CANDIDATES — hand-picked 1:1 matches with a SEED_RATIO, so the load
//      carries across correctly. Best answers, but only ~11 lifts have one.
//   2. Same movement pattern from the library. Covers everything else; ranked to
//      prefer the same role (a compound swapped for an accessory is not an equal
//      alternative, however well it matches the pattern) and then the harder,
//      more compound option.
// Anything the place can't load never appears — an alternative you can't perform
// is worse than no suggestion, because it costs a tap to discover.
//
// `pool` is library entries already filtered to this place. `available` widens
// the availability test to ids outside the library (the substitute-only lifts in
// SUB_EXERCISES), which is where most of the curated matches live — filtering
// those against `pool` alone would silently drop the best suggestions.
export function alternativesFor(originalId, { pool = [], available = null, limit = 8 } = {}) {
  const usable = available || new Set(pool.map((e) => e.id));
  const out = [];
  const push = (id) => {
    if (id && id !== originalId && usable.has(id) && !out.includes(id)) out.push(id);
  };

  for (const id of candidatesFor(originalId)) push(id);

  const orig = libraryById(originalId);
  if (orig) {
    const score = (e) => (e.role === orig.role ? 2 : 0)
      + (e.role === "compound" ? 1 : 0)
      + (!!e.unilateral === !!orig.unilateral ? 0.5 : 0);
    pool.filter((e) => e.pattern === orig.pattern && e.id !== originalId)
      .sort((a, b) => score(b) - score(a))
      .forEach((e) => push(e.id));
  }
  return out.slice(0, limit);
}

// Suggested starting load for a substitute, from the planned load × ratio,
// rounded to the actual location's equipment. Bodyweight → 0.
export function seedSubLoad(originalId, subId, plannedLoad, subImplement, location, equip) {
  if (subImplement === "bodyweight" || !plannedLoad) return 0;
  const r = SEED_RATIO[`${originalId}>${subId}`] || (subImplement === "dumbbell_single" ? 0.5 : 0.45);
  return roundLoad(plannedLoad * r, subImplement, location, equip);
}

// Effort-based back-calculation. Given the planned target (L0×R0), the substitute
// target it was matched to (Ls×R0), and the substitute sets actually performed,
// produce the EQUIVALENT planned-exercise log (rounded to the planned lift's home
// equipment). perf = actual est-1RM ÷ target est-1RM on the substitute (units
// cancel); planned load scales by perf, reps stay at the planned target, RIR
// carries through so the progression engine reads effort next week.
export function backCalcOriginal({ originalId, originalImplement, plannedLocation, plannedLoad, plannedReps,
                                   subId, subTargetLoad, subSets, equip, approximate }) {
  const R0 = plannedReps || 6;
  const denom = e1rm(subTargetLoad || 1, R0) || 1;       // substitute's intended difficulty
  // Note: the substitute's RIR reflects the SUBSTITUTE movement, not the planned
  // lift (an easy capped goblet ≠ an easy barbell squat), so we deliberately do
  // NOT carry it onto the planned lift — next week's engine infers effort from the
  // clean back-calculated reps instead, which is safer than over-reacting.
  const sets = (subSets || []).filter((s) => s.reps != null).map((s, i) => {
    const perf = e1rm(s.weightKg, s.reps) / denom;        // beat / met / missed the target
    const load = roundLoad((plannedLoad || 0) * perf, originalImplement, plannedLocation, equip);
    return { setNumber: i + 1, weightKg: load, reps: R0 };
  });
  return { exerciseId: originalId, implement: originalImplement, sets, substituted: true, via: subId,
    approximate: !!approximate };
}
