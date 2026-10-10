// extra-run.js — a run that is not part of the plan. Pure: no DOM, no storage.
//
// AN EXTRA RUN IS FOR NO PLANNED DAY. It carries `extra: true` and no
// programId, and both matter. Every plan screen (the week ring, the week list,
// a day's card, the next-run targets) finds its sessions through the programme
// index, and a record with no programId is not in that index, so none of them
// can mistake an extra run for the planned one. The screens that read every
// session (calendar, history, progress, records, shoes) check `extra` where the
// difference matters: the calendar does not tick a planned day off with it;
// history, progress, records and shoes count it like any run.
//
// The stopwatch state is a few timestamps, never a running counter. A phone
// that locks, a switch to Spotify, even iOS killing the page mid-run: elapsed
// time is recomputed from the clock when the app comes back, so nothing is lost
// while the screen was off.

import { WEEKDAYS } from "./model.js";

export const isExtra = (s) => !!(s && s.extra);

const pad = (n) => String(n).padStart(2, "0");

/** A stable, sortable id: extra-YYYY-MM-DD-HHMMSS (local time). */
export function extraRunId(date) {
  const d = date instanceof Date ? date : new Date(date);
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `extra-${iso}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Weekday key ("Mon".."Sun") for an ISO date, read as a local calendar date. */
export function weekdayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAYS[(new Date(y, m - 1, d).getDay() + 6) % 7];
}

// --- stopwatch ---------------------------------------------------------------
// { startedAt, pausedAt, pausedMs, finishedAt } — all epoch ms or null.

export function startWatch(now) {
  return { startedAt: now, pausedAt: null, pausedMs: 0, finishedAt: null };
}
export function pauseWatch(w, now) {
  if (!w || w.pausedAt != null || w.finishedAt != null) return w;
  return { ...w, pausedAt: now };
}
export function resumeWatch(w, now) {
  if (!w || w.pausedAt == null) return w;
  return { ...w, pausedMs: w.pausedMs + (now - w.pausedAt), pausedAt: null };
}
export function finishWatch(w, now) {
  if (!w || w.finishedAt != null) return w;
  const r = w.pausedAt != null ? resumeWatch(w, w.pausedAt) : w;   // a paused watch stops where it paused
  return { ...r, finishedAt: w.pausedAt != null ? w.pausedAt : now };
}
/** Moving time so far, in ms. Pauses excluded. */
export function elapsedMs(w, now) {
  if (!w || w.startedAt == null) return 0;
  const end = w.finishedAt != null ? w.finishedAt : w.pausedAt != null ? w.pausedAt : now;
  return Math.max(0, end - w.startedAt - (w.pausedMs || 0));
}

// --- the saved record ---------------------------------------------------------

/**
 * The session record for an extra run. `cardioResult` comes from the run log,
 * exactly as a planned run's does. `zone` is the band it was run against.
 */
export function makeExtraSession({ id, date, cardioResult, zone = 2, shoeId, completedAt }) {
  return {
    id,
    extra: true,
    programId: null,
    weekNumber: null,
    weekday: weekdayOf(date),
    date,
    type: "cardio",
    location: null,
    // Read by the VO2max trend to tell steady runs from interval days, the same
    // way a planned run's prescription is.
    prescription: `Extra run · Zone ${zone}`,
    preRoutineDone: false,
    postRoutineDone: false,
    cardioResult,
    strengthResult: [],
    sessionNotes: {},
    ...(shoeId !== undefined ? { shoeId } : {}),
    completedAt,
    source: "app",
  };
}

/** Extra runs inside a set of dates: { count, km }. */
export function extraRunsIn(sessions, dates) {
  const set = dates instanceof Set ? dates : new Set(dates);
  let count = 0, km = 0;
  for (const s of sessions || []) {
    if (!isExtra(s) || !set.has(s.date)) continue;
    count++;
    const d = Number(s.cardioResult && s.cardioResult.distanceKm);
    if (Number.isFinite(d) && d > 0) km += d;
  }
  return { count, km };
}

// --- matching a tracker workout -------------------------------------------------

const RUNNISH = /run|jog|walk|treadmill|cardio|elliptical|cycl|row|hiit|interval/i;

/**
 * Which of the day's tracker workouts is this run? The one whose start is
 * nearest the stopwatch start, when there was a stopwatch. Without one (the
 * run was logged straight away), the latest run-like workout, because an extra
 * run is usually logged right after it ends, and the planned run of the day is
 * the other one. Returns an index into `workouts`, or -1.
 */
export function pickWorkoutIndex(workouts, startedAtMs = null) {
  const list = (workouts || []).map((w, i) => ({ w, i, t: w && w.start ? Date.parse(w.start) : NaN }))
    .filter((x) => x.w && Number.isFinite(x.t));
  if (!list.length) return -1;
  const runs = list.filter((x) => RUNNISH.test(x.w.sport || ""));
  const pool = runs.length ? runs : list;
  if (startedAtMs != null) {
    return pool.reduce((best, x) => (Math.abs(x.t - startedAtMs) < Math.abs(best.t - startedAtMs) ? x : best)).i;
  }
  return pool.reduce((best, x) => (x.t > best.t ? x : best)).i;
}
