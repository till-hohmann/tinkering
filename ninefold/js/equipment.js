// equipment.js — the single vocabulary for "what can you actually train with".
//
// TWO KINDS OF KIT, AND THE DIFFERENCE MATTERS.
//
//   IMPLEMENTS are what you HOLD. The exercise library is keyed by them
//   (`implement: "barbell"`), the progression engine rounds loads against them,
//   and the substitution engine swaps between them. There are exactly seven and
//   adding an eighth means adding exercises that use it — a toggle for kit no
//   exercise references is a lie told in a nice font.
//
//   STATIONS are what you LIE ON, HANG FROM or RACK OUT OF. They gate exercises
//   without changing how a load is expressed: a bench press is a barbell lift
//   whether or not you own a bench — you simply cannot do it without one. Before
//   this existed, ticking "Barbell" was taken to mean squat rack + bench too, so
//   a garage with a bar on the floor got prescribed back squats and bench press.
//
// A place stores both in its `implements` array; stations are just further ids
// in the same list, which keeps the profile shape unchanged and means an older
// saved place still loads.
//
// LEGACY PLACES ARE NOT PENALISED. A place saved before stations existed has no
// station ids, and filtering it strictly would silently delete bench press from
// an install that has been benching for a year.
//
// Which needs an explicit marker, not an inference. "I own a bar and no rack" and
// "nobody ever asked me about racks" are both an empty station list, and they must
// behave differently — the first should lose back squat, the second must not. So
// the editor stamps SURVEYED onto every place it writes, and only a stamped place
// is filtered. A test asserts both halves, because guessing here either strands a
// beginner with lifts they can't perform or deletes lifts from someone mid-block.

export const IMPLEMENTS = [
  ["barbell", "Barbell & plates", "An olympic bar and plates"],
  ["dumbbell_pair", "Dumbbells", "A pair — fixed rack or adjustable"],
  ["ez_bar", "EZ / curl bar", "The cambered bar for curls and extensions"],
  ["cable", "Cable machine", "Adjustable pulley — pulldowns, pushdowns, face pulls"],
  ["machine", "Resistance machines", "Leg press, chest press, seated row, leg curl/extension"],
];

export const STATIONS = [
  ["bench", "Flat / adjustable bench", "Presses, rows, hip thrusts, split squats"],
  ["rack", "Squat rack or stands", "Anything you unrack: back squat, front squat, overhead press"],
  ["pullup_bar", "Pull-up bar", "Pull-ups, chin-ups, dead hangs, hanging knee raises"],
  ["dip_bars", "Dip bars / parallel bars", "Dips — also rings or a sturdy pair of bars"],
  ["landmine", "Landmine", "A bar in a corner or a landmine post"],
];

// Which station each gated exercise needs. Kept HERE rather than on the library
// entries so the whole gating story is readable in one place — and so a missing
// entry means "needs nothing", which is the safe default.
export const EXERCISE_NEEDS = {
  bench: ["bench_press", "incline_barbell_press", "close_grip_bench", "db_bench_press",
    "incline_db_press", "db_chest_fly", "db_floor_press", "barbell_hip_thrust", "db_hip_thrust",
    "db_step_up", "bulgarian_split_squat_db", "chest_supported_row", "preacher_curl",
    "incline_db_curl", "skullcrusher", "db_skullcrusher", "seated_calf_raise", "back_extension"],
  rack: ["back_squat", "front_squat", "box_squat", "rack_pull", "ohp_barbell", "push_press", "z_press"],
  pullup_bar: ["pull_up", "chin_up", "dead_hang", "hanging_knee_raise"],
  dip_bars: ["dip"],
  landmine: ["landmine_press", "t_bar_row"],
};

// exercise id -> station it requires (inverted once, at module load)
const NEEDED_BY = (() => {
  const m = {};
  for (const [station, ids] of Object.entries(EXERCISE_NEEDS)) for (const id of ids) m[id] = station;
  return m;
})();

export const stationFor = (exerciseId) => NEEDED_BY[exerciseId] || null;

/** Stamped on any place written by the place editor — see the header. */
export const SURVEYED = "stations_surveyed";

/** Has this place been asked about stations? Legacy places haven't. */
export const stationsKnown = (implementsAtPlace) =>
  (implementsAtPlace || []).includes(SURVEYED);

/** Can this exercise be done here? Unknown stations = assume yes (see header). */
export function canDoHere(exerciseId, implementsAtPlace) {
  const need = stationFor(exerciseId);
  if (!need) return true;
  if (!stationsKnown(implementsAtPlace)) return true;
  return (implementsAtPlace || []).includes(need);
}

/** Everything a fully-equipped commercial gym has — the sensible starting tick. */
export const FULL_GYM = [...IMPLEMENTS.map(([id]) => id), ...STATIONS.map(([id]) => id),
  "dumbbell_single", "bodyweight", SURVEYED];

/** The honest minimum: a floor and your own weight. */
export const BODYWEIGHT_ONLY = ["bodyweight", SURVEYED];

// Presets, because "tick fifteen things" is a worse first question than "which
// of these is you?". Each is a starting point the user then corrects.
export const PRESETS = [
  ["Commercial gym", "Everything below", FULL_GYM],
  ["Home rack", "Bar, plates, rack, bench, dumbbells",
    ["barbell", "rack", "bench", "dumbbell_pair", "dumbbell_single", "pullup_bar", "bodyweight", SURVEYED]],
  ["Dumbbells only", "A pair of adjustables and a floor",
    ["dumbbell_pair", "dumbbell_single", "bodyweight", SURVEYED]],
  ["Bodyweight", "No kit at all", BODYWEIGHT_ONLY],
];
