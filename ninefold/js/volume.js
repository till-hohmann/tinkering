// volume.js — weekly training volume by muscle group vs evidence-based landmarks
// (pure logic + curated data). Complements the per-lift progression engine with
// the OTHER primary hypertrophy driver from the Training Science Reference:
// weekly hard sets per muscle, managed against MEV (minimum effective volume) and
// MAV (maximum adaptive volume — the productive sweet spot).
//
// Counting convention (DIRECT vs INDIRECT fractional volume — Pelland/Schoenfeld
// 2024 dose-response). A logged working set counts toward each muscle by how much
// that muscle actually drives the lift:
//   1.0  PRIMARY   — the target / prime mover.
//   0.5  SECONDARY — a real, meaningfully-loaded contributor (rows→biceps,
//                    overhead press→triceps, hip hinge→glutes).
//   0.25 INDIRECT  — a minor/stabilising contributor that gets some stimulus but
//                    should NOT be counted as a full set (squat→glutes, bench→
//                    triceps/front-delt, hip thrust→hamstrings).
// This fixes the old flat 1.0/0.5 scheme, which double-counted every squat / hinge
// / lunge as half a glute set (and every press as half a triceps set) and so kept
// flagging Glutes/Triceps "over MAV" while real over-volume on side/rear delts was
// what should show. The app only logs working sets (no warm-ups), so every logged
// set counts.

export const MUSCLES = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Calves", "Core"];

// exerciseId -> { Muscle: contribution }. Covers the program library + the
// substitute-only lifts (db_bench_press / db_bent_row / db_pullover / db_curl / bw_pallof).
export const MUSCLE_MAP = {
  back_squat:               { Quads: 1.0, Glutes: 0.25 },              // knee-dominant: glute indirect
  rdl_barbell:              { Hamstrings: 1.0, Glutes: 0.5 },          // hip hinge: glute secondary
  bulgarian_split_squat_db: { Quads: 1.0, Glutes: 0.5 },              // split squat is glute-heavy
  db_walking_lunge:         { Quads: 0.75, Glutes: 0.5 },
  standing_calf_raise_db:   { Calves: 1.0 },
  cable_pallof:             { Core: 1.0 },
  bench_press:              { Chest: 1.0, Triceps: 0.25, Shoulders: 0.25 }, // horizontal press: tri/front-delt indirect
  bent_over_row:            { Back: 1.0, Biceps: 0.5 },
  ohp_barbell:              { Shoulders: 1.0, Triceps: 0.5 },          // overhead press: triceps secondary
  lat_pulldown:             { Back: 1.0, Biceps: 0.5 },
  incline_db_press:         { Chest: 1.0, Shoulders: 0.5, Triceps: 0.25 }, // incline loads front delt more
  face_pull:                { Shoulders: 0.5, Back: 0.5 },             // rear delt + upper back
  ez_curl:                  { Biceps: 1.0 },
  triceps_pushdown:         { Triceps: 1.0 },
  one_arm_db_row:           { Back: 1.0, Biceps: 0.5 },
  seated_db_shoulder_press: { Shoulders: 1.0, Triceps: 0.5 },
  db_reverse_fly:           { Shoulders: 0.5, Back: 0.5 },             // rear delt direct-ish + upper back
  db_lateral_raise:         { Shoulders: 1.0 },
  db_hammer_curl:           { Biceps: 1.0 },
  overhead_triceps_ext:     { Triceps: 1.0 },
  db_goblet_squat:          { Quads: 1.0, Glutes: 0.25 },
  db_rdl:                   { Hamstrings: 1.0, Glutes: 0.5 },
  db_reverse_lunge:         { Quads: 0.75, Glutes: 0.5 },
  db_hip_thrust:            { Glutes: 1.0, Hamstrings: 0.25 },         // glute-dominant: ham indirect
  // Block 2 rotation (2026-07-27)
  barbell_hip_thrust:       { Glutes: 1.0, Hamstrings: 0.25 },
  db_step_up:               { Quads: 1.0, Glutes: 0.5 },
  db_calf_raise:            { Calves: 1.0 },
  core_circuit:             { Core: 1.0 },
  // substitute-only lifts
  db_bench_press:           { Chest: 1.0, Triceps: 0.25, Shoulders: 0.25 },
  db_bent_row:              { Back: 1.0, Biceps: 0.5 },
  db_pullover:              { Back: 0.75, Chest: 0.25 },
  db_curl:                  { Biceps: 1.0 },
  bw_pallof:                { Core: 1.0 },
  // Bodyweight push/pull. Full credit — these are real working sets, not holds;
  // a pull-up is the most demanding vertical pull most people will ever do.
  bodyweight_squats:        { Quads: 1.0, Glutes: 0.25 },
  bw_lunge:                 { Quads: 0.75, Glutes: 0.5 },
  push_up:                  { Chest: 1.0, Triceps: 0.25, Shoulders: 0.25 },
  inverted_row:             { Back: 1.0, Biceps: 0.5 },
  pull_up:                  { Back: 1.0, Biceps: 0.5 },
  // Bodyweight / isometric movements. These previously lived ONLY in the
  // mobility routine, which doesn't feed volume landmarks, so they were never
  // mapped. The program builder can now select them into a real training day —
  // at which point unmapped sets would silently count toward nothing and a
  // legitimately-trained muscle would read as under-dosed. Isometrics are
  // deliberately not full-credit: a timed hold is a real stimulus but not
  // equivalent to a hard working set through a full range.
  wall_sit:                 { Quads: 0.5 },                          // isometric
  glute_bridge:             { Glutes: 1.0, Hamstrings: 0.25 },
  soleus_raise:             { Calves: 1.0 },
  dead_hang:                { Back: 0.25 },                          // grip-dominant, lats isometric
  dead_bug:                 { Core: 1.0 },
  side_plank:               { Core: 1.0 },
  bird_dog:                 { Core: 0.5 },                           // low-load motor control
};

// Muscles that count as "legs" for the 2×/week leg-frequency check (Gap A in the
// 2026-06-30 programming audit: legs are highest-mass / best recomp tissue and
// the literature favours ≥2×/week over 1× when volume is equated).
export const LEG_MUSCLES = ["Quads", "Hamstrings", "Glutes"];

// Weekly set landmarks per muscle (hard sets/week). Evidence-informed practical
// defaults for an intermediate: MEV ≈ lower bound for growth, MAV ≈ productive
// ceiling before diminishing returns / recoverability concerns.
export const LANDMARKS = {
  Chest:      { mev: 8,  mav: 16 },
  Back:       { mev: 10, mav: 18 },
  Shoulders:  { mev: 8,  mav: 18 },
  Biceps:     { mev: 6,  mav: 14 },
  Triceps:    { mev: 6,  mav: 14 },
  Quads:      { mev: 8,  mav: 16 },
  Hamstrings: { mev: 6,  mav: 14 },
  Glutes:     { mev: 6,  mav: 14 },
  Calves:     { mev: 6,  mav: 12 },
  Core:       { mev: 4,  mav: 12 },
};

function addSets(acc, exerciseId, nSets) {
  const map = MUSCLE_MAP[exerciseId];
  if (!map || !nSets) return;
  for (const m in map) acc[m] = (acc[m] || 0) + nSets * map[m];
}

// Sets per muscle from a list of logged exercises (each {exerciseId, sets:[...]}).
export function setsFromResults(strengthResults) {
  const acc = {};
  for (const ex of strengthResults || []) addSets(acc, ex.exerciseId, (ex.sets || []).length);
  return acc;
}

// Planned sets per muscle for one program week (sums prescribedSets across all
// strength days, including the optional Saturday).
export function plannedSetsByMuscle(program, weekNumber) {
  const wk = (program.weeks || []).find((w) => w.weekNumber === weekNumber);
  const acc = {};
  if (!wk) return acc;
  for (const wd in wk.days) {
    const d = wk.days[wd];
    if (!d || d.type !== "strength") continue;
    for (const e of d.exercises || []) addSets(acc, e.exerciseId, e.prescribedSets || 0);
  }
  return acc;
}

// 'under' (below MEV), 'in' (MEV–MAV), or 'over' (above MAV).
export function landmarkStatus(muscle, sets) {
  const L = LANDMARKS[muscle];
  if (!L) return "in";
  if (sets < L.mev - 1e-6) return "under";
  if (sets > L.mav + 1e-6) return "over";
  return "in";
}

// --- Leg-frequency check (programming audit Gap A) -----------------------
// Direct-equivalent leg sets in one set-map (sum of the leg muscles).
function legSetsOf(acc) {
  return LEG_MUSCLES.reduce((n, m) => n + (acc[m] || 0), 0);
}
// A session/day "trains legs" if it carries a meaningful chunk of leg volume.
// 4 direct-equivalent sets ≈ one real compound leg movement done for working sets,
// which filters out a stray lunge tacked onto an upper day.
export const LEG_DAY_THRESHOLD = 4;
export function isLegSession(strengthResults) {
  return legSetsOf(setsFromResults(strengthResults)) >= LEG_DAY_THRESHOLD;
}
// Planned leg days in one program week (counts strength days whose prescribed
// volume clears the leg threshold — includes the optional Saturday).
export function plannedLegDays(program, weekNumber) {
  const wk = (program.weeks || []).find((w) => w.weekNumber === weekNumber);
  if (!wk) return 0;
  let n = 0;
  for (const wd in wk.days) {
    const d = wk.days[wd];
    if (!d || d.type !== "strength") continue;
    const acc = {};
    for (const e of d.exercises || []) addSets(acc, e.exerciseId, e.prescribedSets || 0);
    if (legSetsOf(acc) >= LEG_DAY_THRESHOLD) n++;
  }
  return n;
}
// Leg days actually logged among a set of completed sessions (one program week).
export function loggedLegDays(sessions) {
  return (sessions || []).filter((s) => s && s.type === "strength" && isLegSession(s.strengthResult)).length;
}

// Whether a resolved day (with .exercises) is a leg day — for cardio-sequencing.
export function isLegDay(day) {
  if (!day || day.type !== "strength") return false;
  const acc = {};
  for (const e of day.exercises || []) addSets(acc, e.exerciseId, e.prescribedSets || e.sets || 3);
  return legSetsOf(acc) >= LEG_DAY_THRESHOLD;
}
