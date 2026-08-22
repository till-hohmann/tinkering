// stretch.js — hold progression for the stretches inside warm-ups and cool-downs.
// Pure: no DOM, no storage.
//
// WHY THIS EXISTS SEPARATELY FROM mobility.js.
//
// The mobility sessions already progress honestly: they record the seconds you
// ACTUALLY held and move the target from that, so cutting a hold short lowers the
// next one instead of leaving you failing the same number every week. The
// stretches attached to a workout had none of that. They ran a fixed duration
// from the program, the player's "end hold" button was hidden, and stopping early
// was invisible — so a stretch that was always too long stayed too long forever,
// and one you had outgrown never got harder.
//
// It is not the same engine because the mobility one carries machinery a stretch
// has no use for: exercise VARIANTS (a plank progressing to a harder plank) and
// per-exercise ceilings tuned to a rehab routine. A hamstring stretch has no
// harder variant; it just has a length. Importing that would mean carrying a
// level system that is permanently unused and, worse, could silently promote a
// stretch into something the program never prescribed.
//
// The RULE is deliberately identical, because two systems that adapt differently
// would be a worse surprise than two that adapt the same:
//   - hold the full target twice in a row  -> +5 s
//   - stop under 70% of target             -> re-base to what you actually held
//   - anywhere in between                  -> unchanged, earn it again

import { isStrengthHold, holdTarget, applyHoldResults } from "./holds.js";

// ⚠ A STRENGTH HOLD IS NOT A STRETCH AND MUST NOT MEET THE RULE BELOW.
//
// Dead hang, plank, side plank, hollow hold and wall sit all end when you fail,
// which the re-base rule reads as a target set too high — so it lowered them,
// every session, for months. holds.js carries the inverse rule. These two
// functions are the single place the two engines meet: everything upstream keeps
// calling one entry point, and each item is routed to the engine that suits it.
export { isStrengthHold } from "./holds.js";

export const STRETCH_MIN = 15;      // never prescribe less; below this it isn't a stretch
export const STRETCH_CAP = 90;      // a warm-up is not the place for a 3-minute hold
const FULL_STREAK = 2;
const SHORTFALL = 0.7;

const round5 = (x) => Math.max(STRETCH_MIN, Math.min(STRETCH_CAP, Math.round(x / 5) * 5));

/** This item's current state, or a starting one derived from the program. */
export function stretchState(state, item) {
  const st = (state || {})[item.id];
  if (st && Number.isFinite(st.targetSec)) return st;
  return { targetSec: clampTarget(item.durationSeconds), streak: 0, lastActual: null };
}
const clampTarget = (s) =>
  Number.isFinite(s) ? Math.max(STRETCH_MIN, Math.min(STRETCH_CAP, Math.round(s))) : STRETCH_MIN;

/** The seconds to prescribe for this item now. */
export const stretchTarget = (state, item) =>
  isStrengthHold(item) ? holdTarget(state, item) : stretchState(state, item).targetSec;

/**
 * Consume one session's hold records → { state, changes }.
 *
 * `holds` are the routine player's records: { id, side, targetSec, heldSec }.
 * Only items the user actually reached are touched — skipping the cool-down
 * entirely must not be read as failing every stretch in it.
 */
export function applyStretchResults(state, items, holds) {
  // Strength holds first, through their own engine and into the same store: one
  // set of targets keyed by item id, two rules for moving them.
  const strength = applyHoldResults(state, items, holds);
  const next = { ...strength.state };
  const changes = [...strength.changes];
  if (!holds || !holds.length) return { state: next, changes };

  for (const it of items) {
    if (!it || it.mode !== "timed" || isStrengthHold(it)) continue;
    const recs = holds.filter((h) => h && h.id === it.id);
    if (!recs.length) continue;
    // The worst side governs: a stretch held 45 s left and 20 s right is a 20 s
    // stretch, and averaging would quietly keep prescribing a right side you
    // can't hold.
    const actual = Math.min(...recs.map((r) => Math.max(0, r.heldSec || 0)));
    const st = { ...stretchState(state, it) };
    const target = st.targetSec;

    if (actual >= target) {
      st.streak = (st.streak || 0) + 1;
      if (st.streak >= FULL_STREAK) {
        if (target + 5 <= STRETCH_CAP) {
          st.targetSec = target + 5;
          changes.push(`${it.name || it.id} → ${st.targetSec}s`);
        }
        st.streak = 0;                       // reset whether or not it moved
      }
    } else if (actual < target * SHORTFALL) {
      const rebased = round5(actual);
      st.streak = 0;
      if (rebased !== target) {
        st.targetSec = rebased;
        changes.push(`${it.name || it.id} ↓ ${rebased}s`);
      }
    } else {
      st.streak = 0;                         // close but not full — earn it again
    }
    st.lastActual = actual;
    next[it.id] = st;
  }
  return { state: next, changes };
}

/**
 * Apply the current targets to a routine definition, returning a NEW def plus the
 * progression-applied items the results consumer needs afterwards.
 *
 * Only timed stretches are touched. Dynamic warm-up work — leg swings, an easy
 * jog, anything on a fixed clock for a reason — passes through untouched, because
 * "how long did you hold it" is not a question those items are answering.
 */
export function applyStretchTargets(def, state, isStretch) {
  if (!def || !Array.isArray(def.items)) return { def, items: [] };
  const items = def.items.map((it) => {
    if (it.mode !== "timed" || !isStretch(it)) return it;
    return { ...it, durationSeconds: stretchTarget(state, it) };
  });
  return { def: { ...def, items }, items };
}

/**
 * ONE-TIME REPAIR for what the Skip button wrote before it stopped logging.
 *
 * Skip logged the elapsed time as a hold — about a second, because that is when
 * you press it — and the re-base rule floored the target at STRETCH_MIN. So a
 * single pass of Skip through a cool-down flattened every learned target to 15
 * seconds. The fix stops it recurring; it cannot know what you had earned.
 *
 * ⚠ IT MATCHES THE BUG'S FINGERPRINT, NOT JUST THE FLOOR. Clearing everything
 * sitting at 15 s would also wipe a target somebody genuinely holds at 15 — the
 * one person the progression is working hardest for. A Skip leaves `lastActual`
 * at nought-to-two seconds; a real end-hold on a 45 s stretch that floors the
 * target leaves it at eight or ten. Only the former is undone.
 *
 * Dropping the entry rather than guessing a number is deliberate: with no state,
 * stretchState falls back to the plan's own duration, which is where a new
 * install starts and the only honest answer to "we lost what you had earned".
 */
export function repairSkipFlooring(state, { maxActual = 5 } = {}) {
  const next = {};
  const cleared = [];
  for (const [id, st] of Object.entries(state || {})) {
    const floored = st && st.targetSec === STRETCH_MIN;
    const barelyHeld = st && Number.isFinite(st.lastActual) && st.lastActual <= maxActual;
    if (floored && barelyHeld) { cleared.push(id); continue; }
    next[id] = st;
  }
  return { state: next, cleared };
}
