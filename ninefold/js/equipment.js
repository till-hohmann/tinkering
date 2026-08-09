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

// `machine` is deliberately NOT here: it is implied by ticking any individual
// machine below. Offering it as its own chip alongside them meant a user could
// tick "Leg press" and get nothing, because the library gates on the implement
// first and the specific machine second.
export const IMPLEMENTS = [
  ["barbell", "Barbell & plates", "An olympic bar and plates"],
  ["dumbbell_pair", "Dumbbells", "A pair — fixed rack or adjustable"],
  ["ez_bar", "EZ / curl bar", "The cambered bar for curls and extensions"],
  ["cable", "Cable machine", "Adjustable pulley — pulldowns, pushdowns, face pulls"],
];

export const STATIONS = [
  ["bench", "Flat bench", "Presses, rows, hip thrusts, split squats"],
  ["bench_incline", "Incline bench", "Incline presses and incline curls"],
  ["rack", "Squat rack or stands", "Anything you unrack: back squat, front squat, overhead press"],
  ["pullup_bar", "Pull-up bar", "Pull-ups, chin-ups, dead hangs, hanging knee raises"],
  ["dip_bars", "Dip bars / parallel bars", "Dips — also rings or a sturdy pair of bars"],
  ["landmine", "Landmine", "A bar in a corner or a landmine post"],
];

// Machines, asked one by one. `machine` as a single tick meant saying yes to a
// leg press implied a pec deck; gyms are not that uniform, and the generator
// then programmed kit that wasn't there.
export const MACHINE_IMPLEMENT = "machine";

export const MACHINES = [
  ["m_leg_press", "Leg press"],
  ["m_hack_squat", "Hack squat"],
  ["m_leg_extension", "Leg extension"],
  ["m_leg_curl", "Leg curl"],
  ["m_chest_press", "Chest press"],
  ["m_shoulder_press", "Shoulder press"],
  ["m_row", "Seated row"],
  ["m_pec_deck", "Pec deck / fly"],
  ["m_smith", "Smith machine"],
  ["m_calf", "Calf raise machine"],
  ["m_back_ext", "Back extension bench"],
];

// Which station each gated exercise needs. Kept HERE rather than on the library
// entries so the whole gating story is readable in one place — and so a missing
// entry means "needs nothing", which is the safe default.
export const EXERCISE_NEEDS = {
  bench: ["bench_press", "close_grip_bench", "db_bench_press",
    "db_chest_fly", "db_floor_press", "barbell_hip_thrust", "db_hip_thrust",
    "db_step_up", "bulgarian_split_squat_db", "chest_supported_row",
    "skullcrusher", "db_skullcrusher"],
  bench_incline: ["incline_barbell_press", "incline_db_press", "incline_db_curl", "preacher_curl"],
  m_leg_press: ["leg_press"],
  m_hack_squat: ["hack_squat"],
  m_leg_extension: ["leg_extension"],
  m_leg_curl: ["leg_curl"],
  m_chest_press: ["machine_chest_press"],
  m_shoulder_press: ["machine_shoulder_press"],
  m_row: ["machine_row", "seated_cable_row"],
  m_pec_deck: ["cable_fly"],
  m_smith: ["smith_squat"],
  m_calf: ["seated_calf_raise", "standing_calf_raise_machine", "donkey_calf_raise"],
  m_back_ext: ["back_extension"],
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
  ...MACHINES.map(([id]) => id), MACHINE_IMPLEMENT, "dumbbell_single", "bodyweight", SURVEYED];

/** The honest minimum: a floor and your own weight. */
export const BODYWEIGHT_ONLY = ["bodyweight", SURVEYED];

// Presets, because "tick fifteen things" is a worse first question than "which
// of these is you?". Each is a starting point the user then corrects.
// Three starting points, in order of how much kit they assume — and each one
// states what it ticks, because "Commercial gym" previously left you guessing
// whether it had assumed a hack squat.
export const BASIC_KIT = ["barbell", "dumbbell_pair", "dumbbell_single", "bench", "bench_incline",
  "rack", "bodyweight", SURVEYED];

// The hotel/apartment room, which is its own shape and not a smaller commercial
// gym: light dumbbells and a cable stack, almost never a barbell or a rack. It
// earns a preset because for anyone who travels it is the single most-described
// place, and building it from "Bodyweight only" means fifteen taps every time.
export const HOTEL_KIT = ["dumbbell_pair", "dumbbell_single", "cable", "bench",
  "m_chest_press", "m_row", MACHINE_IMPLEMENT, "bodyweight", SURVEYED];

export const PRESETS = [
  ["Bodyweight only", "Nothing but a floor", BODYWEIGHT_ONLY],
  ["Hotel or apartment gym", "Light dumbbells, a cable stack, a flat bench — no barbell, no rack", HOTEL_KIT],
  ["Basic equipment", "Barbell, dumbbells, flat + incline bench, squat rack", BASIC_KIT],
  ["Everything", "Ticks all of it, including every machine", FULL_GYM],
];
