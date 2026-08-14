// yoga/generate.js — composes a sequence. Pure: no DOM, no storage, no clock.
//
// THE ARC IS A HARD DEPENDENCY, NOT A PREFERENCE:
//
//   centering -> warm-up -> build -> PEAK -> COUNTER -> cool-down -> savasana
//
// Preparatory poses MUST precede the peak and counter-poses MUST follow it. This
// is the one place the yoga side genuinely cannot reuse the lifting machinery:
// reordering a workout is fine, reordering a sequence is not. The v167 Swap /
// Later / Add controls are therefore disabled inside a flow (views/yoga.js),
// because a control that moves a pose can move a counter-pose in front of the
// thing it counters.
//
// The proportions are the teaching convention, and they are checkable numbers
// rather than taste: the peak lands at 60-70% of elapsed time, savasana takes
// 10-20% of the session, and a peak gets 3-4 specific preparatory poses if it is
// simple and 6-8 if it is not. quality.js grades a finished flow against exactly
// these, from the start rather than after a bad sequence ships.
//
// THE CONTRAINDICATION FILTER IS AN INPUT, NOT A POLISH PASS. It runs before
// anything is chosen, and what it removed is reported on the flow so the app can
// say which poses are missing and why instead of silently omitting them.

import { ASANAS, byId, isContraindicated, limitsHit, COUNTER_FAMILY, PREP_MIN, FAMILIES } from "./asanas.js";
import { STYLES, styleById, holdSecondsFor, holdBreathsFor, BREATH_SECONDS_DEFAULT,
  MAX_ITEM_SHARE, MAX_TRANSITION_SHARE } from "./styles.js";
import { intentById, emphasisFor, accountingFor } from "./intents.js";
import { primarySeries } from "./ashtanga.js";
import { rng, seedFrom, resolvePose, REPEATABLE, itemSeconds, flowSeconds } from "./compose.js";
import { levelById, normaliseLevel, poseCeiling } from "./levels.js";
import { POSITION_TIERS, tierOf } from "./positions.js";
import { transitionScore, transitionFault, faultsIn } from "./transitions.js";

// Re-exported so callers that think of these as "the generator's" keep working;
// they live in compose.js because the authored Primary Series needs them too.
export { rng, seedFrom, resolvePose, REPEATABLE, itemSeconds, flowSeconds, SUBSTITUTES } from "./compose.js";

// --- phase plans -------------------------------------------------------------
// Shares of total session time. The peaked plan puts the peak block at 62-68% of
// elapsed, which is the convention and what quality.js checks.
const PLAN_PEAKED = [
  ["centering", 0.05], ["warmup", 0.15], ["build", 0.42],
  ["peak", 0.06], ["counter", 0.07], ["cool", 0.13], ["savasana", 0.12],
];
const PLAN_FLAT = [
  ["centering", 0.06], ["warmup", 0.12], ["build", 0.48], ["cool", 0.19], ["savasana", 0.15],
];
// A SHORT PRACTICE IN A LONG-HOLD STYLE CANNOT AFFORD FIVE PHASES. Every phase
// places at least one pose — a phase with nothing in it is a broken arc — and in
// yin or restorative one pose is minutes long. Five of those is a floor of about
// thirteen minutes whatever was asked for, so below twenty minutes those styles
// fold the warm-up into the build rather than overrunning by a third. The arc
// still runs in order; it just has one fewer station.
const PLAN_SHORT = [
  ["centering", 0.14], ["build", 0.49], ["cool", 0.22], ["savasana", 0.15],
];

// How well a pose's intensity suits a phase. Not a hard filter — a gentle pose in
// the build is fine, a wheel in the warm-up is not (and `phases` already forbids
// that); this only biases the pick.
const PHASE_INTENSITY = { centering: 1, warmup: 2, build: 4, peak: 5, counter: 2, cool: 1.5, savasana: 1 };

// --- sun salutation ----------------------------------------------------------
// A vinyasa's warm-up is not a list of poses, it is a linked sequence run as
// rounds. Surya Namaskar is also the ONLY yoga sequence the energy-cost review
// measured in the moderate-to-vigorous band (7.4 METs against 2.2 for a typical
// asana), so this is where a flow's intensity actually comes from.
const SURYA_A = ["urdhva_hastasana", "uttanasana", "ardha_uttanasana", "chaturanga",
  "urdhva_mukha", "adho_mukha"];
const SURYA_B = ["utkatasana", "uttanasana", "ardha_uttanasana", "chaturanga",
  "urdhva_mukha", "adho_mukha", "virabhadrasana_1", "chaturanga", "urdhva_mukha", "adho_mukha"];

/**
 * ONE ROUND OF A SALUTATION IS ONE STEP, NOT SIX.
 *
 * Each movement genuinely is one breath — that is what "one breath, one
 * movement" means — but showing six consecutive five-second countdowns is not
 * how anybody experiences a sun salutation, and it was the first thing that
 * looked wrong on the mat. A teacher calls the movements WHILE you flow; the
 * round is the unit, and the movements are narration inside it.
 *
 * So the round becomes a single timed item whose duration is the sum of its
 * movements, carrying the movement list for the player to show and the voice to
 * call. The last shape (downward dog) keeps its own held step, because that one
 * genuinely is a hold.
 */
function salutationItems(list, ctx, { holdLast = 5, variant = "A", round = 1, rounds = 1 } = {}) {
  const moves = [];
  for (const id of list.slice(0, -1)) {
    const a = resolvePose(id, ctx);
    if (a) moves.push({ id: a.id, name: a.name, art: a.art });
  }
  const lastPose = resolvePose(list[list.length - 1], ctx);
  const out = [];

  if (moves.length) {
    // One breath per movement, at the practitioner's own breath rate.
    const seconds = moves.length * ctx.breathSeconds;
    // The first RESOLVED movement, not the first named one: a shoulder or a
    // wrist can make the opening shape unavailable, and `moves` already holds
    // only what survived the substitution chain.
    const first = byId(moves[0].id);
    const it = makeItem(first, ctx, { phase: "warmup", breaths: moves.length });
    it.durationSeconds = Math.max(4, Math.round(seconds));
    it.holdBreaths = moves.length;
    it.transitionSeconds = round === 1 ? ctx.style.transitionSeconds : 0;
    it.name = `Sun salutation ${variant}`;
    it.sanskrit = `Surya Namaskara ${variant}`;
    it.salutation = variant;
    it.round = round;
    it.rounds = rounds;
    it.moves = moves;              // what the player shows and the voice calls
    it.linked = false;             // it is a step now, not a fragment of one
    it.flowRound = true;
    it.bilateral = false;
    out.push(it);
  }
  if (lastPose) {
    const hold = makeItem(lastPose, ctx, { phase: "warmup", breaths: holdLast });
    hold.salutation = variant;
    hold.round = round;
    out.push(hold);
  }
  return out;
}

// --- item construction -------------------------------------------------------
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function makeItem(asana, ctx, { phase, breaths = null, t = 0.5, linked = false } = {}) {
  const style = ctx.style;
  // THE STYLE GOVERNS HOW LONG A HOLD IS; the pose's own `hold` only says WHERE
  // IN THE STYLE'S RANGE it belongs.
  //
  // Reading the pose's hold as the answer was the first version and it was
  // wrong in a way that was invisible one pose at a time: butterfly says ten
  // breaths because butterfly is a long-hold shape, so inside a vinyasa it
  // produced a fifty-second hold in a three-to-five-breath practice. Sixty-three
  // percent of swept flows carried at least one hold outside their own style's
  // band. A style is largely DEFINED by how long it holds things, so the style
  // has to win and the pose gets a preference within it.
  const tt = breaths != null ? t
    : (asana.hold != null ? clamp01((asana.hold - 3) / 12) : t);
  // Dynamic movement is not a hold and is not judged as one — the same
  // distinction routine.js already draws between a stretch you can fail and an
  // easy jog on a fixed clock.
  const dynamicBreaths = asana.dynamic && asana.hold ? asana.hold : null;
  const holdBreaths = holdBreathsFor(style, { t: tt, breaths: breaths != null ? breaths : dynamicBreaths });
  const seconds = asana.id === "savasana"
    ? ctx.savasanaSeconds
    : holdSecondsFor(style, { breathSeconds: ctx.breathSeconds, t: tt,
        breaths: breaths != null ? breaths : dynamicBreaths });
  const floor = ["seated", "supine", "restorative", "hip_opener", "forward_fold"].includes(asana.family);
  // The requested LENGTH is a constraint on every pose in it. See MAX_ITEM_SHARE.
  //
  // ⚠ AN ASYMMETRIC POSE COSTS THE SHARE TWICE. The cap was applied to the hold
  // and the hold is per SIDE, so a bilateral pose at the ceiling took 44% of the
  // practice: a 30-minute yin session gave dragon 245 seconds a side, eight
  // minutes on one shape, and the check that exists to prevent exactly that
  // reported it as compliant.
  const capSeconds = ctx.targetSeconds
    ? (ctx.targetSeconds * MAX_ITEM_SHARE) / (asana.bilateral ? 2 : 1) : Infinity;
  const capTrans = ctx.targetSeconds ? ctx.targetSeconds * MAX_TRANSITION_SHARE : Infinity;
  const rawTrans = linked ? 0 : (floor ? style.floorTransitionSeconds : style.transitionSeconds);
  return {
    asanaId: asana.id,
    name: asana.name,
    sanskrit: asana.sanskrit,
    family: asana.family,
    phase,
    cue: asana.cue,
    easier: asana.easier,
    props: asana.props,
    art: asana.art,
    bilateral: asana.bilateral,
    intensity: asana.intensity,
    holdBreaths: linked ? 1 : holdBreaths,
    // The level scales the hold and the transition: an expert holds longer and
    // moves between shapes faster, a beginner the reverse — more time to arrive
    // somewhere they have not been, less time spent there.
    // Savasana is EXEMPT: it is already computed as a proportion of the finished
    // practice, so scaling it again by the level pushed it straight out of the
    // 10-20% band it was just derived to sit inside.
    durationSeconds: Math.max(3, Math.round(Math.min(
      seconds * (asana.id === "savasana" ? 1 : ((ctx.L && ctx.L.holdScale) || 1)), capSeconds))),
    dynamic: !!asana.dynamic,
    plane: asana.plane,
    // Carried onto the item so the ordering, the fitting pass and quality.js can
    // all reason about the sequence without re-looking-up every pose.
    position: asana.position,
    facing: asana.facing,
    hipRotation: asana.hipRotation,
    spine: asana.spine,
    still: asana.still,
    // A vinyasa's linked movements have NO transition — that is what "one breath,
    // one movement" means. A change to or from the floor needs real time.
    transitionSeconds: Math.round(Math.min(rawTrans * ((ctx.L && ctx.L.transitionScale) || 1), capTrans)),
    linked,
  };
}

// --- the picker --------------------------------------------------------------
//
// SELECTION AND ORDER ARE NOW TWO DIFFERENT QUESTIONS, and conflating them was
// most of what made the old flows read like a random walk.
//
// The picker below answers "does this pose belong in this practice at all" —
// suitability for the phase, the intent's emphasis, spread across families. It
// deliberately says NOTHING about neighbours, because the answer to "what should
// follow triangle" is not knowable while you are still choosing the cast.
//
// orderGroup() answers the second question, once the set is known. That split is
// what lets family variety and adjacency-by-similarity both be true: the old
// scorer served both with one number, penalising a pose 65% for sharing a family
// with its neighbour, and so optimised directly against the thing the sequencing
// literature says to reach for.
function scoreFor(asana, ctx, phase, used, recentFamilies, allowRepeat = false, state = {}) {
  // ⚠ A LONG-HOLD STYLE HAS NO "BUILD" IN THE VINYASA SENSE, and the library is
  // written that way: shoelace, sleeping swan, caterpillar and banana are all
  // marked cool-only, because in a flowing practice that is the only place they
  // belong. Read literally that left a yin BUILD with almost nothing eligible —
  // a 30-minute wind-down came out as three shapes, one of them the whole build.
  // Where the style holds in minutes, the body of the practice and its cool-down
  // are the same pool.
  const phaseOk = asana.phases.includes(phase)
    || (ctx.style.holdSeconds && phase === "build" && asana.phases.includes("cool"));
  if (!phaseOk) return 0;
  // A long practice legitimately revisits a warrior; a short one that repeats
  // triangle six times is padding. So repetition is forbidden on the first pass
  // and merely expensive on the second, which only runs when the pool of unused
  // poses is genuinely exhausted before the phase's time is.
  if (!REPEATABLE.has(asana.id) && used.has(asana.id) && !allowRepeat) return 0;
  if (asana.level > ctx.level) return 0;
  const [lo, hi] = ctx.style.intensityBand;
  if (asana.intensity < lo || asana.intensity > hi) return 0;
  const emph = emphasisFor(ctx.intent, asana.family);
  if (emph === 0) return 0;
  // A pose that is only ever a peak must not be picked as ordinary build work.
  if (asana.peak > 0 && phase !== "peak") return 0;
  // A LINK IS NOT A DESTINATION. Half lift and upward salute exist to get you
  // somewhere; the authored salutations place them and nothing else should. They
  // used to be pickable and it never showed, because the picker ranged over the
  // whole library at once and they were two candidates among ninety. Restricted
  // to one body position at a time the pool is small enough that the roulette
  // reaches them constantly — a build came out as seven half lifts.
  if (asana.transitional) return 0;
  // HOW MANY TIMES ONE POSE MAY APPEAR. `allowRepeat` was meant to permit a
  // repeat when the pool runs dry before the time does; with no cap it permitted
  // ALL of them, and a standing block filled itself with nine chairs.
  // Only the neutral shapes a practice keeps returning to may come round again.
  // Extending the allowance to everything is how one build ran warrior I twice
  // three poses apart: the second pass exists for the case where the pool is
  // exhausted before the time is, and under-running a phase by a minute is a far
  // smaller defect than teaching the same warrior twice.
  const cap = REPEATABLE.has(asana.id) ? 2 : 1;
  if (((state.counts && state.counts[asana.id]) || 0) >= cap) return 0;
  // A transitional pose is never a long hold. In a breath-counted style it is
  // fine — a few breaths in a half lift is what a half lift is — but a style that
  // holds in MINUTES must not reach for one.
  if (asana.transitional && ctx.style.holdSeconds) return 0;
  // ⚠ A STYLE THAT HOLDS IN MINUTES MAY ONLY REACH FOR SHAPES YOU CAN HOLD FOR
  // MINUTES. Nothing said which those were, so a 30-minute yin practice
  // prescribed upward plank for 225 seconds and a deep squat for 245 — a
  // strength shape and a loaded squat, each held for around four minutes. The
  // hold length was inside the style's own band every time, which is why the
  // existing holds.suit_style check passed it: the defect was never the number,
  // it was asking that number of a pose that cannot answer it.
  if (ctx.style.holdSeconds && !asana.still) return 0;
  let s = emph;
  // intensity fit: how close the pose sits to what this phase wants
  s *= 1 / (1 + Math.abs(asana.intensity - PHASE_INTENSITY[phase]) * 0.55);
  // SPREAD ACROSS FAMILIES OVER THE WHOLE PRACTICE, not against the last three
  // poses. Measuring it locally is what made neighbours repel each other: two
  // hip openers in a row is how a hip sequence is taught, while eleven hip
  // openers in a forty-minute flow is a practice with a hole in it. Same
  // intention as the lifting picker's quality tags, at the right scale.
  const rep = recentFamilies.filter((f) => f === asana.family).length;
  s *= Math.pow(FAMILY_SPREAD, rep);
  if (used.has(asana.id)) s *= REPEATABLE.has(asana.id) ? 0.16 : 0.12;
  // A pose that appeared four poses ago is a repeat whatever the pool says.
  if (state.recentIds && state.recentIds.includes(asana.id)) s *= 0.05;
  // A LIGHT PREFERENCE FOR SOMETHING THAT FOLLOWS ON, and light is the point.
  // Selection is not ordering: applying the full transition score here would
  // discard, at zero, poses that orderGroup would have placed perfectly happily
  // three steps later in the same group. Damped to [0.5, 1.5] it never removes a
  // candidate — it just means a phase that can only hold one pose picks one that
  // belongs where the practice already is.
  if (state.prev) s *= 0.5 + 0.5 * Math.min(transitionScore(state.prev, asana), 2);
  return s;
}

/** Per earlier appearance of a family. Gentler than the 0.35 it replaced, which
 *  measured only the last three poses and so made neighbours repel each other. */
const FAMILY_SPREAD = 0.6;

/**
 * WHAT COMES LATE IN A GROUP whatever its intensity says.
 *
 * Balance work belongs after the standing strength work, not before it: you
 * balance better on a leg that has been loaded, and a standing peak is almost
 * always a balance, so this is also what walks the practice up to it. Ordering
 * on intensity alone put tree and eagle ahead of the warriors, which reads as
 * the class starting with its garnish.
 */
const LATE_FAMILIES = { balance: 1.5 };

/**
 * WHERE A STYLE SPENDS ITS BUILD. A vinyasa is a standing practice that visits
 * the floor; a yin practice is a floor practice that occasionally stands up.
 * Without this the split followed the LIBRARY, which holds 35 seated poses to 24
 * standing ones — so every style would have drifted onto the floor.
 */
const POSITION_BIAS_ACTIVE = {
  standing: 2.2, lunge: 2.0, quadruped: 0.8, prone: 1.0, kneeling: 0.7, seated: 1.0, supine: 0.8,
};
const POSITION_BIAS_STILL = {
  standing: 0.35, lunge: 0.6, quadruped: 0.3, prone: 0.9, kneeling: 0.8, seated: 1.7, supine: 1.4,
};
/** Settling is a minute or two, never a proportional slice of a long practice. */
const CENTERING_MAX = 120;

function pick(pool, ctx, phase, used, recentFamilies, rand, allowRepeat = false, state = {}) {
  const scored = pool.map((a) => [a, scoreFor(a, ctx, phase, used, recentFamilies, allowRepeat, state)]).filter(([, s]) => s > 0);
  if (!scored.length) return null;
  const total = scored.reduce((t, [, s]) => t + s, 0);
  let r = rand() * total;
  for (const [a, s] of scored) { r -= s; if (r <= 0) return a; }
  return scored[scored.length - 1][0];
}

// --- ordering a chosen set ---------------------------------------------------
/**
 * PUT A SET OF POSES IN AN ORDER THAT LEADS SOMEWHERE.
 *
 * Greedy nearest-neighbour over transitionScore, seeded either with whatever the
 * practice was doing a moment ago or, at the start of a group, with the gentlest
 * pose in it. Two teaching rules fall out of that one loop:
 *
 *   krama — the gentle-before-deep bias means a group opens at its easiest shape
 *           and climbs, rather than arriving at the deepest backbend cold.
 *   adjacency — every step asks which of the remaining poses this one leads into
 *           best, which is the question the old picker never asked at all.
 *
 * Greedy is the right shape here rather than an optimal tour: a group is five to
 * ten poses, the score is a preference and not a distance, and a teacher writing
 * a sequence works forwards too.
 */
function orderGroup(items, { from = null, descend = false } = {}) {
  if (items.length <= 1) return items.slice();
  // THE COOL-DOWN IS THE TAIL OF THE DESCENT, so it is ordered by where the body
  // is first and by adjacency second. Pure greedy stranded whatever scored worst
  // at the END — which, after a run of supine poses, is the one kneeling shape,
  // so a practice that had finished lying down got up onto its knees to close.
  if (descend) {
    const tiers = [...new Set(items.map((it) => tierOf(it.position)))].sort((a, b) => a - b);
    const out = [];
    let at = from;
    for (const t of tiers) {
      const part = orderGroup(items.filter((it) => tierOf(it.position) === t), { from: at });
      out.push(...part);
      if (part.length) at = byId(part[part.length - 1].asanaId) || at;
    }
    return repairOrder(out, from);
  }
  const pool = items.slice();
  const out = [];
  let prev = from;
  while (pool.length) {
    let bestI = 0, best = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const a = byId(pool[i].asanaId);
      if (!a) continue;
      // THE ONE POSE THAT CANNOT FOLLOW A POSE IS ITSELF. A repeatable shape may
      // come round twice in a practice; it may not come round twice in a row,
      // which is just the same hold with a pause in it. Two chairs and two high
      // lunges landed back to back because an identical pose scores identically
      // and greedy has no reason to prefer either.
      if (prev && a.id === prev.id) continue;
      const krama = 1 / (1 + (a.intensity + (LATE_FAMILIES[a.family] || 0)) * 0.35);
      const link = prev ? transitionScore(prev, a) : 1;
      const s = link * krama;
      if (s > best) { best = s; bestI = i; }
    }
    const [chosen] = pool.splice(bestI, 1);
    out.push(chosen);
    prev = byId(chosen.asanaId) || prev;
  }
  return repairOrder(out, from);
}

/**
 * Greedy can still strand a pose: it places something early that nothing left in
 * the pool follows cleanly. So every remaining fault gets one chance to move
 * somewhere it does not fault, and is dropped if there is nowhere.
 *
 * DROPPING IS THE HONEST OUTCOME, the same call the peak selection already makes
 * when it cannot prepare a pose. A sequence one pose shorter is a practice; a
 * sequence with a transition that grinds a hip is a defect with a timer on it.
 */
function repairOrder(items, from = null) {
  const faults = (list) => {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const prev = i === 0 ? from : byId(list[i - 1].asanaId);
      if (!prev) continue;
      if (transitionFault(prev, byId(list[i].asanaId))) out.push(i);
    }
    return out;
  };
  let list = items.slice();
  let guard = 0;
  while (guard++ < 12) {
    const bad = faults(list);
    if (!bad.length) break;
    const i = bad[0];
    const [item] = list.splice(i, 1);
    // Try every other slot; keep the first that introduces no fault anywhere.
    let placed = false;
    for (let j = 0; j <= list.length && !placed; j++) {
      const trial = list.slice();
      trial.splice(j, 0, item);
      if (!faults(trial).length) { list = trial; placed = true; }
    }
    if (!placed) continue;   // it stays out — nowhere in this group works
  }
  return list;
}

/**
 * THE SEAM BETWEEN TWO PHASES IS WHERE THE LAST FAULTS LIVE.
 *
 * orderGroup repairs adjacency inside a group and structurally cannot see the
 * join between the end of the build and the start of the counter, or between the
 * counter and the cool-down. Each of those joins is a pair like any other, and a
 * pair is exactly what nothing else in the pipeline was looking at.
 *
 * The fix is a drop, not a reorder, because the phases are already in the only
 * order they are allowed to be in. What may never be dropped is anything the arc
 * depends on: a preparation, a counter-pose, the peak, savasana, a linked
 * salutation movement, or half of a flow block.
 */
/**
 * MAKE THE LAST POSE OF A LIST LEAD INTO WHAT COMES NEXT.
 *
 * orderGroup only ever looks backwards — each pose is chosen for the one before
 * it — so the final pose of a group is chosen with no knowledge of what follows
 * the group. That is harmless everywhere except immediately before the peak,
 * where the list is the peak's own preparation and cannot be dropped or
 * reordered freely. Triangle is a declared preparation for revolved triangle and
 * is also the worst possible thing to do immediately before it: same stance,
 * opposite rotation, the whole pose rebuilt underneath you. Both facts are
 * correct; they just have to be resolved in the order rather than in the data.
 */
function endWellBefore(list, next) {
  if (!next || list.length < 2) return list;
  const out = list.slice();
  const last = byId(out[out.length - 1].asanaId);
  if (!last || !transitionFault(last, next)) return out;
  for (let i = out.length - 2; i >= 0; i--) {
    const cand = byId(out[i].asanaId);
    if (!cand || transitionFault(cand, next)) continue;
    const before = i > 0 ? byId(out[i - 1].asanaId) : null;
    if (before && transitionFault(before, last)) continue;   // don't move the fault
    const tmp = out[i];
    out[i] = out[out.length - 1];
    out[out.length - 1] = tmp;
    return out;
  }
  return out;
}

function dropSeamFaults(items) {
  const canGo = (it) => it && !it.prepFor && !it.counterTo && !it.linked && !it.blockId
    && it.phase !== "peak" && it.phase !== "savasana" && it.phase !== "centering";
  let list = items.slice();
  // The same pose twice in a row. orderGroup already forbids it inside a group
  // and faultsIn deliberately ignores it, so the only place it survives is a
  // seam — a downward dog closing the last salutation and another opening the
  // build.
  //
  // ⚠ CONSERVATIVE ON PURPOSE. The first version dropped any adjacent duplicate
  // and broke two things at once: a restorative warm-up whose only pose repeated
  // the centering shape was emptied, which is a broken arc, and peak.prepared
  // counts a declared preparation per ITEM, so removing a copy dropped a peak
  // below its minimum. Neither is worth a cosmetic repeat.
  const phaseCount = {};
  for (const it of list) phaseCount[it.phase] = (phaseCount[it.phase] || 0) + 1;
  for (let i = list.length - 1; i > 0; i--) {
    const cur = list[i], prev = list[i - 1];
    if (cur.asanaId !== prev.asanaId) continue;
    if (cur.linked || prev.linked || cur.blockId) continue;
    if (cur.prepFor || cur.counterTo) continue;
    if (cur.phase === "peak" || cur.phase === "savasana") continue;
    if ((phaseCount[cur.phase] || 0) <= 1) continue;
    list.splice(i, 1);
    phaseCount[cur.phase] -= 1;
  }
  let guard = 0;
  while (guard++ < 12) {
    const f = faultsIn(list)[0];
    if (!f) break;
    if (canGo(list[f.index])) { list.splice(f.index, 1); continue; }
    if (canGo(list[f.index - 1])) { list.splice(f.index - 1, 1); continue; }
    break;      // both ends are load-bearing; quality.js will report it
  }
  return list;
}

// --- flow blocks -------------------------------------------------------------
/**
 * THE SHORT SEQUENCE A CLASS RUNS ON ONE SIDE, THEN THE OTHER.
 *
 * This is how a standing series is actually taught and it is not what the
 * generator was doing. A class does low lunge, warrior II, triangle down the
 * RIGHT side, comes back through, and repeats the whole thing on the LEFT. The
 * old model ran each pose left-and-right in place and then moved on, so twenty
 * minutes of standing work needed twenty-eight DIFFERENT poses — which is why a
 * 45-minute flow read like a tour of the catalogue and kept running out of
 * library before it ran out of time.
 *
 * A block is emitted as one-sided items carrying an explicit `side`; the routine
 * player already draws that, so nothing about the block is special once it is
 * built. `blockId` and `blockRound` are for the review screen and for quality.js
 * to check that both sides ran.
 */
function flowBlockItems(poses, ctx, { blockId, round = 1, rounds = 1 }) {
  const out = [];
  for (const side of ["Right", "Left"]) {
    for (const a of poses) {
      const it = makeItem(a, ctx, { phase: "build", t: 0.5 });
      // A symmetric pose inside a block runs on both passes, unlabelled — chair
      // between two warriors is chair both times round.
      it.side = a.bilateral ? side : null;
      it.bilateral = false;
      it.blockId = blockId;
      it.blockRound = round;
      it.blockRounds = rounds;
      it.blockSide = side;
      out.push(it);
    }
  }
  return out;
}

/**
 * COMPOSE THE BLOCK AS A CHAIN, not as a selection that gets sorted afterwards.
 *
 * Ordinary phase filling asks "which poses belong in this practice" and then
 * puts the answer in a sensible order. That is the wrong question for a block: a
 * block is defined by carrying from each shape into the next, so every step has
 * to be chosen FOR the step before it. Choosing three good standing poses and
 * ordering them gave reverse warrior, revolved lunge, pyramid — open-hip,
 * square-hip, square-hip, re-setting the feet twice inside a sequence whose
 * whole purpose is not to.
 *
 * It starts on a lunge where it can, because that is where a standing series
 * begins, and it stops as soon as nothing left is better than an unremarkable
 * transition. A two-pose block is a real block; a padded four-pose one is not.
 */
function chooseBlock(candidates, want, rand) {
  if (candidates.length < 2) return [];
  const starts = candidates.filter((a) => a.position === "lunge");
  const from = starts.length
    ? starts[Math.floor(rand() * starts.length)]
    : candidates[Math.floor(rand() * candidates.length)];
  const chain = [from];
  const left = candidates.filter((a) => a.id !== from.id);
  while (chain.length < want && left.length) {
    const prev = chain[chain.length - 1];
    let best = null, bestScore = 1;
    for (const a of left) {
      const s = transitionScore(prev, a);
      if (s > bestScore) { bestScore = s; best = a; }
    }
    if (!best) break;
    chain.push(best);
    left.splice(left.indexOf(best), 1);
  }
  // ⚠ THE BLOCK HAS TO LOOP. It runs down the right side and then starts again
  // on the left, so its LAST pose is adjacent to its FIRST — a seam that exists
  // nowhere in the chain the greedy walk just checked. A block of side angle
  // into triangle is textbook forwards and, at the turn, asks you to re-bend a
  // straightened front leg into a deep lunge. Shorten the chain until the loop
  // closes; two poses run cleanly both ways is a better block than three that
  // grind at the changeover.
  while (chain.length > 2 && transitionFault(chain[chain.length - 1], chain[0])) chain.pop();
  if (chain.length === 2 && transitionFault(chain[1], chain[0])) return [];
  return chain.length >= 2 ? chain : [];
}

/** Poses per block. Three is a sequence you can remember; six is a class. */
const BLOCK_POSES = [3, 4];
/** Below this much time in the tier, a block cannot pay for itself. */
const BLOCK_MIN_SECONDS = 240;

/**
 * Build time a body position has to be worth before the practice goes there.
 * Roughly three poses: below that you arrive, do one thing and leave, which
 * costs two position changes to place a single pose.
 */
const SECONDS_PER_TIER = 165;

/**
 * WHERE A COOL-DOWN HAPPENS. The end of a practice is the bottom of the descent
 * — the standing releases belong to the counter phase, which runs first. Left
 * unconstrained the cool-down picked freely across every position and undid the
 * descent in the last four poses.
 */
const COOL_POSITIONS = ["prone", "kneeling", "seated", "supine"];

// --- fitting a built sequence to the requested length ------------------------
const BODY_PHASES = ["centering", "warmup", "build", "peak", "counter", "cool"];
/** How far the holds may be stretched or squeezed before poses come out instead. */
const SCALE_BOUNDS = [0.55, 1.45];
/** No hold drops below this, whatever the arithmetic wants. */
const MIN_HOLD_SECONDS = 15;

function fitToTarget(sections, peak, ctx, savShare) {
  const body = () => BODY_PHASES.reduce((s, p) => s + flowSeconds(sections[p] || []), 0);
  const bodyTarget = Math.max(60, ctx.targetSeconds * (1 - savShare));

  // 1. trim — a phase may lose its last-added pose, never its only one, and
  // NEVER a pose that is there because the peak depends on it.
  //
  // The first version popped the tail of the fullest phase, and the peak's
  // preparation is appended to the tail of the build — so trimming for time
  // silently dismantled the preparation for the hardest pose in the sequence.
  // That is the precise failure the arc model exists to prevent, arriving through
  // the back door of an unrelated optimisation.
  const removable = (p) => {
    const list = sections[p] || [];
    if (list.length <= 1) return -1;
    for (let i = list.length - 1; i >= 0; i--)
      if (!list[i].prepFor && !list[i].counterTo && !list[i].linked) return i;
    return -1;
  };
  const trimmable = () => BODY_PHASES
    .filter((p) => p !== "peak" && removable(p) >= 0)
    .sort((a, b) => sections[b].length - sections[a].length)[0] || null;
  let guard = 0;
  while (body() > bodyTarget * (1 + DURATION_FIT_TOLERANCE) && guard++ < 60) {
    const p = trimmable();
    if (!p) break;
    sections[p].splice(removable(p), 1);
  }
  // A linked salutation can still come off, but only whole rounds of it.
  guard = 0;
  while (body() > bodyTarget * (1 + DURATION_FIT_TOLERANCE) && guard++ < 12) {
    const warm = sections.warmup || [];
    const rounds = warm.filter((it) => it.round).map((it) => it.round);
    const last = rounds.length ? Math.max(...rounds) : 0;
    if (last <= 1) break;                       // one round of salutations stays
    sections.warmup = warm.filter((it) => it.round !== last);
  }

  // 2. scale what remains. Linked movements are exempt: one breath, one movement
  // is the definition of the thing, so it cannot be held longer to fill time.
  const cur = body();
  if (!cur) return;
  const f = Math.max(SCALE_BOUNDS[0], Math.min(SCALE_BOUNDS[1], bodyTarget / cur));
  if (Math.abs(f - 1) < 0.03) return;
  // ⚠ THE SCALE PASS HAS TO RESPECT THE SAME CEILING makeItem DOES. It did not,
  // so an item capped at 22% of the practice was scaled straight back through
  // the cap by up to 45% — which is how a yin session that had just been told
  // dragon could have 198 seconds a side ended up giving it 210.
  const capFor = (it) => (ctx.targetSeconds
    ? (ctx.targetSeconds * MAX_ITEM_SHARE) / (it.bilateral ? 2 : 1) : Infinity);
  for (const p of BODY_PHASES) for (const it of sections[p] || []) {
    if (it.linked) continue;
    it.durationSeconds = Math.min(capFor(it),
      Math.max(MIN_HOLD_SECONDS, Math.round((it.durationSeconds * f) / 5) * 5));
    if (it.holdBreaths != null && ctx.breathSeconds)
      it.holdBreaths = Math.max(1, Math.round(it.durationSeconds / ctx.breathSeconds));
  }
}

/** The drift the fitting pass works to. quality.js allows a little more. */
const DURATION_FIT_TOLERANCE = 0.08;

// --- the generator -----------------------------------------------------------
/**
 * Compose a sequence.
 *
 * @param {object} o
 * @param {string} o.intent      intent id (what the practice is FOR)
 * @param {number} o.minutes     target length
 * @param {string[]} o.limits    LIMITATION keys the practitioner is protecting
 * @param {string} [o.style]     override the intent's style
 * @param {number} [o.level]     1 accessible · 2 intermediate · 3 advanced
 * @param {number} [o.breathSeconds]
 * @param {number} [o.seed]
 */
export function generateFlow({ intent: intentId, minutes, limits = [], style: styleOverride = null,
  level = "advanced", breathSeconds = BREATH_SECONDS_DEFAULT, seed = 1 } = {}) {
  const intent = intentById(intentId);
  if (!intent) throw new Error(`unknown intent "${intentId}"`);
  const style = styleById(styleOverride || intent.style);
  if (!style) throw new Error(`unknown style "${styleOverride || intent.style}"`);

  // A fixed series is fixed by definition — nothing here composes it.
  // A named level ("beginner"), with the numeric pose ceiling derived from it.
  // The first version passed a bare 1/2/3 around, which meant the number had to
  // mean the same thing to the pose filter, the substitution chain and the
  // narration — three things that want to diverge.
  const levelId = normaliseLevel(level);
  const L = levelById(levelId);
  const ceiling = poseCeiling(levelId);
  if (style.authored) return primarySeries({ limits, level: levelId, breathSeconds, minutes });

  const rand = rng(seed);
  const targetSeconds = Math.round(minutes * 60);
  const savShare = (style.savasanaShare[0] + style.savasanaShare[1]) / 2;
  const ctx = { intent, style, limits, level: ceiling, levelId, L, breathSeconds, targetSeconds, savasanaSeconds: 0 };

  // What the limitations cost, recorded so the app can name it rather than
  // quietly shipping a shorter library.
  const excluded = ASANAS
    .filter((a) => isContraindicated(a, limits))
    .map((a) => ({ id: a.id, name: a.name, sites: limitsHit(a, limits) }));
  const pool = ASANAS.filter((a) => !isContraindicated(a, limits) && a.level <= ceiling);
  const reachableFamilies = new Set(pool
    .filter((a) => emphasisFor(intent, a.family) > 0
      && a.intensity >= style.intensityBand[0] && a.intensity <= style.intensityBand[1]
      && a.phases.some((ph) => ph !== "series"))
    .map((a) => a.family));

  // --- peak selection, before anything else, because it dictates the build ---
  //
  // IF WE CANNOT PREPARE IT, WE DO NOT CLIMB IT. A peak is only a candidate when
  // enough of its OWN preparatory poses survive this body's limitations and level
  // — otherwise a knee or a shoulder quietly strips the preparation and the flow
  // arrives at a hard pose cold. Dropping the peak is the honest outcome: the
  // sequence becomes a good flat practice instead of a bad peaked one.
  let peak = null;
  const resolvablePreps = (a) => {
    const seen = new Set();
    for (const id of a.preps) {
      const got = resolvePose(id, { limits, level: ceiling });
      if (got && got.id !== a.id) seen.add(got.id);
    }
    return seen.size;
  };
  const wantsPeak = style.allowPeak && intent.peaks.length && targetSeconds >= 20 * 60;
  let peakRejected = [];
  if (wantsPeak) {
    const resolved = intent.peaks
      .map((id) => resolvePose(id, { limits, level: ceiling }))
      .filter((a) => a && a.peak > 0 && a.phases.includes("peak"));
    const candidates = resolved.filter((a) => {
      const need = PREP_MIN[a.peak] || 3;
      const have = resolvablePreps(a);
      if (have < need) { peakRejected.push({ id: a.id, name: a.name, have, need }); return false; }
      return true;
    });
    if (candidates.length) peak = candidates[Math.floor(rand() * candidates.length)];
  }

  const shortLongHold = !peak && !!style.holdSeconds && targetSeconds < 20 * 60;
  const plan = peak ? PLAN_PEAKED : (shortLongHold ? PLAN_SHORT : PLAN_FLAT);
  const used = new Set();
  const sections = {};
  let recentFamilies = [];
  // What the practice has done lately, so the picker does not re-offer it.
  // Threaded through phases rather than reset per phase.
  const seq = { recentIds: [], counts: {} };
  const noteChoice = (a) => {
    seq.counts[a.id] = (seq.counts[a.id] || 0) + 1;
    seq.recentIds.push(a.id);
    if (seq.recentIds.length > 8) seq.recentIds.shift();
  };
  /** The pose the practice is standing in right now — what the next one follows. */
  const lastOf = (...lists) => {
    for (let i = lists.length - 1; i >= 0; i--) {
      const l = lists[i];
      if (l && l.length) return byId(l[l.length - 1].asanaId);
    }
    return null;
  };

  /**
   * Choose poses for a phase until its time is spent, then put them in order.
   *
   * Returns the items rather than assigning them, because the build calls it
   * once per body position and needs to keep the results apart. The old version
   * wrote straight into `sections[phase]` and the caller read the section back
   * between two calls to recover the first batch — which worked, and would have
   * stopped working the moment a third call was added.
   */
  const fillPhase = (phase, budget, opts = {}) => {
    const items = [];
    let spent = 0;
    let guard = 0;
    let prev = opts.from || null;
    // Two passes. The first refuses to repeat a pose at all; the second allows it
    // at a heavy penalty, and only runs if the first ran out of poses before it
    // ran out of time. Without it a 60-minute vinyasa finished at 49 minutes,
    // because the eligible pool for one phase is simply smaller than an hour.
    for (const allowRepeat of [false, true]) {
      while (spent < budget * 0.92 && guard++ < 60) {
        const eligible = pool.filter((x) =>
          (!opts.positions || opts.positions.includes(x.position))
          && (!opts.filter || opts.filter(x)));
        const a = pick(eligible, ctx, phase, used, recentFamilies, rand, allowRepeat,
          { recentIds: seq.recentIds, counts: seq.counts, prev });
        if (!a) break;
        const t = opts.t == null ? rand() : opts.t;
        const it = makeItem(a, ctx, { phase, t });
        const cost = itemSeconds(it);
        // Don't blow the budget by more than half an item to place one more pose.
        //
        // ⚠ THE "ALWAYS PLACE AT LEAST ONE" ALLOWANCE IS FOR PHASES, NOT TIERS.
        // A phase with nothing in it is a broken arc, so the first pose goes in
        // whatever it costs. A body position with almost no time allotted is not
        // a broken anything — it is the sequence saying this practice does not
        // go there. Applied to tiers the allowance put a seven-minute dragon
        // lunge into a yin practice that had budgeted twenty-eight seconds for
        // standing, and the whole wind-down read supine, then lunging, then
        // kneeling: the exact bounce the descent exists to remove.
        if (spent + cost > budget * 1.12 && (items.length || opts.strict)) { spent = budget; break; }
        items.push(it);
        if (opts.limit && items.length >= opts.limit) { spent = budget; }
        used.add(a.id);
        recentFamilies.push(a.family);
        noteChoice(a);
        prev = a;
        spent += cost;
      }
      if (spent >= budget * 0.92) break;
    }
    return orderGroup(items, { from: opts.from || null, descend: !!opts.descend });
  };

  const budgetFor = (phase) => (plan.find(([p]) => p === phase) || [null, 0])[1] * targetSeconds;

  // 1. centering — always exactly one thing, so the practice starts by settling
  const centeringPose = resolvePose(style.id === "restorative" ? "balasana_open" : "centering", { limits, level: ceiling })
    || resolvePose("savasana", { limits, level: ceiling });
  sections.centering = centeringPose
    ? [makeItem(centeringPose, ctx, { phase: "centering", breaths: null, t: 0.5 })]
    : [];
  if (centeringPose) { used.add(centeringPose.id); }
  // The centering item is time-boxed to its share rather than to its own hold,
  // and CAPPED: settling is one to two minutes in any practice. A proportional
  // share of a 45-minute flow put two and a half minutes of sitting still in
  // front of a strong vinyasa, which is where people close the app.
  if (sections.centering.length) {
    sections.centering[0].durationSeconds =
      Math.min(CENTERING_MAX, Math.max(30, Math.round(budgetFor("centering"))));
    sections.centering[0].holdBreaths = null;
    sections.centering[0].transitionSeconds = 0;
  }

  // 2. warm-up — sun salutations where the style flows, discrete poses otherwise
  if (shortLongHold) { sections.warmup = []; }
  else if (style.flowLinked && minutes >= 15) {
    const budget = budgetFor("warmup");
    const items = [];
    let spent = 0;
    // Cat/cow first: the spine wants to move before it holds anything.
    // No explicit breath count: cat/cow carries its own as DYNAMIC movement, and
    // if a wrist sends it down the substitution chain to a seated shape, that
    // shape gets the style's ordinary hold rather than cat/cow's eight breaths.
    const opener = resolvePose("cat_cow", { limits, level: ceiling });
    if (opener) { const it = makeItem(opener, ctx, { phase: "warmup" }); items.push(it); spent += itemSeconds(it); used.add(opener.id); }
    let rounds = 0;
    while (spent < budget * 0.85 && rounds < 5) {
      const variant = rounds < 2 || minutes < 30 ? "A" : "B";
      const set = salutationItems(variant === "A" ? SURYA_A : SURYA_B, ctx,
        { holdLast: rounds === 0 ? 5 : 3, variant, round: rounds + 1, rounds: 5 });
      const cost = flowSeconds(set);
      if (spent + cost > budget * 1.15 && items.length > 1) break;
      items.push(...set);
      set.forEach((it) => used.add(it.asanaId));
      spent += cost;
      rounds++;
    }
    sections.warmup = items;
    recentFamilies.push("standing");
  } else {
    sections.warmup = fillPhase("warmup", budgetFor("warmup"),
      { t: 0.35, from: lastOf(sections.centering) });
  }

  // 3. build — general work, then the peak's OWN preparation, in order
  const buildBudget = budgetFor("build");
  let prepItems = [];
  if (peak) {
    const want = style.prepCount[peak.peak] || 4;
    const preps = peak.preps
      .map((id) => resolvePose(id, { limits, level: ceiling }))
      .filter(Boolean)
      .filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i)
      .slice(0, want);
    prepItems = preps.map((a) => makeItem(a, ctx, { phase: "build", t: 0.5 }));
    prepItems.forEach((it) => { it.prepFor = peak.id; used.add(it.asanaId); });
    preps.forEach(noteChoice);
  }
  const prepCost = flowSeconds(prepItems);
  const usable = Math.max(0, buildBudget - prepCost);

  // ⚠ THE BUILD IS A DESCENT THROUGH BODY POSITIONS, AND IT STOPS AT THE PEAK.
  //
  // The previous model split the build into a standing half and a floor half and
  // decided which came FIRST from the peak's plane — so a standing peak put the
  // floor block first, and a 45-minute flow spent twelve minutes on deep floor
  // work before standing up for sixteen minutes of warriors. That is the reverse
  // of every class ever taught, and it was a deliberate choice: the code wanted
  // the peak's own plane adjacent to the peak, and got there by inverting the
  // sequence around it.
  //
  // The real rule is simpler. The descent runs one way — standing, lunging, onto
  // the hands, the belly, the knees, sitting, lying down — and the build simply
  // STOPS at the position the peak is in. A standing peak means the practice
  // never leaves its feet before it and the floor work becomes the cool-down
  // that follows; a floor peak means the practice descends the whole way and the
  // peak sits at the bottom. Nothing is reordered, so nothing is inverted.
  //
  // "floor" was too coarse to do this with: it covers lying on your front, lying
  // on your back, sitting up and being on your hands, which is why a single
  // floor block came out as plank, seated twist, sphinx, cow-face legs,
  // chaturanga — four positions, no order.
  // With no peak the build descends as far as SEATED, not all the way down. The
  // bottom of the descent belongs to the cool-down, and a build that had already
  // reached supine left the cool-down nowhere to go but back up — which is how a
  // practice ended seated, supine, and then prone again.
  const peakTier = peak ? tierOf(peak.position) : POSITION_TIERS.length - 2;
  let groups = POSITION_TIERS.slice(0, Math.max(0, peakTier) + 1);

  // ⚠ A PRACTICE ONLY GOES SOMEWHERE IF IT CAN STAY THERE.
  //
  // Visiting every tier is right for an hour and absurd for ten minutes: a
  // 10-minute wake-up given all six tiers placed one pose in each, so the body
  // changed position on nearly every pose and the sequence was the random walk
  // again — arrived at, this time, by a rule meant to prevent it. The descent is
  // an order, not a quota. Where the time only buys a couple of stations, take
  // the couple the style cares most about and stay in them.
  // Where the practice spends its build time. Weighted by what the style is FOR
  // — a vinyasa lives on its feet, a long-hold style on the floor — and by how
  // much of the library is actually reachable there, damped so a tier with twice
  // the poses gets more time but not twice as much.
  const bias = style.flowLinked || !style.holdSeconds ? POSITION_BIAS_ACTIVE : POSITION_BIAS_STILL;
  const reachable = (positions) => pool.filter((a) => positions.includes(a.position)
    && scoreFor(a, ctx, "build", new Set(), [], false, {}) > 0).length;
  const biasOf = (positions) =>
    positions.reduce((s, p) => s + (bias[p] || 1), 0) / positions.length;
  const tierWeight = (g) => biasOf(g) * Math.sqrt(reachable(g));

  if (groups.length > 1) {
    const room = Math.max(1, Math.min(groups.length, Math.round(usable / SECONDS_PER_TIER)));
    if (room < groups.length) {
      groups = groups
        .map((g, idx) => ({ g, idx, w: tierWeight(g) }))
        .sort((a, b) => b.w - a.w)
        .slice(0, room)
        .sort((a, b) => a.idx - b.idx)       // back into descent order
        .map((r) => r.g);
    }
  }
  const weights = groups.map(tierWeight);
  const weightSum = weights.reduce((s, w) => s + w, 0);

  // ⚠ THE PREPARATION JOINS THE BLOCK OF ITS OWN POSITION, NOT THE TAIL.
  // Appending the whole prep list after the build undid the descent it had just
  // made: preps are chosen for what they open, not for where they happen, so a
  // standing prep for a floor peak landed alone between two floor poses. Within
  // a group the preps go last, so the practice arrives at the peak having just
  // done the closest thing to it, and every prep is still before the peak —
  // which is the only ordering constraint here that carries meaning.
  const built = [];
  for (let i = 0; i < groups.length; i++) {
    const positions = groups[i];
    const share = weightSum > 0 ? weights[i] / weightSum : 0;
    const groupPreps = prepItems.filter((it) => positions.includes(it.position));
    const budget = usable * share;
    const chosen = [];
    // THE STANDING SERIES RUNS AS A BLOCK, in a style that flows. Only the feet
    // tier: a block is a sequence you carry from one shape into the next without
    // resetting, which is what standing and lunging are and what lying on the
    // floor for four minutes at a time is not.
    if (share > 0 && style.flowLinked && i === 0 && budget >= BLOCK_MIN_SECONDS) {
      const want = BLOCK_POSES[Math.floor(rand() * BLOCK_POSES.length)];
      // ⚠ ONLY ASYMMETRIC POSES BELONG IN A BLOCK. A block exists to be run down
      // one side and then the other, so a symmetric shape inside one is simply
      // performed again identically — an early version put big toe pose in a
      // block and the practice did the same fold four times in a row.
      const candidates = pool.filter((a) => positions.includes(a.position) && a.bilateral
        && scoreFor(a, ctx, "build", used, recentFamilies, false, { counts: seq.counts }) > 0);
      const poses = chooseBlock(candidates, want, rand);
      if (poses.length >= 2) {
        // ONE ROUND IS ALREADY BOTH SIDES. Running the block twice back to back
        // is four passes of the same three poses, which is not what a class that
        // repeats a sequence does — it comes back to it later, after other work.
        poses.forEach((a) => { used.add(a.id); recentFamilies.push(a.family); noteChoice(a); });
        chosen.push(...flowBlockItems(poses, ctx, { blockId: `blk${i}` }));
      }
    }
    const singlesBudget = budget - flowSeconds(chosen);
    if (singlesBudget > 0)
      chosen.push(...fillPhase("build", singlesBudget,
        { positions, from: lastOf(sections.warmup, built, chosen), strict: true }));
    built.push(...chosen, ...orderGroup(groupPreps, { from: lastOf(built, chosen) }));
  }
  // A prep whose position the build never reaches still has to happen — it is
  // the reason the peak is reachable at all.
  // A prep whose position the build never reaches goes at the FRONT, not the
  // back. It still has to happen — it is the reason the peak is reachable — but
  // it belongs on the floor the practice has not stood up from yet. Appended at
  // the end it landed immediately before the peak: a wrist limitation sends
  // downward dog up the substitution chain to seated centering, so a flow
  // building to warrior III sat down on the mat and then stood up into it.
  const placed = new Set(built.map((it) => it.asanaId));
  const strays = prepItems.filter((it) => !placed.has(it.asanaId));
  sections.build = endWellBefore([...orderGroup(strays, { descend: true }), ...built], peak);

  // 4. peak
  sections.peak = peak ? [makeItem(peak, ctx, { phase: "peak", t: 1 })] : [];
  if (peak) { used.add(peak.id); noteChoice(peak); }

  // 5. counter — the peak's own counters first, then the family fallback.
  // This is the half of the arc that gets forgotten, and forgetting it is how a
  // deep backbend becomes a sore back an hour later.
  if (peak) {
    const counters = (peak.counters.length ? peak.counters : (COUNTER_FAMILY[peak.family] || [])
      .flatMap((f) => pool.filter((a) => a.family === f && a.phases.includes("counter")).slice(0, 1).map((a) => a.id)))
      .map((id) => resolvePose(id, { limits, level: ceiling }))
      .filter(Boolean)
      .filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i);
    // ⚠ YOU DO NOT STAND BACK UP TO COUNTER SOMETHING. A counter-pose is declared
    // for what it undoes, not for where it happens, so crow — which you are on
    // your hands for — listed a standing forward fold among its counters, and the
    // practice climbed all the way back to its feet and straight down again in
    // the four poses after the peak. Counters at or below the peak's own tier
    // only; if that leaves nothing, the counter matters more than the descent and
    // the whole list stands.
    const peakTierIdx = tierOf(peak.position);
    const belowPeak = counters.filter((a) => tierOf(a.position) >= peakTierIdx);
    const counterPool = belowPeak.length ? belowPeak : counters;
    const items = [];
    let spent = 0;
    const budget = budgetFor("counter");
    for (const a of counterPool) {
      const it = makeItem(a, ctx, { phase: "counter", t: 0.5 });
      it.counterTo = peak.id;
      items.push(it);
      used.add(a.id);
      noteChoice(a);
      spent += itemSeconds(it);
      if (spent >= budget * 0.8 && items.length >= 1) break;
    }
    sections.counter = orderGroup(items, { from: peak });
  } else sections.counter = [];

  // 6. cool-down — and it follows on from whatever the practice was just doing,
  // which after a standing peak means this is where the descent to the floor
  // finally happens.
  // The cool-down carries on DOWN from wherever the practice has got to. Fixed
  // to the same four positions regardless, it would start at prone after a build
  // that had already reached the floor and lain down — a climb, in the phase
  // whose whole job is the last of the descent.
  const at = lastOf(sections.build, sections.peak, sections.counter);
  const fromTier = at ? tierOf(at.position) : 0;
  const coolPositions = COOL_POSITIONS.filter((p) => tierOf(p) >= fromTier);
  sections.cool = fillPhase("cool", budgetFor("cool"),
    { t: 0.7, descend: true, from: at,
      positions: coolPositions.length ? coolPositions : COOL_POSITIONS });

  // 6b. fit the body of the practice to the length that was asked for.
  //
  // Every phase places at least one pose regardless of budget, because a phase
  // with nothing in it is a broken arc. In a long-hold style that floor is the
  // whole problem: five phases each forcing one restorative pose is already 37
  // minutes, whatever was requested. So the practice is trimmed and then scaled.
  //
  // Trim first, scale second, and in that order — shortening ten poses to fit a
  // ten-minute practice gives ten rushed poses, whereas dropping to four and
  // holding those properly gives a ten-minute practice. Poses come off the
  // fullest phase, never the peak, never a phase down to its last pose, and never
  // a linked sun salutation (half a salutation is not a salutation).
  fitToTarget(sections, peak, ctx, savShare);

  // 7. savasana — a PROPORTION of the session, never a fixed five minutes, and
  // computed from the practice that was actually BUILT rather than the one that
  // was requested. Deriving it from the target was wrong in both directions: a
  // sequence that overran got a savasana worth 5% of it, and one that came in
  // short got an unearned lie-down.
  const bodySeconds = ["centering", "warmup", "build", "peak", "counter", "cool"]
    .reduce((s, p) => s + flowSeconds(sections[p] || []), 0);
  const savasanaSeconds = Math.max(60,
    Math.round((bodySeconds * (savShare / (1 - savShare))) / 15) * 15);
  ctx.savasanaSeconds = savasanaSeconds;
  const sav = resolvePose("savasana", { limits, level: ceiling });
  sections.savasana = sav ? [makeItem(sav, ctx, { phase: "savasana" })] : [];

  const order = peak
    ? ["centering", "warmup", "build", "peak", "counter", "cool", "savasana"]
    : ["centering", "warmup", "build", "cool", "savasana"];
  const items = dropSeamFaults(order.flatMap((p) => sections[p] || []));
  items.forEach((it, i) => { it.id = `${it.asanaId}-${i}`; });

  const totalSeconds = flowSeconds(items);
  return {
    intent: intent.id,
    intentLabel: intent.label,
    style: style.id,
    styleName: style.name,
    styleFamily: style.family,
    minutes,
    targetSeconds,
    totalSeconds,
    breathSeconds,
    level: levelId,
    poseCeiling: ceiling,
    limits: [...limits],
    seed,
    peak: peak ? peak.id : null,
    peakRejected,
    peakName: peak ? peak.name : null,
    savasanaSeconds,
    items,
    sections,
    excluded,
    // What the practice could REACH, not what its emphasis map permits. Counting
    // permitted families overstated it badly: a bedtime practice excludes three
    // families outright, but the restorative intensity band excludes most of the
    // rest, so "9 available" was a number nothing could have hit.
    familiesAllowed: reachableFamilies.size,
    accounting: accountingFor(intent),
    note: intent.note || "",
    authored: false,
  };
}

/**
 * Convert a flow into the routine engine's definition shape.
 *
 * The engine already handles timed items, bilateral Left/Right and per-item cues;
 * what is new is `holdBreaths` (so a hold can be COUNTED rather than just timed)
 * and per-item transitions (a linked vinyasa movement has none).
 */
export function toRoutineDef(flow) {
  return {
    rounds: 1,
    transitionSeconds: null,          // per-item; the engine falls back to this when null
    breathSeconds: flow.breathSeconds,
    items: flow.items.map((it) => ({
      id: it.asanaId,
      itemId: it.id,
      name: it.name,
      sanskrit: it.sanskrit,
      mode: "timed",
      durationSeconds: it.durationSeconds,
      transitionSeconds: it.transitionSeconds,
      bilateral: it.bilateral,
      // ⚠ A ONE-SIDED ITEM HAS TO CARRY ITS SIDE ACROSS. The player reads `side`
      // off the routine item, not off the flow, so leaving it behind here meant
      // a flow block composed correctly, ran correctly, and told you nothing —
      // warrior II twice with no idea which leg. The generator was right and the
      // hand-off dropped it, which no unit test on either side would have caught.
      side: it.side || null,
      blockId: it.blockId || null,
      cue: it.cue,
      easier: it.easier,
      holdBreaths: it.holdBreaths,
      // The player's cue vocabulary, chosen explicitly rather than inferred from
      // the name — the warm-up engine's isStretch() regex matches on words like
      // "hamstring" and would never match an asana.
      cueKind: it.phase === "savasana" ? "rest" : (it.linked ? "flow" : "hold"),
      breathPaced: !!flow.breathSeconds && !it.linked && it.holdBreaths != null,
      phase: it.phase,
      // [own photo, shared photo / drawn figure] — see illustrations.js. The art
      // key has to stay LAST: it is the only one the drawn figures are keyed by.
      illustrationId: [it.asanaId, it.art],
    })),
  };
}
