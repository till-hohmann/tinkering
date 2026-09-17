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

import { e1rm, roundLoad, loadCeiling, topSet } from "./progression.js";
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

// --- when the dumbbells here are too light ------------------------------------
//
// ⚠ THE CASE THE REST OF THIS MODULE MISSED. Substitution only ever asked "is the
// implement here?". A dumbbell lift planned for a place with 40 kg dumbbells,
// taken at a place whose rack stops at 22.5, passed that test, so the session
// just snapped the 32 kg target down to 22.5 kg AT THE SAME 8-10 REPS: a set
// worth about 60% of the planned effort, prescribed as if it were the plan. And
// it was logged as the lift's latest performance, so the next session back at
// the heavy rack progressed from 22.5.
//
// Two honest answers, and which one is right depends on the size of the gap:
//   - small gap: keep the dumbbells and add reps until the set matches the
//     planned effort (effort-matched via the same Epley e1RM the engine uses);
//   - big gap: the reps needed turn a set of 8-10 into a set of 25, which is a
//     different exercise. Swap to the barbell version of the movement if this
//     place has one, at a seeded load, and convert back afterwards.
// Either way the log is back-calculated onto the planned lift, like any swap.

// Heavier-loadable equivalents of dumbbell lifts, best first, each with the seed
// ratio (substitute load ÷ planned per-hand load, or ÷ the single dumbbell).
// Deliberately a little under the inverse of SEED_RATIO: a first attempt at an
// unfamiliar bar should undershoot, and the logged effort corrects it.
export const HEAVIER_EQUIVALENT = {
  incline_db_press:         [["incline_barbell_press", 2.3]],
  db_bench_press:           [["bench_press", 2.3]],
  db_floor_press:           [["bench_press", 2.2]],
  seated_db_shoulder_press: [["ohp_barbell", 2.0]],
  arnold_press:             [["ohp_barbell", 1.9]],
  db_bent_row:              [["bent_over_row", 2.0]],
  chest_supported_row:      [["bent_over_row", 1.9]],
  one_arm_db_row:           [["bent_over_row", 1.8]],
  db_rdl:                   [["rdl_barbell", 2.0]],
  db_hip_thrust:            [["barbell_hip_thrust", 2.6]],
  db_goblet_squat:          [["back_squat", 1.8]],
  bulgarian_split_squat_db: [["back_squat", 2.8]],
  db_curl:                  [["ez_curl", 1.8]],
  db_hammer_curl:           [["ez_curl", 1.7]],
  db_shrug:                 [["barbell_shrug", 2.0]],
};

// Keep the dumbbells while the effort-matched reps stay within this many of the
// top of the planned range; beyond it, prefer a heavier implement if there is one.
export const KEEP_WITHIN_REPS = 5;
// Never prescribe more than this at the ceiling. Past ~20 the Epley estimate is
// unreliable and the set is conditioning, not the planned stimulus.
export const MATCH_REPS_MAX = 20;

/**
 * What to do with a dumbbell lift whose planned load is above this place's
 * heaviest dumbbell. Null when it is not capped here.
 *   canUse(id) — whether an exercise can be done at this place.
 * Returns { ceiling, reps: {load, reps, exactReps}, swap: {subId, ratio} | null,
 *           prefer: "reps" | "swap" }.
 */
export function ceilingPlan({ originalId, implement, plannedLoad, plannedReps, repHi, location, equip, canUse = () => false }) {
  const ceiling = loadCeiling(implement, location, equip);
  if (ceiling == null || !(plannedLoad > 0) || !(plannedReps > 0) || plannedLoad <= ceiling + 1e-9) return null;
  const target = e1rm(plannedLoad, plannedReps);
  const exactReps = Math.max(plannedReps + 1, Math.ceil(30 * (target / ceiling - 1) - 1e-9));
  const hit = (HEAVIER_EQUIVALENT[originalId] || []).find(([id]) => canUse(id));
  const swap = hit ? { subId: hit[0], ratio: hit[1] } : null;
  const hi = repHi || plannedReps;
  const prefer = !swap || exactReps <= hi + KEEP_WITHIN_REPS ? "reps" : "swap";
  return { ceiling, reps: { load: ceiling, reps: Math.min(exactReps, MATCH_REPS_MAX), exactReps }, swap, prefer };
}

/**
 * The occurrence to progress from, skipping sets that only reflect a lighter rack.
 *
 * An occurrence logged somewhere whose dumbbells top out BELOW the rack you are
 * standing at now, with its top set pinned at that lower ceiling, measured the
 * rack rather than you. Walk back past those to the last one that did not.
 * If every occurrence is like that, the latest one is still better than nothing.
 * Substituted entries are already back-calculated and always count.
 *   occurrences: ascending [{ location, exercise }]
 */
export function progressionSource(occurrences, { implement, location, equip }) {
  const occ = occurrences || [];
  if (!occ.length) return null;
  const here = loadCeiling(implement, location, equip);
  const cappedAway = (o) => {
    if (!o.location || o.location === location || !o.exercise || o.exercise.substituted) return false;
    const there = loadCeiling(implement, o.location, equip);
    if (there == null || (here != null && here <= there)) return false;
    const ts = topSet(o.exercise);
    return !!ts && ts.weightKg >= there - 1e-9;
  };
  for (let i = occ.length - 1; i >= 0; i--) if (!cappedAway(occ[i])) return occ[i];
  return occ[occ.length - 1];
}

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
                                   subId, subTargetLoad, subTargetReps, subSets, equip, approximate }) {
  const R0 = plannedReps || 6;
  // subTargetReps differs from R0 only for the same lift at a lighter ceiling,
  // where the reps ARE the adjustment (see ceilingPlan).
  const denom = e1rm(subTargetLoad || 1, subTargetReps || R0) || 1;   // substitute's intended difficulty
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
