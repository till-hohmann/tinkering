// yoga/transitions.js — whether one pose can sensibly follow another. Pure.
//
// THE PRINCIPLE THIS MODULE ENCODES, and it is the exact opposite of what the
// picker used to do:
//
//   "one pose should lead students into the next pose by means of its SIMILARITY
//    with the next position, as opposed to opposition."
//
// The old scorer multiplied a pose's chances by 0.35 for every recent pose of
// its own family, i.e. it actively optimised for contrast between neighbours.
// Family variety is a property a whole PRACTICE should have; adjacency wants the
// reverse. Both are true at once and they were being served by one number.
//
// So there are two layers here:
//
//   transitionFault()  the hard rules. A fault is a pair no sequence should
//                      contain, and quality.js grades it as an error.
//   transitionScore()  the soft preference the picker multiplies by, so a good
//                      neighbour is chosen far more often than a tolerable one
//                      without any pair being forbidden outright.
//
// Hard rules are deliberately few. A ban is a promise that the generator can
// always find something else, and the builder audit's lesson was that a check
// firing on correct output trains everyone to ignore it.

import { byId } from "./asanas.js";
import { POSITION_ORDER, positionDistance, tierOf } from "./positions.js";

export { POSITION_ORDER, positionDistance };

const key = (a, b) => `${a}>${b}`;

/**
 * PAIRS A TEACHER ACTUALLY STRINGS TOGETHER. A bonus, not a whitelist: the rules
 * below already produce sensible sequences, and this is where the ones worth
 * naming get their thumb on the scale — the vinyasa itself, the standing series
 * every class runs, the prone backbend ladder, the seated fold ladder.
 *
 * Both directions are NOT implied. Warrior II into triangle is the standard
 * transition; triangle into warrior II asks you to re-bend a straightened leg.
 */
export const LINKS = new Set([
  // the vinyasa
  key("adho_mukha", "phalakasana"), key("phalakasana", "chaturanga"),
  key("chaturanga", "urdhva_mukha"), key("urdhva_mukha", "adho_mukha"),
  key("phalakasana", "ashtanga_namaskara"), key("ashtanga_namaskara", "bhujangasana"),
  key("uttanasana", "ardha_uttanasana"), key("ardha_uttanasana", "chaturanga"),
  key("tadasana", "urdhva_hastasana"), key("urdhva_hastasana", "uttanasana"),
  key("utkatasana", "uttanasana"), key("adho_mukha", "anjaneyasana"),
  key("adho_mukha", "high_lunge"),
  // the standing series — open-hip family, in the order it is taught
  key("virabhadrasana_2", "utthita_parsvakonasana"),
  key("virabhadrasana_2", "utthita_trikonasana"),
  key("virabhadrasana_2", "viparita_virabhadrasana"),
  key("viparita_virabhadrasana", "utthita_parsvakonasana"),
  key("utthita_parsvakonasana", "utthita_trikonasana"),
  key("utthita_trikonasana", "ardha_chandrasana"),
  key("utkata_konasana", "virabhadrasana_2"),
  key("prasarita_a", "prasarita_c"),
  // square-hip family
  key("anjaneyasana", "virabhadrasana_1"), key("high_lunge", "virabhadrasana_1"),
  key("high_lunge", "virabhadrasana_3"), key("high_lunge", "parivrtta_anjaneyasana"),
  key("anjaneyasana", "parivrtta_anjaneyasana"),
  key("virabhadrasana_1", "parsvottanasana"),
  key("parsvottanasana", "parivrtta_trikonasana"),
  key("parivrtta_anjaneyasana", "parivrtta_parsvakonasana"),
  key("tadasana", "vrksasana"), key("vrksasana", "garudasana"),
  key("utkatasana", "parivrtta_utkatasana"),
  // prone backbends, gentlest first, released into child's pose
  key("salamba_bhujangasana", "bhujangasana"), key("bhujangasana", "salabhasana"),
  key("salabhasana", "dhanurasana"), key("dhanurasana", "balasana_open"),
  key("salabhasana", "balasana_open"), key("bhujangasana", "balasana_open"),
  key("anahatasana", "ustrasana"), key("ustrasana", "balasana_open"),
  key("balasana_open", "adho_mukha"), key("cat_cow", "adho_mukha"),
  key("cat_cow", "thread_needle"), key("thread_needle", "balasana_open"),
  // seated: hips, folds, then twists — the shape of every cool-down
  key("dandasana", "paschimottanasana"), key("janu_sirsasana", "paschimottanasana"),
  key("baddha_konasana", "upavistha_konasana"), key("upavistha_konasana", "baddha_konasana"),
  key("baddha_konasana", "janu_sirsasana"), key("shoelace", "sleeping_swan"),
  key("paschimottanasana", "ardha_matsyendrasana"),
  key("navasana", "paschimottanasana"),
  key("eka_pada_rajakapotasana", "balasana_open"),
  // supine: the last few minutes
  key("setu_bandha", "supta_matsyendrasana"), key("supta_matsyendrasana", "savasana"),
  key("ananda_balasana", "supta_matsyendrasana"),
  key("supta_padangusthasana", "sucirandhrasana"),
  key("viparita_karani", "savasana"), key("supported_fish", "savasana"),
  key("salamba_sarvangasana", "halasana"), key("halasana", "matsyasana"),
  key("setu_bandha", "urdhva_dhanurasana"),
]);

/**
 * PAIRS THAT GRIND. Each one is here because the mechanism is specific and no
 * attribute comparison catches it.
 *
 * Half moon into warrior III is the documented case: it asks the standing hip to
 * go from external to internal rotation while you balance on a straight leg,
 * with nothing to unload the joint. The general rule below catches that one, and
 * this table is for the rest — where the FEET have to be rebuilt underneath you.
 */
export const AWKWARD = new Set([
  // Coming out of a deep open-hip shape straight into a square-hip lunge means
  // re-planting the back foot from 90 degrees to 45 mid-pose.
  key("utthita_trikonasana", "virabhadrasana_1"),
  key("utthita_parsvakonasana", "virabhadrasana_1"),
  key("utthita_trikonasana", "parivrtta_trikonasana"),
  // A straightened front leg re-bending into a deep lunge, on the same side.
  key("utthita_trikonasana", "utthita_parsvakonasana"),
  key("parsvottanasana", "virabhadrasana_2"),
  // Inversions are exits, not doorways: you do not stand up out of shoulderstand
  // into standing work, and plough into a backbend loads a just-flexed neck.
  key("halasana", "urdhva_dhanurasana"),
  key("salamba_sarvangasana", "sirsasana"),
  key("sirsasana", "salamba_sarvangasana"),
  // A deep passive hip opener leaves the joint in no state to bear weight on it.
  key("eka_pada_rajakapotasana", "virabhadrasana_3"),
  key("sleeping_swan", "vrksasana"),
]);

/** Standing or lunging — the two positions where which way you face is a fact. */
export const onFeet = (pos) => pos === "standing" || pos === "lunge";

/** Flexion against extension. Lateral and rotation oppose nothing. */
export function spineOpposed(a, b) {
  return (a === "flexion" && b === "extension") || (a === "extension" && b === "flexion");
}

/** Intensity at or above which a pose counts as DEEP for the opposition rule. */
export const DEEP_INTENSITY = 4;

/**
 * The hard rules. Returns null when the pair is fine, else `{code, message}`.
 *
 * `prev` and `next` are asana objects (or ids). A missing pose is not a fault —
 * a substitution chain can hand back something unexpected and refusing to
 * sequence at all is worse than sequencing imperfectly.
 */
export function transitionFault(prev, next) {
  const a = typeof prev === "string" ? byId(prev) : prev;
  const b = typeof next === "string" ? byId(next) : next;
  if (!a || !b || a.id === b.id) return null;

  if (AWKWARD.has(key(a.id, b.id)))
    return { code: "awkward_pair", message: `${a.name} into ${b.name} asks you to rebuild the pose underneath you` };

  // THE ROTATION FLIP. Both balanced on a straight standing leg, and the hip has
  // to swap which way it is turned to get from one to the other. Half moon into
  // warrior III is the pose pair this exists for.
  if (a.straightLeg && b.straightLeg
      && a.hipRotation !== "neutral" && b.hipRotation !== "neutral"
      && a.hipRotation !== b.hipRotation)
    return { code: "rotation_flip", message: `${a.name} into ${b.name} turns the standing hip over with the leg straight` };

  // TWO DEEP OPPOSING SHAPES BACK TO BACK. A counterpose is meant to be SIMPLER
  // than what it answers; a deep backbend straight into a deep fold is not a
  // counterpose, it is two peaks with no recovery between them.
  if (a.intensity >= DEEP_INTENSITY && b.intensity >= DEEP_INTENSITY && spineOpposed(a.spine, b.spine))
    return { code: "deep_opposition", message: `${a.name} straight into ${b.name} is two deep opposing shapes with nothing between them` };

  return null;
}

// --- the soft preference -----------------------------------------------------
/** A pair the rules forbid still scores, at zero — the picker filters on it. */
const FAULT_SCORE = 0;
/** An authored link is worth roughly triple an ordinary acceptable neighbour. */
const LINK_BONUS = 3;
/** Cost per position of distance on the descent, and extra for climbing back. */
const STEP_COST = 0.62;
const CLIMB_COST = 0.34;
/** Re-setting the feet from a wide open stance to a square one, or the reverse. */
const FACING_CHURN = 0.55;
/** Changing hip rotation with the feet planted. Cheap, but not free. */
const ROTATION_CHURN = 0.8;
/** Opposing the spine when neither pose is deep. Fine occasionally, not always. */
const SPINE_FLIP = 0.75;

/**
 * How good a neighbour `next` is for `prev`, as a multiplier the picker applies.
 * 1 is an unremarkable, perfectly acceptable transition.
 */
export function transitionScore(prev, next) {
  const a = typeof prev === "string" ? byId(prev) : prev;
  const b = typeof next === "string" ? byId(next) : next;
  if (!a || !b) return 1;
  if (transitionFault(a, b)) return FAULT_SCORE;
  if (LINKS.has(key(a.id, b.id))) return LINK_BONUS;

  let s = 1;
  const d = positionDistance(a.position, b.position);
  if (d) {
    // Descending the order is what a class does; climbing back up costs more,
    // and this is the rule that stops a sequence standing up and lying down
    // twelve times without ever forbidding a single pose.
    const climbing = POSITION_ORDER.indexOf(b.position) < POSITION_ORDER.indexOf(a.position);
    s *= Math.pow(STEP_COST, d) * (climbing ? CLIMB_COST : 1);
  }
  // Which way you face only means something on your feet, and `neutral` — feet
  // together — pivots to either for free.
  if (onFeet(a.position) && onFeet(b.position)
      && a.facing !== "neutral" && b.facing !== "neutral" && a.facing !== b.facing)
    s *= FACING_CHURN;
  if (a.hipRotation !== "neutral" && b.hipRotation !== "neutral" && a.hipRotation !== b.hipRotation)
    s *= ROTATION_CHURN;
  if (spineOpposed(a.spine, b.spine)) s *= SPINE_FLIP;
  // SIMILARITY IS THE POINT. Same family, same position: the pair the literature
  // says to reach for, and the pair the old scorer punished hardest.
  if (a.family === b.family && a.position === b.position) s *= 1.5;
  return s;
}

/**
 * Every fault in a finished sequence, as `{index, code, message, from, to}`.
 * Used by quality.js and by the sweep.
 */
export function faultsIn(items) {
  const out = [];
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1], next = items[i];
    // A linked salutation is one movement per breath by definition — its
    // internal pairs are the form, not a sequencing choice.
    if (next.linked || prev.linked) continue;
    if (prev.asanaId === next.asanaId) continue;
    const f = transitionFault(prev.asanaId, next.asanaId);
    if (f) out.push({ index: i, ...f, from: prev.asanaId, to: next.asanaId });
  }
  return out;
}

/**
 * How many times a sequence changes where the body is — measured by TIER, so
 * standing and lunging count as one place.
 *
 * Warrior II is a lunge and triangle is a standing pose, and moving between them
 * is not moving: your feet never leave the mat. Counting them separately made an
 * ordinary standing series look like the worst thrash in the sweep.
 */
export function positionChanges(items) {
  let n = 0, cur = null;
  for (const it of items) {
    const a = byId(it.asanaId);
    if (!a) continue;
    const t = tierOf(a.position);
    if (cur !== null && t !== cur) n++;
    cur = t;
  }
  return n;
}

/**
 * ⚠ HOW MANY TIMES THE SEQUENCE GOES BACK SOMEWHERE IT HAD ALREADY LEFT.
 *
 * Counting raw position CHANGES was the obvious measure and it was wrong, in the
 * way that matters most: it fired on 309 correct flows. A ten-minute practice is
 * six poses, and its arc — settle, warm, work, cool, lie down — genuinely puts
 * each of those in a different place. Five changes in six poses is not thrash,
 * it is a descent with one pose per station, and a check that calls that a
 * defect is teaching everyone to ignore it. Same lesson as the poses-per-minute
 * floor that had to be removed, and RAMP_MAX before that.
 *
 * The defect was never movement, it was RETURNING: standing, floor, standing,
 * floor. A pure descent visits n positions in n-1 changes, so everything above
 * that is a journey back to somewhere you had already finished with.
 */
export function positionReturns(items) {
  const seen = new Set();
  for (const it of items) {
    const a = byId(it.asanaId);
    if (a) seen.add(tierOf(a.position));
  }
  return Math.max(0, positionChanges(items) - Math.max(0, seen.size - 1));
}
