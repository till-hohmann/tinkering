// mobility.js — the supplemental mobility & stability program's ENGINE:
// scheduling helpers, the hold-progression state machine, and routine assembly.
//
// The CONTENT (which sessions exist, which exercises, which cues) lives in
// mobility-program.js so a private overlay can replace the routine wholesale
// without touching any of the logic below. Everything here is generic.
//
// The engine records the ACTUAL seconds each hold lasted and progresses from
// that: two consecutive full holds earn +5 s; hitting a per-exercise time cap
// promotes the exercise to a harder variant with a reset starting time; a hold
// that comes in under 70% of target backs the target off to what was really
// held (floored at HOLD_MIN). Deload sessions run at 70% and never update state.

// THE ROUTINE IS DATA, NOT CODE — and these are deliberately `let`.
//
// mobility-program.js is the DEFAULT routine, and it used to be the only one:
// a private overlay replaced the whole file at deploy time, which meant a
// personal rehab routine could only exist by baking it into the build. That is
// fine while a build serves one person and wrong the moment it serves two, and
// it was the last personal thing left in the code — everything else (goal, sex,
// zones, places, programs) had already moved into the profile or the backup.
//
// So the resolved routine now lives in a synced pref, and these exports are
// live bindings over it. Every view imports the same four names it always did
// and none of them needs to know the routine can be swapped; reassigning here
// updates the binding they already hold.
import { MOBILITY_DAYS as DEFAULT_DAYS, MOBILITY_SESSIONS as DEFAULT_SESSIONS,
  MOBILITY_TITLE as DEFAULT_TITLE, MOBILITY_MINUTES as DEFAULT_MINUTES } from "./mobility-program.js";

export let MOBILITY_DAYS = DEFAULT_DAYS;
export let MOBILITY_SESSIONS = DEFAULT_SESSIONS;
export let MOBILITY_TITLE = DEFAULT_TITLE;
export let MOBILITY_MINUTES = DEFAULT_MINUTES;

/** The build's own routine, as a storable record. */
export const defaultRoutine = () => ({
  title: DEFAULT_TITLE,
  minutes: DEFAULT_MINUTES,
  days: [...DEFAULT_DAYS],
  sessions: DEFAULT_SESSIONS,
});

/**
 * Swap in a stored routine. Returns false and changes nothing on anything that
 * doesn't look like a routine — a half-written pref must degrade to the built-in
 * one rather than leaving the app with no sessions at all.
 */
export function applyRoutine(r) {
  if (!r || !r.sessions || typeof r.sessions !== "object" || !Object.keys(r.sessions).length) return false;
  MOBILITY_SESSIONS = r.sessions;
  // Days default to whichever weekdays the routine actually defines, so a stored
  // routine that predates the `days` field still schedules correctly.
  MOBILITY_DAYS = new Set(Array.isArray(r.days) && r.days.length ? r.days : Object.keys(r.sessions));
  MOBILITY_TITLE = r.title || DEFAULT_TITLE;
  MOBILITY_MINUTES = Number.isFinite(r.minutes) ? r.minutes : DEFAULT_MINUTES;
  return true;
}

// Transition seconds between steps. Floor/wall/couch position changes need more
// switching time than the standing warm-up's 5 s.
const T = 10;

export const isMobilityDay = (weekday) => MOBILITY_DAYS.has(weekday);
export const sessionFor = (weekday) => MOBILITY_SESSIONS[weekday] || null;
export const sessionByKey = (key) =>
  Object.values(MOBILITY_SESSIONS).find((s) => s.key === key) || null;

// Rebuild the ENTIRE progression state by replaying the log chronologically.
// This makes the state a pure function of the log — so removing an entry (an
// accidental click-through, a redo) heals every target it wrongly moved, and
// re-completing simply replays cleanly. Entries carry { key, holds, eased }.
export function replayMobilityLog(entries) {
  let state = {};
  for (const e of entries || []) {
    if (!e || !e.key || !e.holds || !e.holds.length) continue;
    const session = sessionByKey(e.key);
    if (!session) continue;
    const items = buildSessionItems(session, state);
    state = applyHoldResults(state, items, e.holds, { eased: !!e.eased }).state;
  }
  return state;
}

// --- hold progression engine (pure) -----------------------------------------
// The player records the ACTUAL seconds every hold lasted ("End hold" logs an
// early stop, full completions log the full time incl. Extend). This engine
// turns those actuals into the next session's targets — data-driven double
// progression for holds: earn the time, then earn the harder variant.
//
//   - full hold (worst side ≥ target) twice in a row → target +5 s
//   - at the time cap with the streak earned → advance to the harder VARIANT
//     (level), target resets to the level's starting time
//   - clearly failed (worst side < 70% of target) → target drops to what was
//     actually held (rounded to 5 s, never below 20 s) — meet you where you are
//   - deload sessions never touch the state (eased holds prove nothing)

export const HOLD_MIN = 20;
export const HOLD_CAPS = {
  couch_stretch: 75, hip_9090: 90, adductor_rockback: 60, ankle_rock: 60,
  tib_raise: 70, soleus_raise: 60, glute_bridge: 90, sl_hip_abduction: 60,
  copenhagen: 45, wall_sit: 90, step_down: 60, dead_bug: 90, side_plank: 60, bird_dog: 90,
};

// Harder variants, unlocked when the time cap is earned. `startSec` restarts the
// time ladder; overrides (name/cue/bilateral) replace the base item's fields.
export const HOLD_LEVELS = {
  side_plank: [
    { name: "Side plank", startSec: 35 },
    { name: "Side plank · leg lifted", cue: "Top leg raised the whole hold — hips stay high", startSec: 30 },
  ],
  copenhagen: [
    { name: "Copenhagen plank", startSec: 30 },
    { name: "Copenhagen · long lever", cue: "Straight top leg on the couch — much harder, start short", startSec: 20 },
  ],
  glute_bridge: [
    { name: "Glute bridge", startSec: 60 },
    { name: "Single-leg glute bridge", cue: "One foot down, hips level — the real glute test", startSec: 30, bilateral: true },
  ],
  dead_bug: [
    { name: "Dead bug", startSec: 60 },
    { name: "Dead bug · hover", cue: "Heels and hands hover low, never touching down", startSec: 40 },
  ],
  bird_dog: [
    { name: "Bird dog", startSec: 60 },
    { name: "Bird dog · knee-to-elbow", cue: "Slow elbow-to-knee touch each rep, no wobble", startSec: 45 },
  ],
};

const round5 = (x) => Math.max(HOLD_MIN, Math.round(x / 5) * 5);
const capFor = (id) => HOLD_CAPS[id] || 90;

// state: { [itemId]: { level, targetSec, streak, lastActual } } (synced pref
// "mobilityProg"). Missing entries initialise from the base item on first use.
export function progFor(state, item) {
  const st = (state || {})[item.id];
  return st || { level: 0, targetSec: item.durationSeconds, streak: 0, lastActual: null };
}

// Base session items with the progression state applied (target + variant).
export function buildSessionItems(session, state) {
  return session.items.map((it) => {
    if (it.mode !== "timed") return { ...it };
    const st = progFor(state, it);
    const lvl = (HOLD_LEVELS[it.id] || [])[st.level];
    return { ...it, durationSeconds: st.targetSec,
      ...(lvl && st.level > 0 ? { name: lvl.name, cue: lvl.cue || it.cue,
        ...(lvl.bilateral != null ? { bilateral: lvl.bilateral } : {}) } : {}) };
  });
}

// Consume one session's hold records → next state + human-readable changes.
export function applyHoldResults(state, items, holds, { eased = false } = {}) {
  const next = { ...(state || {}) };
  const changes = [];
  if (eased || !holds || !holds.length) return { state: next, changes };
  for (const it of items) {
    if (it.mode !== "timed") continue;
    const recs = holds.filter((h) => h.id === it.id);
    if (!recs.length) continue;
    const actual = Math.min(...recs.map((r) => r.heldSec));   // worst side governs
    const st = { ...progFor(state, it) };
    const target = st.targetSec;
    if (actual >= target) {
      st.streak = (st.streak || 0) + 1;
      if (st.streak >= 2) {
        const cap = capFor(it.id);
        const levels = HOLD_LEVELS[it.id] || [];
        if (target + 5 <= cap) {
          st.targetSec = target + 5; st.streak = 0;
          changes.push(`${it.name} → ${st.targetSec}s`);
        } else if (levels[st.level + 1]) {
          st.level += 1; st.targetSec = levels[st.level].startSec; st.streak = 0;
          changes.push(`${it.name} → ${levels[st.level].name}`);
        } else { st.streak = 0; }   // maxed out — hold the ceiling
      }
    } else if (actual < target * 0.7) {
      st.targetSec = round5(actual); st.streak = 0;
      if (st.targetSec !== target) changes.push(`${it.name} ↓ ${st.targetSec}s`);
    } else {
      st.streak = 0;   // close but not full — earn it again at the same target
    }
    st.lastActual = actual;
    next[it.id] = st;
  }
  return { state: next, changes };
}

// Build a runnable routine def for the day: progression state applied (targets +
// variants), then `scale` (e.g. 0.7 on deload weeks) shortens the timed holds;
// transitions stay fixed. Returns { def, items } — `items` are the UNSCALED
// progression-applied items, which applyHoldResults consumes after the session.
export function mobilityRoutineFor(weekday, scale = 1, state = null) {
  const s = sessionFor(weekday);
  if (!s) return null;
  const items = buildSessionItems(s, state);
  const def = {
    rounds: 1, transitionSeconds: T,
    items: items.map((it) => ({
      ...it,
      durationSeconds: it.mode === "timed" ? Math.max(20, Math.round((it.durationSeconds * scale) / 5) * 5) : 0,
    })),
  };
  return { def, items };
}

// Completion log lives in store.js (getMobilityLog / addMobilityDone /
// mobilityDoneOn) with the other cloud-synced prefs — this module stays pure.
