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

// ⚠ SHOULDERS AND BACK USED TO BE ONE GROUP EACH (until v192). That made the
// commonest programming gap invisible: a week of overhead presses read as "high"
// shoulder volume while the side delts got three direct sets, and rows and
// pulldowns were one number although they are different jobs. The three delt
// heads are trained by different movements and carry separate volume guidance,
// so they are separate groups; so are lats (vertical pulls, shoulder extension)
// and upper back (rows, retraction, traps).
//
// Hamstrings and triceps are NOT split into volume groups. Their landmarks are
// for the whole muscle; what goes wrong is which MOVEMENT the sets come from
// (hinges only, never a curl; pushdowns only, never overhead). That is a
// coverage question, answered by MOVEMENT_COVERAGE below, rather than a volume
// floor someone would have to invent for half a muscle.
export const MUSCLES = ["Chest", "Lats", "UpperBack", "FrontDelts", "SideDelts", "RearDelts",
  "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Calves", "Core"];

// How a group is written for people.
export const MUSCLE_LABEL = {
  Chest: "Chest", Lats: "Lats", UpperBack: "Upper back",
  FrontDelts: "Front delts", SideDelts: "Side delts", RearDelts: "Rear delts",
  Biceps: "Biceps", Triceps: "Triceps", Quads: "Quads", Hamstrings: "Hamstrings",
  Glutes: "Glutes", Calves: "Calves", Core: "Core",
};
export const labelOf = (m) => MUSCLE_LABEL[m] || m;

// The body map (anatomy.js) draws coarse REGIONS. A region is lit from the
// groups inside it, per view: the front of the shoulder is front and side
// delts, the back of it is rear and side delts.
export const REGION_PARTS = {
  Shoulders: { front: ["FrontDelts", "SideDelts"], back: ["RearDelts", "SideDelts"] },
  Back: { front: ["Lats", "UpperBack"], back: ["Lats", "UpperBack"] },
};
export const partsOf = (region, side = "front") =>
  (REGION_PARTS[region] ? REGION_PARTS[region][side] || REGION_PARTS[region].front : [region]);

// Movements a muscle needs COVERED, within its volume. Each is a list of
// exercise ids whose sets count as direct work for that movement, and a weekly
// minimum of direct sets. General evidence, not the vault reference: the
// hamstrings grow more from knee flexion done seated/lengthened than from hip
// extension alone (Maeo 2021), and the triceps long head grows more with the
// arm overhead (Maeo 2023). The minimum is one exercise's worth of sets.
export const MOVEMENT_COVERAGE = {
  Hamstrings: [
    { id: "knee_flexion", label: "knee flexion", hint: "a leg curl or Nordic curl", min: 3,
      exercises: ["leg_curl", "nordic_curl", "slider_leg_curl"] },
    { id: "hip_extension", label: "hip extension", hint: "an RDL or other hinge", min: 3,
      exercises: ["rdl_barbell", "db_rdl", "single_leg_rdl", "deadlift", "good_morning", "sumo_deadlift", "back_extension"] },
  ],
  Triceps: [
    { id: "overhead", label: "overhead work", hint: "an overhead extension for the long head", min: 3,
      exercises: ["overhead_triceps_ext", "cable_overhead_ext"] },
  ],
};

/**
 * Direct sets per covered movement, from a flat list of { exerciseId, sets }
 * where `sets` is a count. Returns { Hamstrings: { knee_flexion: n, … }, … }.
 */
export function movementSets(entries) {
  const out = {};
  for (const [muscle, moves] of Object.entries(MOVEMENT_COVERAGE)) {
    out[muscle] = {};
    for (const mv of moves) out[muscle][mv.id] = 0;
  }
  for (const e of entries || []) {
    for (const [muscle, moves] of Object.entries(MOVEMENT_COVERAGE))
      for (const mv of moves) if (mv.exercises.includes(e.exerciseId)) out[muscle][mv.id] += e.sets || 0;
  }
  return out;
}

/**
 * The movements that fall short, for muscles that are trained at all. A muscle
 * nobody trains is the landmark check's problem, not this one's.
 * `muscleSets` is the usual { Muscle: sets } map for the same week.
 */
export function movementGaps(entries, muscleSets) {
  const sets = movementSets(entries);
  const gaps = [];
  for (const [muscle, moves] of Object.entries(MOVEMENT_COVERAGE)) {
    if (!((muscleSets || {})[muscle] > 0)) continue;
    for (const mv of moves) {
      const n = sets[muscle][mv.id];
      if (n < mv.min) gaps.push({ muscle, id: mv.id, label: mv.label, hint: mv.hint, sets: n, min: mv.min });
    }
  }
  return gaps;
}

// exerciseId -> { Muscle: contribution }. Covers the program library + the
// substitute-only lifts (db_bench_press / db_bent_row / db_pullover / db_curl / bw_pallof).
export const MUSCLE_MAP = {
  back_squat:               { Quads: 1.0, Glutes: 0.25 },              // knee-dominant: glute indirect
  rdl_barbell:              { Hamstrings: 1.0, Glutes: 0.5 },          // hip hinge: glute secondary
  bulgarian_split_squat_db: { Quads: 1.0, Glutes: 0.5 },              // split squat is glute-heavy
  db_walking_lunge:         { Quads: 0.75, Glutes: 0.5 },
  standing_calf_raise_db:   { Calves: 1.0 },
  cable_pallof:             { Core: 1.0 },
  bench_press:              { Chest: 1.0, Triceps: 0.25, FrontDelts: 0.25 }, // horizontal press: tri/front delt indirect
  bent_over_row:            { UpperBack: 1.0, Lats: 0.5, RearDelts: 0.25, Biceps: 0.5 },
  ohp_barbell:              { FrontDelts: 1.0, SideDelts: 0.5, Triceps: 0.5 }, // overhead press: triceps secondary
  lat_pulldown:             { Lats: 1.0, UpperBack: 0.25, Biceps: 0.5 },
  incline_db_press:         { Chest: 1.0, FrontDelts: 0.5, Triceps: 0.25 }, // incline loads front delt more
  face_pull:                { RearDelts: 1.0, UpperBack: 0.5 }, // rear delt + upper back
  ez_curl:                  { Biceps: 1.0 },
  triceps_pushdown:         { Triceps: 1.0 },
  one_arm_db_row:           { Lats: 1.0, UpperBack: 0.5, RearDelts: 0.25, Biceps: 0.5 },
  seated_db_shoulder_press: { FrontDelts: 1.0, SideDelts: 0.5, Triceps: 0.5 },
  db_reverse_fly:           { RearDelts: 1.0, UpperBack: 0.5 }, // rear delt direct-ish + upper back
  db_lateral_raise:         { SideDelts: 1.0 },
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
  db_bench_press:           { Chest: 1.0, Triceps: 0.25, FrontDelts: 0.25 },
  db_bent_row:              { UpperBack: 1.0, Lats: 0.5, RearDelts: 0.25, Biceps: 0.5 },
  db_pullover:              { Lats: 0.75, Chest: 0.25 },
  db_curl:                  { Biceps: 1.0 },
  bw_pallof:                { Core: 1.0 },
  // Bodyweight push/pull. Full credit — these are real working sets, not holds;
  // a pull-up is the most demanding vertical pull most people will ever do.
  bodyweight_squats:        { Quads: 1.0, Glutes: 0.25 },
  bw_lunge:                 { Quads: 0.75, Glutes: 0.5 },
  push_up:                  { Chest: 1.0, Triceps: 0.25, FrontDelts: 0.25 },
  inverted_row:             { UpperBack: 1.0, Lats: 0.5, RearDelts: 0.25, Biceps: 0.5 },
  pull_up:                  { Lats: 1.0, UpperBack: 0.25, Biceps: 0.5 },
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
  dead_hang:                { Lats: 0.25 }, // grip-dominant, lats isometric
  dead_bug:                 { Core: 1.0 },
  side_plank:               { Core: 1.0 },
  bird_dog:                 { Core: 0.5 },                           // low-load motor control

  // --- library expansion -----------------------------------------------------
  // Same fractional convention: 1.0 prime mover, 0.5 a meaningfully loaded
  // contributor, 0.25 a minor/stabilising one that gets stimulus but must not
  // count as a full set.
  deadlift:                 { Hamstrings: 1.0, Glutes: 1.0, UpperBack: 0.25, Quads: 0.25 },
  sumo_deadlift:            { Glutes: 1.0, Quads: 0.5, Hamstrings: 0.5, UpperBack: 0.25 },
  trap_bar_deadlift:        { Quads: 1.0, Glutes: 0.75, Hamstrings: 0.5, UpperBack: 0.25 },
  rack_pull:                { UpperBack: 1.0, Hamstrings: 0.5, Glutes: 0.5 },
  good_morning:             { Hamstrings: 1.0, Glutes: 0.5 },
  cable_pull_through:       { Glutes: 1.0, Hamstrings: 0.5 },
  single_leg_rdl:           { Hamstrings: 1.0, Glutes: 0.5 },
  front_squat:              { Quads: 1.0, Glutes: 0.25, Core: 0.5 },
  box_squat:                { Quads: 1.0, Glutes: 0.5 },
  smith_squat:              { Quads: 1.0, Glutes: 0.25 },
  hack_squat:               { Quads: 1.0, Glutes: 0.25 },
  leg_press:                { Quads: 1.0, Glutes: 0.5 },
  leg_extension:            { Quads: 1.0 },
  leg_curl:                 { Hamstrings: 1.0, Calves: 0.25 },
  nordic_curl:              { Hamstrings: 1.0, Calves: 0.25 },       // eccentric knee flexion
  pike_push_up:             { FrontDelts: 1.0, SideDelts: 0.25, Triceps: 0.5 },
  slider_leg_curl:          { Hamstrings: 1.0, Glutes: 0.25 },       // bridge held while curling
  goblet_curtsy_lunge:      { Quads: 0.75, Glutes: 0.5 },
  front_rack_lunge:         { Quads: 1.0, Glutes: 0.5 },
  seated_calf_raise:        { Calves: 1.0 },
  standing_calf_raise_machine: { Calves: 1.0 },
  donkey_calf_raise:        { Calves: 1.0 },
  back_extension:           { Glutes: 1.0, Hamstrings: 0.5 },

  dip:                      { Chest: 1.0, Triceps: 0.5, FrontDelts: 0.25 },
  chin_up:                  { Lats: 1.0, UpperBack: 0.25, Biceps: 0.5 },
  incline_barbell_press:    { Chest: 1.0, FrontDelts: 0.5, Triceps: 0.25 },
  close_grip_bench:         { Triceps: 1.0, Chest: 0.5, FrontDelts: 0.25 },
  db_floor_press:           { Chest: 1.0, Triceps: 0.5 },
  machine_chest_press:      { Chest: 1.0, Triceps: 0.25, FrontDelts: 0.25 },
  db_chest_fly:             { Chest: 1.0, FrontDelts: 0.25 },
  cable_fly:                { Chest: 1.0, FrontDelts: 0.25 },
  machine_shoulder_press:   { FrontDelts: 1.0, SideDelts: 0.5, Triceps: 0.5 },
  arnold_press:             { FrontDelts: 1.0, SideDelts: 0.5, Triceps: 0.5 },
  push_press:               { FrontDelts: 1.0, SideDelts: 0.25, Triceps: 0.5, Quads: 0.25 },
  landmine_press:           { FrontDelts: 1.0, Chest: 0.5, Triceps: 0.25 },
  z_press:                  { FrontDelts: 1.0, SideDelts: 0.5, Triceps: 0.5, Core: 0.5 },

  seated_cable_row:         { UpperBack: 1.0, Lats: 0.5, RearDelts: 0.25, Biceps: 0.5 },
  machine_row:              { UpperBack: 1.0, Lats: 0.5, RearDelts: 0.25, Biceps: 0.5 },
  pendlay_row:              { UpperBack: 1.0, Lats: 0.5, RearDelts: 0.25, Biceps: 0.5 },
  t_bar_row:                { UpperBack: 1.0, Lats: 0.5, RearDelts: 0.25, Biceps: 0.5 },
  chest_supported_row:      { UpperBack: 1.0, Lats: 0.5, RearDelts: 0.25, Biceps: 0.5 },
  band_pull_apart:          { RearDelts: 1.0, UpperBack: 0.5 },
  face_pull_band:           { RearDelts: 1.0, UpperBack: 0.5 },

  db_shrug:                 { UpperBack: 1.0 }, // traps
  barbell_shrug:            { UpperBack: 1.0 },
  farmers_carry:            { UpperBack: 0.5, Core: 1.0 },
  cable_lateral_raise:      { SideDelts: 1.0 },
  preacher_curl:            { Biceps: 1.0 },
  cable_curl:               { Biceps: 1.0 },
  incline_db_curl:          { Biceps: 1.0 },
  concentration_curl:       { Biceps: 1.0 },
  reverse_curl:             { Biceps: 1.0 },
  wrist_curl:               { Biceps: 0.25 },
  skullcrusher:             { Triceps: 1.0 },
  db_skullcrusher:          { Triceps: 1.0 },
  cable_overhead_ext:       { Triceps: 1.0 },

  hanging_knee_raise:       { Core: 1.0 },
  ab_wheel:                 { Core: 1.0, Lats: 0.25 },
  cable_woodchop:           { Core: 1.0 },
  russian_twist:            { Core: 1.0 },
  plank:                    { Core: 1.0 },
  hollow_hold:              { Core: 1.0 },
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
  // Split from Back 10/18 and Shoulders 8/18 in v192. Practical defaults in the
  // same RP-style convention as the rest (general evidence, not the vault
  // reference): front delts need no direct work beyond pressing, so no floor;
  // side delts respond to a lot of volume; rear delts get partial credit from
  // every row, which is why their floor is modest.
  Lats:       { mev: 6,  mav: 14 },
  UpperBack:  { mev: 6,  mav: 14 },
  FrontDelts: { mev: 0,  mav: 12 },
  SideDelts:  { mev: 8,  mav: 20 },
  RearDelts:  { mev: 6,  mav: 16 },
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

// Planned direct sets per covered movement for one program week, in the shape
// movementSets returns. The Progress tab puts this beside the muscle's bar.
export function plannedMovementEntries(program, weekNumber) {
  const wk = (program.weeks || []).find((w) => w.weekNumber === weekNumber);
  const out = [];
  if (!wk) return out;
  for (const wd in wk.days) {
    const d = wk.days[wd];
    if (!d || d.type !== "strength") continue;
    for (const e of d.exercises || []) out.push({ exerciseId: e.exerciseId, sets: e.prescribedSets || 0 });
  }
  return out;
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
