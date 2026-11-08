// arc.js — an ARC: a dated push toward a handful of goals ("Winter Arc").
//
// A block is a training plan; an arc sits above the blocks and asks the bigger
// question, "am I on track for the date that matters?". It lives on the profile
// (`profile.arc`, synced like every setting) and is empty on a fresh install:
//
//   { name, startDate, endDate,
//     goals: { weightKg, startWeightKg, vo2max, startVo2max, recoveryPct } }
//
// Protein is NOT a separate arc goal: it is the nutrition target the app already
// has (g/kg), so there is exactly one number to keep right.
//
// Everything here is pure: the Today screen reads the stores and hands the
// pieces in, so the maths can be tested without a database.

import { addDaysISO, daysBetweenISO, mondayOfISO } from "./dates.js";
import { sessionPlanDate } from "./model.js";

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round1 = (x) => Math.round(x * 10) / 10;

/** Is `arc` a usable arc? (dates present and in order) */
export function arcValid(arc) {
  return !!(arc && /^\d{4}-\d{2}-\d{2}$/.test(arc.startDate || "") && /^\d{4}-\d{2}-\d{2}$/.test(arc.endDate || "")
    && arc.endDate > arc.startDate);
}

/**
 * Where `iso` sits in the arc. `left` is whole days until the end date (0 on the
 * day itself), `pct` the share of the arc already behind you.
 */
export function arcWindow(arc, iso) {
  if (!arcValid(arc)) return null;
  const total = daysBetweenISO(arc.startDate, arc.endDate);
  const elapsed = daysBetweenISO(arc.startDate, iso);
  const left = daysBetweenISO(iso, arc.endDate);
  return {
    total, elapsed, left,
    day: elapsed + 1,
    pct: clamp01(elapsed / total),
    before: iso < arc.startDate,
    over: iso > arc.endDate,
    final: iso === arc.endDate,
  };
}

/** Shown on Today from its first day through its last, and not after. */
export function arcShowing(arc, iso) {
  const w = arcWindow(arc, iso);
  return !!w && !w.before && !w.over;
}

/** Month boundaries inside the arc, for the ticks on the curve. */
export function arcMonths(arc) {
  if (!arcValid(arc)) return [];
  const out = [];
  let [y, m] = arc.startDate.split("-").map(Number);
  for (let i = 0; i < 24; i++) {
    m += 1; if (m > 12) { m = 1; y += 1; }
    const iso = `${y}-${String(m).padStart(2, "0")}-01`;
    if (iso >= arc.endDate) break;
    if (iso > arc.startDate) out.push({ iso, pct: daysBetweenISO(arc.startDate, iso) / daysBetweenISO(arc.startDate, arc.endDate) });
  }
  return out;
}

// --- weight -----------------------------------------------------------------
/**
 * The newest weigh-in, and how old the newest REAL one is.
 *
 * The session notes pre-fill bodyweight with the last value, so a run of
 * identical numbers on consecutive training days is usually one weigh-in
 * repeated, not a plateau. `sinceChangeDays` counts back to the last time the
 * number moved; the arc asks for a weigh-in when that gets long.
 */
export function latestWeight(weightLog, iso) {
  const log = (weightLog || []).filter((e) => e && e.date <= iso && e.kg > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!log.length) return null;
  const last = log[log.length - 1];
  let since = last.date;
  for (let i = log.length - 2; i >= 0 && log[i].kg === last.kg; i--) since = log[i].date;
  return { kg: last.kg, date: last.date, sameSince: since, sinceChangeDays: daysBetweenISO(since, iso) };
}

/**
 * What to do with the tracker's bodyweight (WHOOP keeps ONE profile value, not a
 * dated log, so a weigh-in there is visible only as that value changing).
 *
 *   "skip"     the tracker shows what it showed last time: nothing new happened.
 *              Crucially this protects a weight typed into the app today from
 *              being overwritten by a stale tracker value.
 *   "remember" the tracker value moved but already matches the app's latest
 *              weigh-in (entered in both places): note it, log nothing.
 *   "log"      a new weigh-in made on the tracker: log it as today's.
 */
export function trackerWeightAction(lastSeenKg, latestLoggedKg, readingKg) {
  if (!(readingKg > 0)) return "skip";
  const r = round1(readingKg);
  if (lastSeenKg != null && round1(lastSeenKg) === r) return "skip";
  if (latestLoggedKg != null && round1(latestLoggedKg) === r) return "remember";
  return "log";
}

// A start left blank in the form means "where I was when the arc began": the
// last reading on or before the start date, else the first one after it. Using
// the CURRENT reading instead pinned progress at 0% for the whole arc.
function startingValue(log, startDate, pick) {
  const xs = (log || []).filter((e) => e && e.date && pick(e) > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  let before = null;
  for (const e of xs) { if (e.date <= startDate) before = e; else return pick(before || e); }
  return before ? pick(before) : null;
}

function startWeight(arc, weightLog) {
  const g = (arc && arc.goals) || {};
  return g.startWeightKg > 0 ? g.startWeightKg : startingValue(weightLog, arc && arc.startDate, (e) => e && e.kg);
}

/** The straight line from the start weight to the goal: where you "should" be today. */
export function expectedWeight(arc, iso, weightLog) {
  const g = (arc && arc.goals) || {};
  const w = arcWindow(arc, iso);
  const start = startWeight(arc, weightLog);
  if (!w || !(start > 0) || !(g.weightKg > 0)) return null;
  return round1(start + (g.weightKg - start) * w.pct);
}

// Works for a cut and a bulk alike: the direction is the sign of goal − start.
export function weightStatus(arc, weightLog, iso) {
  const g = (arc && arc.goals) || {};
  if (!(g.weightKg > 0)) return null;
  const cur = latestWeight(weightLog, iso);
  const expected = expectedWeight(arc, iso, weightLog);
  const start = startWeight(arc, weightLog) || (cur ? cur.kg : null);
  if (!cur) return { goal: g.weightKg, current: null, expected, pct: 0, stale: true, delta: null, dir: 0 };
  const dir = Math.sign(round1(g.weightKg - start));          // -1 cut, +1 bulk, 0 hold
  const span = Math.abs(g.weightKg - start);
  const toGo = dir < 0 ? Math.max(0, cur.kg - g.weightKg) : dir > 0 ? Math.max(0, g.weightKg - cur.kg)
    : Math.abs(cur.kg - g.weightKg);
  const raw = expected != null ? round1(cur.kg - expected) : null;
  return {
    goal: g.weightKg, current: cur.kg, date: cur.date, expected, dir,
    toGo: round1(toGo),
    // + = BEHIND the line (too heavy on a cut, too light on a bulk); for a hold,
    // any distance from the goal counts.
    delta: raw == null ? null : dir === 0 ? round1(Math.abs(raw)) : round1(dir < 0 ? raw : -raw),
    pct: span > 0 ? clamp01((dir < 0 ? start - cur.kg : cur.kg - start) / span) : (toGo <= 0.3 ? 1 : 0),
    stale: cur.sinceChangeDays >= 7,
    sinceChangeDays: cur.sinceChangeDays,
  };
}

// --- VO2max -----------------------------------------------------------------
export function vo2Status(arc, vo2Log) {
  const g = (arc && arc.goals) || {};
  if (!(g.vo2max > 0)) return null;
  const log = (vo2Log || []).filter((e) => e && e.value > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  const cur = log.length ? log[log.length - 1] : null;
  if (!cur) return { goal: g.vo2max, current: null, pct: 0, toGo: null };
  const start = g.startVo2max > 0 ? g.startVo2max : startingValue(log, arc.startDate, (e) => e && e.value) || cur.value;
  const span = g.vo2max - start;
  return {
    goal: g.vo2max, current: cur.value, date: cur.date,
    toGo: Math.max(0, round1(g.vo2max - cur.value)),
    pct: span > 0 ? clamp01((cur.value - start) / span) : (cur.value >= g.vo2max ? 1 : 0),
  };
}

// --- recovery ---------------------------------------------------------------
/** history: [{ date, pct }]. Average since the arc began, plus the last 7 days. */
export function recoveryStatus(arc, history, iso) {
  const g = (arc && arc.goals) || {};
  if (!(g.recoveryPct > 0)) return null;
  const inArc = (history || []).filter((r) => r && r.pct != null && r.date >= arc.startDate && r.date <= iso);
  const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, r) => a + r.pct, 0) / xs.length) : null);
  const avg = mean(inArc);
  const last7 = mean(inArc.filter((r) => r.date > addDaysISO(iso, -7)));
  return { goal: g.recoveryPct, avg, last7, days: inArc.length, pct: avg != null ? clamp01(avg / g.recoveryPct) : 0 };
}

// --- protein ----------------------------------------------------------------
/**
 * Days since the arc began on which protein reached perKg × bodyweight (the
 * weight on or before that day). Only days with food logged count either way:
 * an unlogged day is unknown, not a miss — but it is reported, because a
 * target you only check on good days isn't being checked.
 */
export function proteinStatus(arc, nutritionLog, weightLog, perKg, iso, fallbackKg) {
  if (!(perKg > 0) || !arcValid(arc)) return null;
  const weights = (weightLog || []).filter((e) => e && e.kg > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  const kgOn = (d) => { let kg = null; for (const e of weights) { if (e.date <= d) kg = e.kg; else break; } return kg || fallbackKg || null; };
  let logged = 0, hit = 0, sumPerKg = 0, days = 0;
  for (let d = arc.startDate; d <= iso; d = addDaysISO(d, 1)) {
    days++;
    const e = (nutritionLog || {})[d];
    if (!e || e.protein == null) continue;
    const kg = kgOn(d);
    if (!kg) continue;
    logged++;
    sumPerKg += e.protein / kg;
    if (e.protein >= Math.round(perKg * kg)) hit++;
  }
  return { perKg, logged, hit, days, avgPerKg: logged ? round1(sumPerKg / logged) : null, pct: logged ? hit / logged : 0 };
}

// --- adherence ----------------------------------------------------------------
/** The block that owns a date: the one whose range contains it, latest start wins. */
export function programOn(programs, iso) {
  return (programs || [])
    .filter((p) => p.startDate && p.lengthWeeks && iso >= p.startDate && iso < addDaysISO(p.startDate, p.lengthWeeks * 7))
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0] || null;
}

const hasContent = (s) => !!(s && ((s.strengthResult && s.strengthResult.length) || s.cardioResult));

/**
 * Planned sessions done since the arc began. A session counts for the day it
 * was PLANNED for (sessionPlanDate), so a Tuesday done on Wednesday is still
 * Tuesday's. Today counts once it is done and is never a miss. Extra runs are
 * no planned day's work and don't count.
 *
 * weekStreak = finished Mon–Sun weeks in a row (newest first) with every planned
 * session done; the current week joins it only once it is complete.
 *
 * resolveDay is passed in (it lives in store.js, next to the database).
 */
export function arcAdherence(arc, programs, sessions, iso, resolveDay) {
  if (!arcValid(arc)) return null;
  const byId = new Map((programs || []).map((p) => [p.id, p]));
  const done = new Set();
  for (const s of sessions || []) {
    if (!hasContent(s) || s.extra) continue;
    const d = sessionPlanDate(byId.get(s.programId), s);
    if (d) done.add(d);
  }
  const end = iso < arc.endDate ? iso : arc.endDate;
  const weeks = new Map();   // monday → { planned, done, complete }
  let planned = 0, did = 0;
  for (let d = arc.startDate; d <= end; d = addDaysISO(d, 1)) {
    const p = programOn(programs, d);
    const day = p ? resolveDay(p, d).day : null;
    if (!day || day.type === "rest") continue;
    const isDone = done.has(d);
    if (d === iso && !isDone) {        // today, still to do: not a miss yet
      const wk = weeks.get(mondayOfISO(d)) || { planned: 0, done: 0, pending: 0 };
      wk.pending++; weeks.set(mondayOfISO(d), wk);
      continue;
    }
    planned++; if (isDone) did++;
    const wk = weeks.get(mondayOfISO(d)) || { planned: 0, done: 0, pending: 0 };
    wk.planned++; if (isDone) wk.done++;
    weeks.set(mondayOfISO(d), wk);
  }
  const thisMon = mondayOfISO(iso);
  // The rest of this week, still ahead: the week can't be "complete" before it ends.
  let restOfWeek = 0;
  for (let d = addDaysISO(iso, 1); d < addDaysISO(thisMon, 7) && d <= arc.endDate; d = addDaysISO(d, 1)) {
    const p = programOn(programs, d);
    const day = p ? resolveDay(p, d).day : null;
    if (day && day.type !== "rest") restOfWeek++;
  }
  let weekStreak = 0;
  const mondays = [...weeks.keys()].sort().reverse();
  for (const mon of mondays) {
    const wk = weeks.get(mon);
    if (mon === thisMon) {
      const complete = wk.pending === 0 && restOfWeek === 0 && wk.planned > 0 && wk.done === wk.planned;
      if (complete) weekStreak++;
      else if (wk.done < wk.planned) break;   // a miss this week already breaks it
      continue;
    }
    if (wk.planned > 0 && wk.done === wk.planned) weekStreak++;
    else if (wk.planned > 0) break;
  }
  const tw = weeks.get(thisMon) || { planned: 0, done: 0, pending: 0 };
  return {
    planned, done: did, missed: planned - did,
    pct: planned ? did / planned : null,
    weekStreak,
    thisWeek: { done: tw.done, planned: tw.planned + tw.pending + restOfWeek },
  };
}
