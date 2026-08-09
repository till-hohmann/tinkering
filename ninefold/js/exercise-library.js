// exercise-library.js — the app's catalogue of movements the program builder can
// choose from. Pure data.
//
// Previously the exercise list lived INSIDE each program's JSON, because programs
// were authored offline and shipped complete. The builder can't work that way: it
// has to pick exercises, so it needs a catalogue with enough structure to pick
// intelligently — what pattern a movement trains, what kit it needs, whether it's
// a compound worth putting first.
//
// Deliberately NOT duplicated here:
//   - muscles          -> volume.js MUSCLE_MAP (drives MEV/MAV volume landmarks)
//   - anatomical detail -> exercise-anatomy.js (drives figures and callouts)
//   - figures          -> figure.js
// An id present here must exist in all three, which check-library() below
// enforces so a half-added exercise fails the test suite rather than rendering
// as a blank card.
//
// PATTERNS are the unit the builder balances a session around. A well-formed
// strength day covers a push, a pull and a lower-body pattern; a lower day covers
// a knee-dominant and a hip-dominant movement. Balancing by pattern rather than
// by muscle is what stops the generator producing four chest exercises and no rows.

import { canDoHere } from "./equipment.js";

export const PATTERNS = {
  squat:    { name: "Squat", group: "lower", axis: "knee" },
  hinge:    { name: "Hinge", group: "lower", axis: "hip" },
  lunge:    { name: "Lunge / split", group: "lower", axis: "knee", unilateral: true },
  push_h:   { name: "Horizontal push", group: "upper" },
  push_v:   { name: "Vertical push", group: "upper" },
  pull_h:   { name: "Horizontal pull", group: "upper" },
  pull_v:   { name: "Vertical pull", group: "upper" },
  calf:     { name: "Calf", group: "lower", isolation: true },
  arm:      { name: "Arm isolation", group: "upper", isolation: true },
  delt:     { name: "Deltoid isolation", group: "upper", isolation: true },
  core:     { name: "Core", group: "core" },
  carry:    { name: "Carry / hold", group: "core" },
  // Added with the expansion: single-joint slots the builder can fill once a
  // gym has machines. Kept distinct from the compound patterns so a session
  // template can ask for "a quad isolation" without getting a squat.
  knee_iso: { name: "Knee extension", group: "lower", isolation: true },
  ham_iso:  { name: "Knee flexion", group: "lower", isolation: true },
  chest_iso:{ name: "Chest isolation", group: "upper", isolation: true },
  trap_iso: { name: "Trap / shrug", group: "upper", isolation: true },
  trap:     { name: "Trap / shrug", group: "upper", isolation: true },
};

// role: compound = trained first, heaviest, drives the block.
//       accessory = supporting volume.
//       core = trunk work, always last.
// unilateral: one side at a time — halves the load requirement, which matters a
//       lot when someone's heaviest dumbbell is the constraint.
// power: suitable for explosive/speed work (loadable fast, safe to accelerate).
const E = (id, name, implement, pattern, role, opts = {}) =>
  ({ id, name, implement, pattern, role, unilateral: !!opts.uni, power: !!opts.power,
     lower: PATTERNS[pattern].group === "lower", cue: opts.cue || "", tags: opts.tags || [] });

export const EXERCISE_LIBRARY = [
  // ---- lower: knee-dominant ----
  E("back_squat", "Barbell Back Squat", "barbell", "squat", "compound",
    { power: true, cue: "Brace hard, sit between the hips, drive the floor away" }),
  E("db_goblet_squat", "Goblet Squat", "dumbbell_single", "squat", "compound",
    { cue: "Elbows inside the knees, chest tall" }),
  E("bulgarian_split_squat_db", "Bulgarian Split Squat", "dumbbell_pair", "lunge", "accessory",
    { uni: true, cue: "Rear foot elevated, weight through the front heel" }),
  E("db_walking_lunge", "Walking Lunge", "dumbbell_pair", "lunge", "accessory",
    { uni: true, cue: "Long steps, torso upright" }),
  E("db_reverse_lunge", "Reverse Lunge", "dumbbell_pair", "lunge", "accessory",
    { uni: true, cue: "Step back and down; front shin vertical" }),
  E("db_step_up", "Step-up", "dumbbell_pair", "lunge", "accessory",
    { uni: true, cue: "Drive through the top foot, no push off the bottom leg" }),
  E("bw_lunge", "Bodyweight Lunge", "bodyweight", "lunge", "accessory",
    { uni: true, cue: "Step back and down, front shin vertical, torso tall" }),
  E("bodyweight_squats", "Bodyweight Squat", "bodyweight", "squat", "compound",
    { cue: "Sit between the hips, heels down, chest tall" }),
  E("wall_sit", "Wall Sit", "bodyweight", "squat", "accessory",
    { cue: "Thighs to parallel, quiet and steady", tags: ["isometric", "timed"] }),

  // ---- lower: hip-dominant ----
  E("rdl_barbell", "Romanian Deadlift", "barbell", "hinge", "compound",
    { cue: "Hinge from the hips, bar tight to the legs, long spine" }),
  E("db_rdl", "Dumbbell RDL", "dumbbell_pair", "hinge", "compound",
    { cue: "Push the hips back, feel the hamstrings load" }),
  E("barbell_hip_thrust", "Barbell Hip Thrust", "barbell", "hinge", "accessory",
    { cue: "Ribs down, chin tucked, squeeze at the top" }),
  E("db_hip_thrust", "Dumbbell Hip Thrust", "dumbbell_single", "hinge", "accessory",
    { cue: "Shoulders on a bench, full lockout at the top" }),
  E("glute_bridge", "Glute Bridge", "bodyweight", "hinge", "accessory",
    { cue: "Two-second squeeze at the top" }),

  // ---- calves ----
  E("standing_calf_raise_db", "Standing Calf Raise", "dumbbell_pair", "calf", "accessory",
    { cue: "Full stretch at the bottom, pause at the top" }),
  E("db_calf_raise", "Calf Raise", "dumbbell_single", "calf", "accessory",
    { cue: "Slow down, hard up" }),
  E("soleus_raise", "Bent-knee Calf Raise", "bodyweight", "calf", "accessory",
    { cue: "Knee bent throughout — that's the soleus" }),

  // ---- upper: horizontal push ----
  E("bench_press", "Barbell Bench Press", "barbell", "push_h", "compound",
    { power: true, cue: "Shoulder blades back and down, bar to the sternum" }),
  E("db_bench_press", "Dumbbell Bench Press", "dumbbell_pair", "push_h", "compound",
    { cue: "Press from the chest, don't clash the bells" }),
  E("incline_db_press", "Incline Dumbbell Press", "dumbbell_pair", "push_h", "accessory",
    { cue: "Low incline, press slightly back over the eyes" }),
  E("push_up", "Push-up", "bodyweight", "push_h", "compound",
    { cue: "Body in one line, elbows back not flared, chest to the floor" }),

  // ---- upper: vertical push ----
  E("ohp_barbell", "Overhead Press", "barbell", "push_v", "compound",
    { power: true, cue: "Squeeze the glutes, press the head through at the top" }),
  E("seated_db_shoulder_press", "Seated DB Shoulder Press", "dumbbell_pair", "push_v", "compound",
    { cue: "Ribs down, press without arching" }),

  // ---- upper: horizontal pull ----
  E("bent_over_row", "Barbell Bent-over Row", "barbell", "pull_h", "compound",
    { cue: "Hinge to ~45°, row to the lower ribs" }),
  E("db_bent_row", "Dumbbell Bent-over Row", "dumbbell_pair", "pull_h", "compound",
    { cue: "Flat back, elbows past the ribs" }),
  E("one_arm_db_row", "One-arm DB Row", "dumbbell_single", "pull_h", "accessory",
    { uni: true, cue: "Brace on the bench, pull to the hip" }),
  E("inverted_row", "Inverted Row", "bodyweight", "pull_h", "compound",
    { cue: "Heels down, body rigid, pull the sternum to the bar" }),
  E("face_pull", "Face Pull", "cable", "pull_h", "accessory",
    { cue: "High elbows, pull to the forehead, rotate out" }),
  E("db_reverse_fly", "Reverse Fly", "dumbbell_pair", "delt", "accessory",
    { cue: "Soft elbows, lead with the pinkies" }),

  // ---- upper: vertical pull ----
  E("lat_pulldown", "Lat Pulldown", "cable", "pull_v", "compound",
    { cue: "Chest tall, drive the elbows down to the ribs" }),
  E("pull_up", "Pull-up", "bodyweight", "pull_v", "compound",
    { cue: "Full hang to chin over the bar, drive the elbows to the ribs" }),
  E("db_pullover", "Dumbbell Pullover", "dumbbell_single", "pull_v", "accessory",
    { cue: "Lying on the bench, reach long behind the head" }),
  E("dead_hang", "Dead Hang", "bodyweight", "carry", "accessory",
    { cue: "Full grip, shoulders relaxed long", tags: ["isometric", "timed", "grip"] }),

  // ---- upper: isolation ----
  E("db_lateral_raise", "Lateral Raise", "dumbbell_pair", "delt", "accessory",
    { cue: "Lead with the elbows, stop at shoulder height" }),
  E("ez_curl", "EZ-bar Curl", "ez_bar", "arm", "accessory",
    { cue: "Elbows pinned, control the negative" }),
  E("db_curl", "Dumbbell Curl", "dumbbell_pair", "arm", "accessory",
    { cue: "Supinated, no swinging" }),
  E("db_hammer_curl", "Hammer Curl", "dumbbell_pair", "arm", "accessory",
    { cue: "Neutral grip, thumbs up" }),
  E("triceps_pushdown", "Triceps Pushdown", "cable", "arm", "accessory",
    { cue: "Elbows at the ribs, full lockout" }),
  E("overhead_triceps_ext", "Overhead Triceps Extension", "dumbbell_single", "arm", "accessory",
    { cue: "Deep stretch behind the head, elbows narrow" }),

  // ---- core ----
  E("cable_pallof", "Cable Pallof Press", "cable", "core", "core",
    { cue: "Resist the rotation — press straight out", tags: ["anti-rotation", "timed"] }),
  E("bw_pallof", "Anti-rotation Hold", "bodyweight", "core", "core",
    { cue: "Brace hard and refuse to twist", tags: ["anti-rotation", "timed"] }),
  E("dead_bug", "Dead Bug", "bodyweight", "core", "core",
    { cue: "Low back flat, slow opposite arm and leg", tags: ["timed"] }),
  E("side_plank", "Side Plank", "bodyweight", "core", "core",
    { uni: true, cue: "Straight line, hips high", tags: ["timed"] }),
  E("bird_dog", "Bird Dog", "bodyweight", "core", "core",
    { uni: true, cue: "Hips level, reach long", tags: ["timed"] }),
  E("core_circuit", "Core Circuit", "bodyweight", "core", "core",
    { cue: "Move through the holds without resting", tags: ["timed"] }),

  // --- library expansion: a commercial gym, not just a rack ------------------
  // ---- lower: hinge ----
  E("deadlift", "Conventional Deadlift", "barbell", "hinge", "compound",
    { power: true, cue: "Push the floor away, bar tight to the shins, finish tall" }),
  E("sumo_deadlift", "Sumo Deadlift", "barbell", "hinge", "compound",
    { cue: "Wide stance, knees out, chest up through the whole pull" }),
  E("trap_bar_deadlift", "Trap-bar Deadlift", "barbell", "hinge", "compound",
    { power: true, cue: "More upright than a straight bar - drive with the legs" }),
  E("rack_pull", "Rack Pull", "barbell", "hinge", "accessory",
    { cue: "From just below the knee, heavy, brace hard" }),
  E("good_morning", "Good Morning", "barbell", "hinge", "accessory",
    { cue: "Soft knees, hinge back until the hamstrings load" }),
  E("cable_pull_through", "Cable Pull-through", "cable", "hinge", "accessory",
    { cue: "Rope between the legs, snap the hips forward" }),
  E("single_leg_rdl", "Single-leg RDL", "dumbbell_single", "hinge", "accessory",
    { uni: true, cue: "Hips square, free leg long behind you" }),
  // ---- lower: knee ----
  E("front_squat", "Front Squat", "barbell", "squat", "compound",
    { cue: "Elbows high, torso vertical, sit straight down" }),
  E("box_squat", "Box Squat", "barbell", "squat", "compound",
    { cue: "Sit back to the box, pause, then drive up" }),
  E("smith_squat", "Smith Machine Squat", "barbell", "squat", "compound",
    { cue: "Fixed bar path - useful when training alone" }),
  E("hack_squat", "Hack Squat", "machine", "squat", "compound",
    { cue: "Back flat on the pad, knees tracking over the toes" }),
  E("leg_press", "Leg Press", "machine", "squat", "compound",
    { cue: "Full range without loading the spine" }),
  E("leg_extension", "Leg Extension", "machine", "knee_iso", "accessory",
    { cue: "Squeeze hard at the top, control the way down" }),
  E("leg_curl", "Leg Curl", "machine", "ham_iso", "accessory",
    { cue: "Heel to glute, no hip lift" }),
  E("goblet_curtsy_lunge", "Curtsy Lunge", "dumbbell_single", "lunge", "accessory",
    { uni: true, cue: "Step behind and across - glute med does the work" }),
  E("front_rack_lunge", "Front-rack Lunge", "barbell", "lunge", "accessory",
    { uni: true, cue: "Bar on the front delts, torso tall" }),
  // ---- calves ----
  E("seated_calf_raise", "Seated Calf Raise", "machine", "calf", "accessory",
    { cue: "Knee bent - this is the soleus" }),
  E("standing_calf_raise_machine", "Standing Calf Raise (machine)", "machine", "calf", "accessory",
    { cue: "Full stretch at the bottom, pause at the top" }),
  E("donkey_calf_raise", "Donkey Calf Raise", "machine", "calf", "accessory",
    { cue: "Hips hinged, deep stretch" }),
  E("back_extension", "Back Extension", "bodyweight", "hinge", "accessory",
    { cue: "Round then extend, or stay neutral and drive with the glutes" }),
  // ---- upper: horizontal push ----
  E("dip", "Dip", "bodyweight", "push_h", "compound",
    { cue: "Lean forward for chest, upright for triceps" }),
  E("incline_barbell_press", "Incline Barbell Press", "barbell", "push_h", "compound",
    { cue: "Low incline, bar to the upper chest" }),
  E("close_grip_bench", "Close-grip Bench Press", "barbell", "push_h", "accessory",
    { cue: "Hands shoulder-width, elbows tucked" }),
  E("db_floor_press", "Floor Press", "dumbbell_pair", "push_h", "accessory",
    { cue: "Triceps touch the floor, no bounce" }),
  E("machine_chest_press", "Machine Chest Press", "machine", "push_h", "compound",
    { cue: "Fixed path - easy to push close to failure safely" }),
  E("db_chest_fly", "Dumbbell Fly", "dumbbell_pair", "chest_iso", "accessory",
    { cue: "Soft elbows, wide arc, feel the stretch" }),
  E("cable_fly", "Cable Fly", "cable", "chest_iso", "accessory",
    { cue: "Constant tension through the whole arc" }),
  // ---- upper: vertical push ----
  E("machine_shoulder_press", "Machine Shoulder Press", "machine", "push_v", "compound",
    { cue: "Ribs down, press without arching" }),
  E("arnold_press", "Arnold Press", "dumbbell_pair", "push_v", "accessory",
    { cue: "Rotate from palms-in to palms-out as you press" }),
  E("push_press", "Push Press", "barbell", "push_v", "compound",
    { power: true, cue: "Short dip, then drive - the legs start it, the shoulders finish it" }),
  E("landmine_press", "Landmine Press", "barbell", "push_v", "accessory",
    { uni: true, cue: "Angled press - kinder on the shoulder than fully overhead" }),
  E("z_press", "Z Press", "barbell", "push_v", "accessory",
    { cue: "Seated on the floor, legs straight - nowhere to cheat" }),
  // ---- upper: pull ----
  E("chin_up", "Chin-up", "bodyweight", "pull_v", "compound",
    { cue: "Supinated grip - more biceps than a pull-up" }),
  E("seated_cable_row", "Seated Cable Row", "cable", "pull_h", "compound",
    { cue: "Chest tall, elbows past the ribs, no rocking" }),
  E("machine_row", "Machine Row", "machine", "pull_h", "compound",
    { cue: "Chest on the pad, pull to the waist" }),
  E("pendlay_row", "Pendlay Row", "barbell", "pull_h", "compound",
    { cue: "From the floor every rep, torso parallel" }),
  E("t_bar_row", "T-bar Row", "barbell", "pull_h", "compound",
    { cue: "Hinge, row to the sternum" }),
  E("chest_supported_row", "Chest-supported Row", "dumbbell_pair", "pull_h", "accessory",
    { cue: "On an incline bench - takes the lower back out of it" }),
  E("band_pull_apart", "Band Pull-apart", "bodyweight", "delt", "accessory",
    { cue: "Straight arms, squeeze the shoulder blades together" }),
  E("face_pull_band", "Band Face Pull", "bodyweight", "delt", "accessory",
    { cue: "High elbows, pull to the forehead, rotate out" }),
  // ---- carries, traps, arms ----
  E("db_shrug", "Dumbbell Shrug", "dumbbell_pair", "trap", "accessory",
    { cue: "Straight up, pause, no rolling" }),
  E("barbell_shrug", "Barbell Shrug", "barbell", "trap", "accessory",
    { cue: "Straight up, pause at the top" }),
  E("farmers_carry", "Farmer\u2019s Carry", "dumbbell_pair", "carry", "accessory",
    { cue: "Heavy, tall, breathe - grip and trunk under real load" }),
  E("cable_lateral_raise", "Cable Lateral Raise", "cable", "delt", "accessory",
    { uni: true, cue: "Constant tension where dumbbells go light at the bottom" }),
  E("preacher_curl", "Preacher Curl", "ez_bar", "arm", "accessory",
    { cue: "Upper arm pinned - the elbow cannot cheat" }),
  E("cable_curl", "Cable Curl", "cable", "arm", "accessory",
    { cue: "Tension all the way through" }),
  E("incline_db_curl", "Incline Dumbbell Curl", "dumbbell_pair", "arm", "accessory",
    { cue: "Arms behind the body - biggest long-head stretch" }),
  E("concentration_curl", "Concentration Curl", "dumbbell_single", "arm", "accessory",
    { uni: true, cue: "Elbow braced on the thigh, slow" }),
  E("reverse_curl", "Reverse Curl", "ez_bar", "arm", "accessory",
    { cue: "Overhand grip - brachioradialis and forearms" }),
  E("wrist_curl", "Wrist Curl", "dumbbell_pair", "arm", "accessory",
    { cue: "Forearms on the thighs, small range, high reps" }),
  E("skullcrusher", "Skullcrusher", "ez_bar", "arm", "accessory",
    { cue: "Elbows still, bar to the forehead" }),
  E("db_skullcrusher", "Dumbbell Skullcrusher", "dumbbell_pair", "arm", "accessory",
    { cue: "Neutral grip, easier on the elbows" }),
  E("cable_overhead_ext", "Cable Overhead Extension", "cable", "arm", "accessory",
    { cue: "Deep stretch behind the head" }),
  // ---- core ----
  E("hanging_knee_raise", "Hanging Knee Raise", "bodyweight", "core", "core",
    { cue: "Curl the pelvis up - no swinging" }),
  E("ab_wheel", "Ab Wheel Rollout", "bodyweight", "core", "core",
    { cue: "Ribs down, go only as far as you can hold the brace" }),
  E("cable_woodchop", "Cable Woodchop", "cable", "core", "core",
    { uni: true, cue: "Rotate from the trunk, arms just carry the handle" }),
  E("russian_twist", "Russian Twist", "bodyweight", "core", "core",
    { cue: "Slow rotation, chest tall" }),
  E("plank", "Plank", "bodyweight", "core", "core",
    { tags: ["isometric", "timed"], cue: "One straight line, glutes and ribs both switched on" }),
  E("hollow_hold", "Hollow Hold", "bodyweight", "core", "core",
    { tags: ["isometric", "timed"], cue: "Low back flat on the floor throughout" }),
];

export const byId = (id) => EXERCISE_LIBRARY.find((e) => e.id === id) || null;
export const idsInLibrary = () => EXERCISE_LIBRARY.map((e) => e.id);

// Everything trainable with the implements available at a place. `bodyweight` is
// always available, which is what makes a hotel-room fallback possible at all.
//
// Two gates, not one. The implement is what you hold; the STATION is what you
// rack out of or hang from, and it gates without changing the load — a bench
// press is a barbell lift you simply cannot do with no bench. `canDoHere`
// deliberately answers "yes" for a place that was never asked about stations,
// so an install that predates the question keeps every exercise it had.
export function availableAt(implementsAtPlace) {
  const have = new Set([...(implementsAtPlace || []), "bodyweight"]);
  return EXERCISE_LIBRARY.filter((e) => have.has(e.implement) && canDoHere(e.id, implementsAtPlace));
}

// Pick the best exercise for a pattern from what's available, preferring
// compounds and — when the only loadable kit is light — unilateral variants,
// which halve the load a movement needs to be hard.
// `exclude` forbids (same day), `usedThisWeek` merely PENALISES. The distinction
// matters: repeating a main barbell lift across the week is correct for a
// strength block, but with a large library a hypertrophy block should reach for
// an incline or a T-bar on the second upper day rather than the same bench
// twice. A 0.6 penalty is smaller than the compound bonus, so a fresh compound
// beats a repeated one while a compound still always beats an accessory.
export function pickForPattern(pattern, pool, { preferUnilateral = false, exclude = [], usedThisWeek = [] } = {}) {
  const ex = new Set(exclude);
  const used = new Set(usedThisWeek);
  const candidates = pool.filter((e) => e.pattern === pattern && !ex.has(e.id));
  if (!candidates.length) return null;
  const score = (e) => (e.role === "compound" ? 2 : 0)
    + (preferUnilateral && e.unilateral ? 1 : 0)
    + (e.implement === "barbell" ? 0.5 : 0)
    - (used.has(e.id) ? 0.6 : 0);
  return candidates.slice().sort((a, b) => score(b) - score(a))[0];
}

// Integrity check, called by the test suite. Every catalogue entry must resolve
// in every downstream table, or the exercise renders as a blank card and its
// sets never count toward a muscle.
export function checkLibrary({ muscleMap, anatomy, figures }) {
  const problems = [];
  for (const e of EXERCISE_LIBRARY) {
    if (!PATTERNS[e.pattern]) problems.push(`${e.id}: unknown pattern "${e.pattern}"`);
    if (muscleMap && !muscleMap[e.id]) problems.push(`${e.id}: missing from volume.js MUSCLE_MAP`);
    if (anatomy && !anatomy[e.id]) problems.push(`${e.id}: missing from exercise-anatomy.js`);
    if (figures && !figures.has(e.id)) problems.push(`${e.id}: no figure`);
  }
  const seen = new Set();
  for (const e of EXERCISE_LIBRARY) {
    if (seen.has(e.id)) problems.push(`${e.id}: duplicate entry`);
    seen.add(e.id);
  }
  return problems;
}
