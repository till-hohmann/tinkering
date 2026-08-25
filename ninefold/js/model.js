// model.js — pure domain logic: effective-weight rules, volume, comparison, dates.
// No DOM, no storage. The single source of truth for the math in requirements §3/§9.
//
// The maths is metric, always. The three formatters at the bottom are the only
// unit-aware things in here, and they delegate to units.js rather than printing
// "kg" themselves — a display concern that happens to live next to the numbers.

import { weightValue, weightLabel, fmtWeight as fmtWeightU, fmtPace as fmtPaceU, paceLabel } from "./units.js";

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// --- Effective weight (requirements §3) ----------------------------------
// barbell / ez_bar : logged value is already the TOTAL bar weight -> effective = logged
// dumbbell_pair    : logged value is PER-HAND -> effective = perHand * 2
// dumbbell_single  : effective = perHand
// cable            : effective = stack value
// bodyweight       : 0 (track reps / time only)
export function effectiveWeight(implement, weightKg) {
  const w = Number(weightKg) || 0;
  switch (implement) {
    case "dumbbell_pair": return w * 2;
    case "bodyweight":    return 0;
    default:              return w; // barbell, ez_bar, dumbbell_single, cable
  }
}

// Volume of a single set. Timed sets (reps == null) contribute 0 volume.
export function setVolume(implement, set) {
  if (set == null || set.reps == null) return 0;
  return effectiveWeight(implement, set.weightKg) * set.reps;
}

export function exerciseVolume(loggedExercise) {
  if (!loggedExercise || !loggedExercise.sets) return 0;
  return loggedExercise.sets.reduce((sum, s) => sum + setVolume(loggedExercise.implement, s), 0);
}

export function sessionVolume(session) {
  if (!session || !session.strengthResult) return 0;
  return session.strengthResult.reduce((sum, ex) => sum + exerciseVolume(ex), 0);
}

// Top-set = the heaviest logged value (per spec: "per-exercise top-set weight").
export function topSetWeight(loggedExercise) {
  if (!loggedExercise || !loggedExercise.sets || !loggedExercise.sets.length) return 0;
  return Math.max(...loggedExercise.sets.map((s) => Number(s.weightKg) || 0));
}

// --- Cardio derived metrics (requirements §9) ----------------------------
// pace in seconds per km
export function paceSecPerKm(cardio) {
  if (!cardio || !cardio.distanceKm || !cardio.timeSeconds) return null;
  return cardio.timeSeconds / cardio.distanceKm;
}

// --- Formatting ----------------------------------------------------------
export function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// Pace stays stored and compared in seconds per km; only the readout converts.
// `withUnit: false` for the many places that show the unit in their own label.
export function fmtPace(secPerKm, { withUnit = true } = {}) {
  return fmtPaceU(secPerKm, undefined, { withUnit });
}
export const paceUnit = () => paceLabel();

// Parse a typed number tolerantly: accept a comma decimal separator (German
// keyboards) and strip stray characters. `<input type="number">` rejects "," so
// we use type="text" inputmode="decimal" + this. Returns 0 if unparseable.
export function parseNum(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).trim().replace(",", ".").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// A stored kg value, read out in the profile's unit. `withUnit: false` for the
// callers that carry the unit in a neighbouring label.
export function fmtWeight(kg, { withUnit = true } = {}) {
  return fmtWeightU(Number(kg) || 0, undefined, { withUnit });
}
export const weightUnit = () => weightLabel();

// Per-set display string, implement-aware. Uses "·" before reps so the only
// "×" is the dumbbell-pair multiplier (e.g. "2×17.5kg · 10", "60kg · 8", "45s").
export function setDisplay(implement, set) {
  if (set == null) return "–";
  if (set.reps == null) return `${set.seconds ?? 0}s`;
  const w = Number(set.weightKg) || 0;
  if (implement === "bodyweight" || (w === 0 && implement !== "cable")) return `BW · ${set.reps}`;
  const shown = `${trim(weightValue(w))}${weightLabel()}`;
  if (implement === "dumbbell_pair") return `2×${shown} · ${set.reps}`;
  return `${shown} · ${set.reps}`;
}

function trim(n) {
  return Number.isInteger(n) ? String(n) : String(n);
}

// --- Dates (local-time, no UTC drift) ------------------------------------
export function todayISO(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// JS getDay(): 0=Sun..6=Sat -> our Mon-first weekday code.
export function weekdayOf(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const idx = new Date(y, m - 1, d).getDay(); // 0=Sun
  return WEEKDAYS[(idx + 6) % 7];
}

// Which program week contains the given date (1-based); clamps to range.
export function weekNumberFor(program, isoDate) {
  const start = new Date(program.startDate + "T00:00:00");
  const day = new Date(isoDate + "T00:00:00");
  const diffDays = Math.floor((day - start) / 86400000);
  const wk = Math.floor(diffDays / 7) + 1;
  return Math.min(Math.max(wk, 1), program.lengthWeeks);
}

// Monday (ISO date) of the program week that contains isoDate.
export function weekStartFor(program, isoDate) {
  const wk = weekNumberFor(program, isoDate);
  const w = (program.weeks || []).find((x) => x.weekNumber === wk);
  return w ? w.startDate : program.startDate;
}

// Which program governs a given calendar date — the block whose range
// [startDate, startDate + lengthWeeks*7) contains it (latest start wins on
// overlap). Pure; used by the month calendar to span blocks. Returns null
// for dates outside every program.
export function programForDate(programs, isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  const inRange = (programs || []).filter((p) => {
    if (!p.startDate || !p.lengthWeeks) return false;
    const s = new Date(p.startDate + "T00:00:00");
    const e = new Date(s); e.setDate(e.getDate() + p.lengthWeeks * 7);
    return d >= s && d < e;
  }).sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  return inRange[0] || null;
}

// What a calendar day IS, given the block that plans it and the session logged
// on it — either of which may be absent, and the two absences mean opposite
// things.
//
// The month grid used to derive everything from the block: no block, no cell.
// That is right for an unplanned future date and wrong for a past one you
// trained, and deleting a block turns the second into the first. Sessions
// outlive blocks on purpose (`deleteProgram` never touches them), so five
// completed days of a deleted six-week block became five blank squares — the
// log intact, unreachable, and indistinguishable from deleted.
//
// A logged day therefore stands on its own: it takes its colour from what was
// actually done rather than what was planned, and it stays openable.
export function dayCellRole(program, planType, session) {
  const orphanDone = !!session && !program;
  return {
    orphanDone,
    kind: orphanDone ? (session.type || "strength") : planType,
    actionable: (!!program && (planType === "cardio" || planType === "strength")) || orphanDone,
  };
}

// --- Energy balance vs the recomp deficit target (programming audit) -----
// balance = calories IN − WHOOP day-burn OUT (negative = in a deficit).
// target = desired daily deficit (positive kcal). Returns a verdict for the
// recomp goal, or null if balance is unknown. Bands are deliberately forgiving
// (day-to-day intake/burn is noisy; it's the trend that matters).
export function energyBalanceVerdict(balance, target = 400) {
  if (balance == null || !Number.isFinite(balance)) return null;
  const deficit = -balance;                       // positive when eating under burn
  const t = Math.max(100, target || 400);
  if (deficit >= t * 0.5 && deficit <= t * 1.6) return { key: "on", label: "On target", color: "var(--accent)" };
  // Deliberate rule: losing faster than planned is never a problem —
  // the recomp scorecard's strength index is the guardrail, not the loss rate.
  if (deficit > t * 1.6)                          return { key: "deep", label: "Ahead of target", color: "var(--accent)" };
  if (deficit > 0)                                return { key: "mild", label: "Slight deficit", color: "var(--cyan)" };
  if (deficit > -150)                             return { key: "maint", label: "Maintenance", color: "var(--text-dim)" };
  return { key: "surplus", label: "Surplus", color: "var(--coral)" };
}

// --- Comparison (requirements §9) ----------------------------------------
// Given a list of prior LoggedExercise occurrences (each {date, exercise}),
// return the most recent one strictly before `beforeDate`.
export function previousOccurrence(occurrences, beforeDate) {
  const earlier = occurrences
    .filter((o) => o.date < beforeDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return earlier.length ? earlier[0] : null;
}

// Strength comparison between current and previous LoggedExercise.
export function compareStrength(implement, current, previous) {
  if (!previous) return null;
  const curVol = exerciseVolume(current), prevVol = exerciseVolume(previous);
  const curTop = topSetWeight(current), prevTop = topSetWeight(previous);
  return {
    volumeDelta: curVol - prevVol,
    topSetDelta: curTop - prevTop,
    improved: curVol > prevVol || curTop > prevTop,
    curVol, prevVol, curTop, prevTop,
  };
}

// Cardio comparison: farther, faster pace, or lower HR = better (requirements §9).
export function compareCardio(current, previous) {
  if (!previous) return null;
  const curPace = paceSecPerKm(current), prevPace = paceSecPerKm(previous);
  return {
    distanceDelta: (current.distanceKm || 0) - (previous.distanceKm || 0),
    timeDelta: (current.timeSeconds || 0) - (previous.timeSeconds || 0),
    paceDelta: curPace != null && prevPace != null ? curPace - prevPace : null, // negative = faster
    hrDelta: (current.avgHR || 0) - (previous.avgHR || 0), // negative = better
    curPace, prevPace,
  };
}

// ---------------------------------------------------------------------------
// The finisher's round count for a given week — THE formula the session player
// runs, exported so any card that previews the finisher can never disagree with
// the player. The week focus texts used to bake these counts into their prose
// ("13 intervals."), where they were wrong on six days out of seven — the count
// belongs to ONE day's template — and would silently drift from the real number
// the moment the template changed. Machine facts come from the machine; prose
// carries what only prose can say.
export function finisherRoundsFor(template, weekNumber) {
  const f = template && template.finisherIntervals;
  if (!f) return null;
  return Math.min(f.baseRounds + ((weekNumber || 1) - 1) * (f.addPerWeek || 0), f.maxRounds || 99);
}

// A reduced week: the finisher defaults to "sit this one out", so preview cards
// stay quiet about it. Same test the session flow applies.
export const isReducedPhase = (phaseName) => /taper|test|deload/i.test(phaseName || "");
