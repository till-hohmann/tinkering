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
];

export const byId = (id) => EXERCISE_LIBRARY.find((e) => e.id === id) || null;
export const idsInLibrary = () => EXERCISE_LIBRARY.map((e) => e.id);

// Everything trainable with the implements available at a place. `bodyweight` is
// always available, which is what makes a hotel-room fallback possible at all.
export function availableAt(implementsAtPlace) {
  const have = new Set([...(implementsAtPlace || []), "bodyweight"]);
  return EXERCISE_LIBRARY.filter((e) => have.has(e.implement));
}

// Pick the best exercise for a pattern from what's available, preferring
// compounds and — when the only loadable kit is light — unilateral variants,
// which halve the load a movement needs to be hard.
export function pickForPattern(pattern, pool, { preferUnilateral = false, exclude = [] } = {}) {
  const ex = new Set(exclude);
  const candidates = pool.filter((e) => e.pattern === pattern && !ex.has(e.id));
  if (!candidates.length) return null;
  const score = (e) => (e.role === "compound" ? 2 : 0)
    + (preferUnilateral && e.unilateral ? 1 : 0)
    + (e.implement === "barbell" ? 0.5 : 0);
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
