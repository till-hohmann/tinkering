// whoop.js — client for the strong-whoop OAuth broker/proxy. Talks to the Worker
// with a device-local `linkId` generated once and stored ONLY on this device
// (never in the deployed code, never synced to the training-log cloud). The
// Worker holds the WHOOP tokens; this module only ever handles the linkId and the
// data it explicitly requests. Every call is best-effort + offline-safe.

import * as db from "./db.js";
import { resolvedConfig, hasWhoop } from "./config.js";

// The broker's URL comes from config (build-time overlay or the Settings screen),
// never from source — WHOOP caps unapproved developer apps to a small number of
// users, so there is no shared instance to borrow: everyone runs their own.
// Null when unconfigured, and every call below turns into a clean no-op.
async function endpoint() {
  const cfg = await resolvedConfig(db);
  return hasWhoop(cfg) ? cfg.whoop.endpoint : null;
}
export async function whoopConfigured() { return !!(await endpoint()); }

// The device link credential: high-entropy, created on first use, device-local.
async function linkId() {
  let id = await db.getPref("whoopLinkId");
  if (!id) {
    const a = new Uint8Array(32); crypto.getRandomValues(a);
    id = btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await db.setPref("whoopLinkId", id);
  }
  return id;
}
const authHeader = async () => ({ Authorization: "Bearer " + (await linkId()) });

async function req(path, { method = "GET", params, timeoutMs = 9000 } = {}) {
  const base = await endpoint();
  if (!base) throw new Error("WHOOP is not configured");
  const u = new URL(base + path);
  if (params) for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(u, { method, headers: await authHeader(), signal: ctrl.signal });
    return r;
  } finally { clearTimeout(t); }
}

// --- connection ----------------------------------------------------------
export async function whoopStatus() {
  if (!(await endpoint())) return { connected: false, unconfigured: true };
  try {
    const r = await req("/status", { timeoutMs: 5000 });
    if (!r.ok) return { connected: false };
    return await r.json();
  } catch { return { connected: false, offline: true }; }
}

export async function whoopConnect() {
  const r = await req("/auth/start", { method: "POST" });
  if (!r.ok) throw new Error("Could not start WHOOP sign-in (" + r.status + ")");
  const { authorizeUrl } = await r.json();
  if (!authorizeUrl) throw new Error("No authorize URL returned");
  window.location.href = authorizeUrl;   // → WHOOP consent → worker callback → back to the app
}

export async function whoopDisconnect() {
  try { await req("/disconnect", { method: "POST" }); } catch { /* offline */ }
}

// --- data ----------------------------------------------------------------
async function getRecords(path, params) {
  const r = await req(path, { params });
  if (!r.ok) throw new Error("WHOOP request failed (" + r.status + ")");
  const data = await r.json();
  return data.records || [];
}
export const whoopWorkouts = (p = {}) => getRecords("/workouts", { limit: 10, ...p });
export const whoopRecovery = (p = {}) => getRecords("/recovery", { limit: 1, ...p });
export const whoopSleep = (p = {}) => getRecords("/sleep", { limit: 1, ...p });
export const whoopCycles = (p = {}) => getRecords("/cycle", { limit: 25, ...p });

// Paginate cycles to gather up to `max` days of history. WHOOP caps `limit` at
// 25 per page (a limit of 30 is rejected outright), so multi-week history must
// be fetched page-by-page via next_token.
export async function whoopCyclesAll(max = 60) {
  let out = [], token = null;
  for (let i = 0; i < 6 && out.length < max; i++) {
    const params = { limit: 25 };
    if (token) params.nextToken = token;
    const r = await req("/cycle", { params });
    if (!r.ok) break;
    const data = await r.json().catch(() => ({}));
    const recs = data.records || [];
    out = out.concat(recs);
    token = data.next_token;
    if (!token || !recs.length) break;
  }
  return out.slice(0, max);
}

// Body measurement is a single object (not a collection): height/weight/max HR.
export async function whoopBody() {
  const r = await req("/body");
  if (!r.ok) throw new Error("WHOOP request failed (" + r.status + ")");
  return r.json();
}
export function mapBody(b) {
  if (!b) return null;
  return {
    weightKg: b.weight_kilogram != null ? Math.round(b.weight_kilogram * 10) / 10 : null,
    heightM: b.height_meter != null ? b.height_meter : null,
    maxHR: b.max_heart_rate != null ? Math.round(b.max_heart_rate) : null,
  };
}

// --- mappers (WHOOP shapes → the app's fields) ---------------------------
// Workout → cardio result + per-zone minutes (zone_zero..zone_five = WHOOP Z0-Z5).
export function mapWorkout(w) {
  const s = w && w.score; if (!s) return null;
  const start = w.start ? Date.parse(w.start) : null;
  const end = w.end ? Date.parse(w.end) : null;
  const zd = s.zone_durations || s.zone_duration || {};
  const zoneMins = [
    zd.zone_zero_milli, zd.zone_one_milli, zd.zone_two_milli,
    zd.zone_three_milli, zd.zone_four_milli, zd.zone_five_milli,
  ].map((ms) => Math.round((ms || 0) / 60000));
  return {
    sport: w.sport_name || null,
    start: w.start, end: w.end,
    timeSeconds: start && end ? Math.round((end - start) / 1000) : null,
    distanceKm: s.distance_meter != null ? Math.round(s.distance_meter / 10) / 100 : null,
    avgHR: s.average_heart_rate != null ? Math.round(s.average_heart_rate) : null,
    maxHR: s.max_heart_rate != null ? Math.round(s.max_heart_rate) : null,
    strain: s.strain != null ? Math.round(s.strain * 10) / 10 : null,
    zoneMins,
  };
}

// Pick the WHOOP workout that best matches a session: a run/cardio activity on
// the given ISO date, preferring one with distance + the longest duration.
export function bestWorkoutFor(workouts, iso) {
  const sameDay = (workouts || []).filter((w) => (w.start || "").slice(0, 10) === iso && w.score);
  if (!sameDay.length) return null;
  const cardioish = sameDay.filter((w) => /run|jog|walk|cardio|elliptical|cycl|row|hiit|interval/i.test(w.sport_name || ""));
  const pool = cardioish.length ? cardioish : sameDay;
  return pool.sort((a, b) => {
    const da = (a.score.distance_meter || 0), db_ = (b.score.distance_meter || 0);
    if (db_ !== da) return db_ - da;
    return Date.parse(b.start) - Date.parse(a.start);
  })[0];
}

// Recovery record → {recoveryPct, restingHR, hrv}.
export function mapRecovery(rec) {
  const s = rec && rec.score; if (!s) return null;
  return {
    recoveryPct: s.recovery_score != null ? Math.round(s.recovery_score) : null,
    restingHR: s.resting_heart_rate != null ? Math.round(s.resting_heart_rate) : null,
    hrv: s.hrv_rmssd_milli != null ? Math.round(s.hrv_rmssd_milli) : null,
  };
}

// Sleep record → {hours, performancePct, efficiencyPct}.
export function mapSleep(rec) {
  const s = rec && rec.score; if (!s) return null;
  const ss = s.stage_summary || {};
  const asleepMs = Math.max(0, (ss.total_in_bed_time_milli || 0) - (ss.total_awake_time_milli || 0));
  return {
    hours: asleepMs ? Math.round(asleepMs / 360000) / 10 : null,
    performancePct: s.sleep_performance_percentage != null ? Math.round(s.sleep_performance_percentage) : null,
    efficiencyPct: s.sleep_efficiency_percentage != null ? Math.round(s.sleep_efficiency_percentage) : null,
  };
}

// Cycle (a physiological day) → {date, strain, avgHR, kj, kcal}.
// kcal = the day's total energy burn (BMR + activity) = "calories out".
export const kcalFromKj = (kj) => (kj == null ? null : Math.round(kj / 4.184));

// Local calendar date of a WHOOP timestamp. WHOOP returns `start` in UTC plus a
// `timezone_offset` (e.g. "+02:00"); slicing the raw UTC string gives the wrong
// day near midnight, so we apply the offset and read the local date. This is the
// date the user (and todayISO / the nutrition log) think in.
export function localDateOf(startUTC, tzOffset) {
  if (!startUTC) return "";
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tzOffset || "");
  const base = Date.parse(startUTC);
  if (!m || Number.isNaN(base)) return String(startUTC).slice(0, 10);
  const offMin = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  const d = new Date(base + offMin * 60000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export function mapCycle(c) {
  const s = c && c.score;
  const kj = s && s.kilojoule != null ? Math.round(s.kilojoule) : null;
  return {
    date: localDateOf(c && c.start, c && c.timezone_offset),
    start: (c && c.start) || null,
    strain: s && s.strain != null ? Math.round(s.strain * 10) / 10 : null,
    avgHR: s && s.average_heart_rate != null ? Math.round(s.average_heart_rate) : null,
    kj, kcal: kcalFromKj(kj),
  };
}

// date → calories-burned map from mapped cycles (for energy balance / trends).
export function burnByDate(cycles) {
  const out = {};
  for (const c of cycles || []) if (c.date && c.kcal != null) out[c.date] = c.kcal;
  return out;
}

// Calories burned on a given LOCAL date (today's burn for the Fuel card). Reads
// the WHOOP cycle whose local calendar date matches `iso`. Returns kcal or null
// when WHOOP hasn't scored that cycle yet (so the card shows "–", not stale data).
export async function whoopBurnFor(iso) {
  const todays = (await whoopCycles({ limit: 8 })).map(mapCycle).filter((c) => c.date === iso && c.kcal != null);
  return todays.length ? Math.max(...todays.map((c) => c.kcal)) : null;
}

// ACWR-style training-load read from daily WHOOP strain. `cycles` = mapped cycles
// (any order). Acute = last 7 days' avg day-strain, chronic = last 28 days' avg;
// ratio in ~0.8-1.3 is the "sweet spot", >1.5 a risky ramp, <0.8 detraining.
// (WHOOP strain is a 0-21 logarithmic scale, so treat this as a trend, not gospel.)
export function loadFromCycles(cycles) {
  const days = (cycles || []).filter((c) => c.date && c.strain != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (days.length < 7) return { insufficient: true, days: days.length };
  const strains = days.map((d) => d.strain);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const acute = avg(strains.slice(-7));
  const chronic = avg(strains.slice(-28));
  const ratio = chronic ? acute / chronic : null;
  let flag = "ok";
  if (ratio != null) flag = ratio > 1.5 ? "high" : ratio < 0.8 ? "low" : "ok";
  return { acute: Math.round(acute * 10) / 10, chronic: Math.round(chronic * 10) / 10,
    ratio: ratio != null ? Math.round(ratio * 100) / 100 : null, flag,
    days: days.length, series: strains.slice(-21) };
}

// Build a WHOOP-AI-ready text export from a logged strength session, so WHOOP can
// recalculate the session's strain/muscular load from the exercises you actually
// did. `nameOf(id)` resolves an exercise id → display name.
export function strengthExportText(session, nameOf) {
  const lines = ["Weightlifting session" + (session && session.date ? " — " + session.date : "") + ":"];
  for (const ex of (session && session.strengthResult) || []) {
    const sets = ex.sets || [];
    if (!sets.length) continue;
    const parts = sets.map((s) => {
      const w = Number(s.weightKg) || 0;
      if (s.reps == null) return s.seconds ? `${s.seconds}s hold` : null;   // timed core
      return w > 0 ? `${w}kg x ${s.reps}` : `bodyweight x ${s.reps}`;
    }).filter(Boolean);
    if (parts.length) lines.push(`- ${nameOf(ex.exerciseId)}: ${parts.join(", ")}`);
  }
  return lines.join("\n");
}
