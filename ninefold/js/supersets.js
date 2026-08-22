// supersets.js — which exercises may be run back to back, and in what order.
// Pure: no DOM, no storage.
//
// A superset is two lifts performed alternately with the rest taken after the
// pair rather than between them. It buys time and, for antagonists, a little
// performance. It also costs something that has nothing to do with training:
// while you are supersetting, you are holding two pieces of a shared gym.
//
// SO THE RULES HERE ARE PART TRAINING, PART MANNERS, and the manners are not
// decoration. A rule that quietly parks a barbell in a rack while its owner is
// across the room on a cable stack is a rule that gets someone told off, and
// then the whole feature gets switched off. Hence:
//
//   1. SUPERSETS ARE OPT-IN. Never assumed. The block is asked at build time and
//      a PLACE may override it — the same programme is reasonable in a home gym
//      and antisocial in a busy commercial one at six in the evening.
//   2. ANYTHING NEEDING EQUIPMENT PAIRS AT MOST TWO DEEP. Bench and rows is a
//      superset. Bench, rows and a leg press is three stations held by one
//      person, and nobody gets to do that.
//   3. NO EQUIPMENT, NO LIMIT. A core or stability circuit occupies a patch of
//      floor. Plank, leg raise, side plank both sides is four elements and costs
//      the room nothing, so it runs as a circuit.
//   4. THE SAME KIT BEATS TWO KINDS OF KIT. Dumbbell bench with dumbbell rows
//      needs one set of dumbbells and one bench; dumbbell bench with a cable row
//      needs a bench, dumbbells AND a cable stack. Both are legal supersets and
//      only one of them is considerate, so sameness is weighted heavily.

import { EXERCISE_LIBRARY, PATTERNS } from "./exercise-library.js";
import { EXERCISE_NEEDS } from "./equipment.js";

const BY_ID = new Map(EXERCISE_LIBRARY.map((e) => [e.id, e]));
export const exerciseById = (id) => BY_ID.get(id) || null;

/** Stations that are a patch of floor rather than a thing someone else wants. */
const FREE_STATIONS = new Set(["floor", "mat", "wall"]);

/** Every exercise that needs a station somebody else could be waiting for. */
const STATION_BOUND = new Set();
for (const [station, ids] of Object.entries(EXERCISE_NEEDS || {})) {
  if (FREE_STATIONS.has(station)) continue;
  for (const id of ids) STATION_BOUND.add(id);
}

/**
 * Does this movement tie up equipment?
 *
 * ⚠ NOT THE SAME QUESTION AS "is it bodyweight". A pull-up is bodyweight and
 * occupies the only bar in the room; a dead hang likewise. Reading `implement`
 * alone would have let a four-element circuit form around the pull-up bar and
 * call it free.
 *
 * ⚠ `hanging_knee_raise` IS FLOOR WORK IN THIS APP DESPITE ITS NAME. The id is a
 * misnomer inherited from the first library: it is prescribed inside the floor
 * core circuit, its photograph is a lying leg raise, and that is how it is
 * actually done. Left in the station-bound set it capped the core circuit at two
 * elements and pushed the leg raise off to be paired with calf raises.
 */
const FLOOR_ANYWAY = new Set(["hanging_knee_raise"]);

export function occupiesEquipment(ex) {
  const e = typeof ex === "string" ? exerciseById(ex) : ex;
  if (!e) return true;                       // unknown: assume it costs something
  if (FLOOR_ANYWAY.has(e.id)) return false;
  if (STATION_BOUND.has(e.id)) return true;
  return e.implement !== "bodyweight";
}

/** How many exercises may be chained together, given what they need. */
export const MAX_EQUIPMENT_CHAIN = 2;
export const chainLimit = (exercises) =>
  exercises.some(occupiesEquipment) ? MAX_EQUIPMENT_CHAIN : Infinity;

// --- can these two go together? ---------------------------------------------
/** Patterns that oppose each other — the pairing a coach reaches for first. */
const ANTAGONIST = [
  ["push_h", "pull_h"], ["push_v", "pull_v"],
  ["push_h", "pull_v"], ["push_v", "pull_h"],
  ["knee_iso", "ham_iso"], ["chest_iso", "trap"],
];
const opposes = (a, b) => ANTAGONIST.some(([x, y]) =>
  (a === x && b === y) || (a === y && b === x));

/** Arm work is one pattern covering two opposite muscles; the tags separate them. */
const armSide = (e) => ((e.tags || []).includes("biceps") ? "biceps"
  : (e.tags || []).includes("triceps") ? "triceps" : null);

const groupOf = (e) => (PATTERNS[e.pattern] || {}).group || "other";

/**
 * How good a superset this pair makes. 0 means "do not".
 *
 * A score rather than a boolean because almost every rule here is a preference
 * with a legitimate exception, and the generator should take the best available
 * pair rather than the first legal one.
 */
export function pairScore(a, b) {
  if (!a || !b || a.id === b.id) return 0;
  // A carry is a walk. You cannot alternate it with anything, because you are
  // not standing where you left the other exercise.
  if (a.pattern === "carry" || b.pattern === "carry") return 0;
  const arms = armSide(a) && armSide(b) && armSide(a) !== armSide(b);
  // The same pattern twice is not a superset, it is a drop set with extra steps,
  // and it removes the recovery the pairing exists to buy. Biceps against
  // triceps is the exception: one pattern, two opposite muscles.
  if (a.pattern === b.pattern && !arms) return 0;
  // ⚠ TWO HEAVY LOWER-BODY COMPOUNDS IS NOT A SUPERSET, IT IS A BEATING. Squats
  // into deadlifts share a spine, a rack and a recovery budget; the second lift
  // is simply worse than it would have been on its own.
  if (a.role === "compound" && b.role === "compound"
      && groupOf(a) === "lower" && groupOf(b) === "lower") return 0;

  let s = 1;
  if (opposes(a.pattern, b.pattern)) s += 3;
  if (arms) s += 3;
  if (groupOf(a) !== groupOf(b)) s += 2;
  // MANNERS, WEIGHTED TO WIN. The same implement usually means one station and
  // one walk; different implements means two things held at once.
  if (a.implement === b.implement) s += 3;
  const costA = occupiesEquipment(a), costB = occupiesEquipment(b);
  if (!costA && !costB) s += 2;
  else if (!costA || !costB) s += 1;
  if (a.role === "accessory" && b.role === "accessory") s += 1;
  // Legal — bench and rows is the canonical example — but it asks a lot of a
  // session, so it loses to a lighter pairing whenever one exists.
  if (a.role === "compound" && b.role === "compound") s -= 2;
  // Two lower-body lifts compete for the same legs, so the second one is worse
  // than it would have been. Allowed — a pair of dumbbell lower lifts is one set
  // of dumbbells and exactly the trade rule 4 asks for — but never preferred.
  if (groupOf(a) === "lower" && groupOf(b) === "lower") s -= 1;
  return Math.max(0, s);
}

/**
 * ⚠ A WEAK PAIR IS WORSE THAN NO PAIR, so pairing has a floor rather than just a
 * ban list. A back squat with a leg-curl machine scores 1: legal by every rule
 * above and still two stations, two walks and two queues for a combination
 * nobody would write down. Below this, the exercise runs on its own.
 */
export const MIN_PAIR_SCORE = 3;
export const canPair = (a, b) => pairScore(a, b) >= MIN_PAIR_SCORE;

/**
 * Group a day's exercises into supersets and circuits.
 *
 * `entries` are the day's exercise entries in plan order ({ exerciseId, ... }).
 * Returns groups of two or more exercise ids; anything unnamed runs on its own.
 */
export function buildSupersets(entries, { allow = true } = {}) {
  if (!allow || !Array.isArray(entries) || entries.length < 2) return [];
  const items = entries
    .map((e) => ({ entry: e, ex: exerciseById(e.exerciseId) }))
    // A COMPOSITE IS ALREADY A GROUP AND CANNOT JOIN ANOTHER ONE. Left in, the
    // generator cheerfully paired a goblet squat with the Core Circuit, which
    // expands at run time into three more exercises — a two-element superset
    // that turns into a four-element one the moment it is opened, and a squat
    // rack held for the duration of a floor circuit.
    .filter((x) => x.ex && !COMPOSITE[x.entry.exerciseId]);
  const groups = [];
  const taken = new Set();

  // 1. THE FREE-FLOOR CIRCUIT FIRST, and it takes everything it can.
  // Core work needing no equipment is the one case with no size limit, so it is
  // collected before pairing starts — otherwise the plank would have been paired
  // off two-by-two and the circuit would never have formed at all.
  const free = items.filter((x) => !occupiesEquipment(x.ex) && groupOf(x.ex) === "core");
  if (free.length >= 2) {
    free.forEach((x) => taken.add(x.entry.exerciseId));
    groups.push(free.map((x) => x.entry.exerciseId));
  }

  // 2. Everything else pairs, at most two deep, best partner first.
  for (const x of items) {
    if (taken.has(x.entry.exerciseId)) continue;
    let best = null, bestScore = 0;
    for (const y of items) {
      if (y === x || taken.has(y.entry.exerciseId)) continue;
      const sc = pairScore(x.ex, y.ex);
      if (sc >= MIN_PAIR_SCORE && sc > bestScore) { bestScore = sc; best = y; }
    }
    if (!best) continue;
    taken.add(x.entry.exerciseId);
    taken.add(best.entry.exerciseId);
    groups.push([x.entry.exerciseId, best.entry.exerciseId]);
  }
  return groups;
}

/**
 * Validate declared supersets against the rules, returning what may actually run.
 *
 * A block can carry supersets written by hand — several of Till's do, and they
 * predate any of this — so they are honoured, but not blindly: a hand-written
 * trio of machine exercises is still three stations held by one person.
 */
export function usableSupersets(groups, { allow = true } = {}) {
  if (!allow) return [];
  const out = [];
  for (const g of groups || []) {
    const ids = (g || []).filter((id) => exerciseById(id));
    if (ids.length < 2) continue;
    const limit = chainLimit(ids.map(exerciseById));
    out.push(limit === Infinity ? ids : ids.slice(0, limit));
  }
  return out;
}

/**
 * The order to run a day in, with grouped exercises adjacent.
 *
 * Each grouped entry carries `supersetId`, `supersetIndex` and `supersetSize` so
 * the session can say "1 of 2" and take the rest AFTER the pair rather than
 * inside it. A group is anchored at its first member's original position, so
 * compounds still come before accessories and core still comes last.
 */
export function orderWithSupersets(entries, groups) {
  const idx = new Map();
  (groups || []).forEach((g, gi) => g.forEach((id, i) => idx.set(id, { gi, i })));
  const out = [];
  const placed = new Set();
  for (const e of entries) {
    const at = idx.get(e.exerciseId);
    if (!at) { out.push(e); continue; }
    if (placed.has(at.gi)) continue;              // the whole group went in already
    placed.add(at.gi);
    const g = groups[at.gi];
    for (let i = 0; i < g.length; i++) {
      const member = entries.find((x) => x.exerciseId === g[i]);
      if (member) out.push({ ...member, supersetId: at.gi, supersetIndex: i, supersetSize: g.length });
    }
  }
  return out;
}

/**
 * A LABEL FOR WHAT THE PAIRING ACTUALLY IS, so the plan can say it in words.
 * Two things alternated is a superset; three or more is a circuit, and the only
 * groups that reach three are the free-floor ones.
 */
export const groupLabel = (ids) => (ids.length > 2 ? "Circuit" : "Superset");

// --- composite exercises ------------------------------------------------------
/**
 * EXERCISES THAT ARE ALREADY A CIRCUIT, WRITTEN AS ONE LINE.
 *
 * "Core Circuit" is a single library entry whose own name lists three movements:
 * plank, leg raise, side plank. As one entry it was logged by typing a number of
 * seconds into a stepper — no countdown, no per-exercise timing, and no way to
 * say which of the three you actually managed. Naming the members turns it into
 * what it always was: a circuit of holds, each one timed and each one able to
 * end early and record what you held.
 *
 * The side plank is unilateral, so the circuit is four elements to perform and
 * three to program — which is exactly how it reads on the plan.
 */
export const COMPOSITE = {
  core_circuit: ["plank", "hanging_knee_raise", "side_plank"],
};

/**
 * Replace any composite entry with its members.
 *
 * Returns `{ entries, groups }`: the day's entries with the composite expanded in
 * place, and the members named as a group so they run as one circuit. Everything
 * the composite entry carried — sets, rest, role — is inherited by each member,
 * because the rounds were always rounds of the whole circuit.
 */
export function expandComposites(entries) {
  const out = [];
  const groups = [];
  for (const e of entries || []) {
    const members = COMPOSITE[e.exerciseId];
    if (!members || !members.every(exerciseById)) { out.push(e); continue; }
    groups.push(members.slice());
    for (const id of members) out.push({ ...e, exerciseId: id, fromComposite: e.exerciseId });
  }
  return { entries: out, groups };
}

// --- may we, here, today? -----------------------------------------------------
/**
 * WHETHER SUPERSETS RUN, given the block and the place you are standing in.
 *
 * Two levels, because the answer genuinely has two halves. The BLOCK decides
 * whether the programme was written with supersets in mind at all — that is a
 * training question and it is asked once, in the builder. The PLACE decides
 * whether it is reasonable to do them here, which is not a training question at
 * all: the same pairing is fine in a home gym and antisocial in a commercial one
 * at six in the evening, and someone who trains in a different city most weeks
 * should not have to rebuild a block to say so.
 *
 * A place holds a TRI-STATE. `null` means "whatever the block says", which is
 * the default and the only value a place has until somebody changes it — an
 * unanswered question must never read as a no.
 */
export function supersetsAllowed(program, place) {
  if (place && typeof place.supersets === "boolean") return place.supersets;
  return !!(program && program.supersets);
}

/**
 * WHO IS NEXT, mid-superset.
 *
 * After finishing set `round` of the exercise at `exIndex`, this returns the
 * index of the group member still owing that round, or -1 when the round is
 * complete and it is time to rest. Walking the group cyclically from where you
 * are is what makes a three-element circuit go 1 to 2 to 3 and back to 1, rather
 * than handing back to its first member every time.
 *
 * `setsDone(i)` reports how many sets of member `i` are already logged. It is a
 * callback because the answer lives in the committed results rather than in any
 * screen: the partner screen does not exist while you are standing in this one.
 */
export function nextInGroup(exercises, exIndex, round, setsDone) {
  const cur = exercises[exIndex];
  if (!cur || cur.supersetId == null || !cur.supersetSize) return -1;
  for (let k = 1; k < cur.supersetSize; k++) {
    const want = (cur.supersetIndex + k) % cur.supersetSize;
    const j = exercises.findIndex((e) => e.supersetId === cur.supersetId && e.supersetIndex === want);
    if (j >= 0 && setsDone(j) < round && (exercises[j].prescribedSets || 0) >= round) return j;
  }
  return -1;
}
