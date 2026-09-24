// holds.js — progression for STRENGTH holds: dead hang, plank, side plank,
// hollow hold, wall sit. Pure: no DOM, no storage.
//
// ⚠ WHY THIS IS NOT stretch.js, AND WHAT IT COST TO LEARN.
//
// The stretch engine treats falling short of the target as evidence the target
// is wrong: hold under 70% of it and the target re-bases to what you managed.
// That is exactly right for a hamstring stretch, where the number is a comfort
// boundary and failing to reach it means the prescription was too long.
//
// It is exactly WRONG for a hold you take to failure. A dead hang ends when your
// grip opens. Stopping short is not a mis-prescription, it is the entire point of
// the exercise — so every honest session read as a failure and re-based the
// target downward. Measured on a real install after several months:
//
//   hip flexors 40 -> 65s     lats 40 -> 50s     hamstrings 40 -> 50s
//   DEAD HANG   40 -> 20s
//
// Every flexibility hold had climbed. The one strength hold had ratcheted to
// half its starting number and could not climb out, because reaching a target
// you are meant to fail at is the only way the stretch rule ever raises it.
//
// So the rule here is the inverse, and it is the rule a coach would use:
//
//   - make the full target twice in a row        -> +5 s
//   - fall short                                 -> NOTHING CHANGES. Try again.
//   - fall badly short three sessions running    -> re-base to the BEST of those
//                                                   three, not the worst
//
// "Progress from your best, never re-base from your worst" is the whole
// difference. A bad grip day, a session at the end of a hard week, a cold room —
// none of them should cost you a target you have held before.

/** Never prescribe less than this: below it there is no hold to speak of. */
export const HOLD_MIN = 15;
/**
 * A ceiling rather than a goal. A stretch is capped at 90 s because a warm-up is
 * not the place for a three-minute hold; a dead hang or a plank legitimately
 * goes further, and capping a strength hold at a stretch's ceiling would stall
 * exactly the person the progression is working for.
 */
export const HOLD_CAP = 180;
const FULL_STREAK = 2;
/** Below this share of target counts as "badly short" rather than just short. */
const SHORTFALL = 0.7;
/** Consecutive bad sessions before the target moves down at all. */
const MISS_STREAK = 3;

const round5 = (x) => Math.max(HOLD_MIN, Math.min(HOLD_CAP, Math.round(x / 5) * 5));

/**
 * WHICH TIMED ITEMS ARE STRENGTH HOLDS.
 *
 * Deliberately a short, explicit list rather than a broad pattern. Everything
 * matched here stops being able to lower its own target on a bad day, so a
 * flexibility hold caught by mistake would quietly keep prescribing a stretch
 * the person cannot reach — the opposite failure, and a harder one to notice.
 * The one broad token is `plank`, which covers plank, side plank, forearm plank
 * and copenhagen and is a strength hold in every one of those readings.
 */
const STRENGTH_HOLD_RE =
  /dead[_ ]?hang|plank|hollow|wall[_ ]?sit|copenhagen|l[_ ]?sit|leg[_ ]?raise|bird[_ ]?dog|hang(ing)?[_ ]?knee/i;

export const isStrengthHold = (item) =>
  !!item && (STRENGTH_HOLD_RE.test(item.id || "") || STRENGTH_HOLD_RE.test(item.name || ""));

/** This item's current state, or a starting one derived from the plan. */
export function holdState(state, item) {
  const st = (state || {})[item.id];
  if (st && Number.isFinite(st.targetSec)) return st;
  return { targetSec: clampTarget(item.durationSeconds), streak: 0, misses: [], lastActual: null };
}
const clampTarget = (s) =>
  Number.isFinite(s) ? Math.max(HOLD_MIN, Math.min(HOLD_CAP, Math.round(s))) : HOLD_MIN;

/** The seconds to prescribe for this item now. */
export const holdTarget = (state, item) => holdState(state, item).targetSec;

/**
 * Consume one session's hold records → { state, changes }.
 *
 * `holds` are the routine player's records: { id, side, targetSec, heldSec }.
 * Only items actually reached are touched — skipping a cool-down must never read
 * as failing everything in it.
 */
export function applyHoldResults(state, items, holds) {
  const next = { ...(state || {}) };
  const changes = [];
  if (!holds || !holds.length) return { state: next, changes };

  for (const it of items) {
    if (!it || it.mode !== "timed" || !isStrengthHold(it)) continue;
    const recs = holds.filter((h) => h && h.id === it.id);
    if (!recs.length) continue;
    // The worst side still governs whether the target was MADE: a side plank
    // held 45 left and 25 right is not a 45-second side plank. What changed is
    // what happens when it was not made.
    const actual = Math.min(...recs.map((r) => Math.max(0, r.heldSec || 0)));
    const st = { ...holdState(state, it), misses: [...(holdState(state, it).misses || [])] };
    const target = st.targetSec;

    if (actual >= target) {
      st.misses = [];
      st.streak = (st.streak || 0) + 1;
      if (st.streak >= FULL_STREAK) {
        if (target + 5 <= HOLD_CAP) {
          st.targetSec = target + 5;
          changes.push(`${it.name || it.id} → ${st.targetSec}s`);
        }
        st.streak = 0;
      }
    } else {
      st.streak = 0;                       // a miss costs the streak, nothing else
      if (actual < target * SHORTFALL) {
        st.misses.push(actual);
        if (st.misses.length >= MISS_STREAK) {
          // Re-base to the BEST of the run. Three sessions all well under target
          // is a target you are not going to reach, but the honest replacement is
          // the most you managed across them, not the least.
          const rebased = round5(Math.max(...st.misses));
          st.misses = [];
          if (rebased < target) {
            st.targetSec = rebased;
            changes.push(`${it.name || it.id} ↓ ${rebased}s`);
          }
        }
      } else {
        st.misses = [];                    // close enough not to count against you
      }
    }
    st.lastActual = actual;
    next[it.id] = st;
  }
  return { state: next, changes };
}

/**
 * ONE-TIME REPAIR for what the stretch rule did to strength holds.
 *
 * Any strength hold whose stored target sits BELOW the number its plan
 * prescribes was ratcheted there by a rule that should never have been applied
 * to it. The entry is dropped rather than rewritten, so the target falls back to
 * the plan's own figure — which is where a new install starts, and the only
 * honest answer to "we do not know what you could have held".
 *
 * A strength hold ABOVE its plan number was earned under the raise rule, which
 * is the same in both engines. Those are left exactly as they are.
 */
export function repairHoldRatchet(state, planSeconds) {
  const next = { ...(state || {}) };
  const cleared = [];
  for (const [id, st] of Object.entries(state || {})) {
    if (!isStrengthHold({ id })) continue;
    const plan = planSeconds[id];
    if (!Number.isFinite(plan)) continue;
    if (st && Number.isFinite(st.targetSec) && st.targetSec < plan) {
      delete next[id];
      cleared.push(`${id} ${st.targetSec}s → ${plan}s`);
    }
  }
  return { state: next, cleared };
}
