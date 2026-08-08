// health/apple.js — the Apple Health adapter.
//
// HOW THIS WORKS, AND WHY IT'S A PUSH.
// A PWA cannot read HealthKit. There is no web API, Safari exposes nothing, and
// Web Bluetooth (the chest-strap fallback) is unsupported on iOS — so there is
// no pull path at all without shipping a native wrapper. Instead an iOS Shortcut
// on the user's phone runs on a schedule, reads the day's samples with Apple's
// own health actions, and POSTs them to their backup Worker's /health-ingest
// route. This module reads that store back.
//
// The consequence to design around: data is as fresh as the last Shortcut run,
// not as fresh as the last API call. So `lastPush` is surfaced in status() and
// the Settings card shows it — a stale bridge must look stale, not look like a
// bad recovery score.
//
// WHAT APPLE GIVES THAT WHOOP DOESN'T: VO2max (Apple computes "Cardio Fitness"
// natively), and raw HR samples, which let zone minutes be bucketed against the
// user's OWN zones rather than a vendor's bands.
//
// WHAT APPLE DOESN'T GIVE: a recovery score. Apple exposes the inputs but no
// verdict. Rather than drop the feature, this provider computes one against the
// user's own rolling baseline and marks it `derived: true` so the UI can say
// where it came from instead of implying a vendor number.

import { resolvedConfig, hasBackup } from "../config.js";
import * as db from "../db.js";
import { CAP, acwr, zoneMinutesFromSamples } from "./index.js";
import { todayISO } from "../model.js";
import { getProfile, resolveZoneBounds } from "../profile.js";

const CACHE_MS = 120000;                 // the phone pushes at most a few times a day
let cache = { at: 0, store: null };

// TWO SOURCES, ONE VIEW.
//   - the LOCAL store, populated by importing an export.zip (history)
//   - the REMOTE store on the backup Worker, populated by the Shortcut (current)
// Merged per date with the remote winning on conflict, because the Shortcut is
// the live feed and an import is a one-off snapshot of the past. Crucially the
// local half works with NO backup configured at all, so someone who just wants
// their history in doesn't have to deploy anything first.
async function fetchStore() {
  if (cache.store && Date.now() - cache.at < CACHE_MS) return cache.store;

  const { getAppleHealthLog } = await import("../store.js");
  let local = {};
  try { local = (await getAppleHealthLog()).byDate || {}; } catch (_) {}

  let remote = {}, lastPush = null;
  const cfg = await resolvedConfig(db);
  if (hasBackup(cfg)) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(cfg.backup.endpoint.replace(/\/+$/, "") + "/health", {
        headers: { Authorization: "Bearer " + cfg.backup.token }, signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        const txt = await res.text();
        if (txt && txt.trim() !== "null") {
          const parsed = JSON.parse(txt);
          remote = (parsed && parsed.byDate) || {};
          lastPush = parsed && parsed.updatedAt;
        }
      }
    } catch (_) { /* offline — the local half still answers */ }
  }

  const dates = new Set([...Object.keys(local), ...Object.keys(remote)]);
  if (!dates.size) return null;
  const byDate = {};
  for (const d of dates) byDate[d] = { ...(local[d] || {}), ...(remote[d] || {}) };
  const store = { byDate, updatedAt: lastPush, hasRemote: !!Object.keys(remote).length,
    hasLocal: !!Object.keys(local).length };
  cache = { at: Date.now(), store };
  return store;
}

export function resetAppleCache() { cache = { at: 0, store: null }; }

const daysOf = (store) => (store && store.byDate) || {};
const dayOf = (store, iso) => daysOf(store)[iso] || null;

// Mean of the last `n` values strictly BEFORE `iso` — the personal baseline a
// derived recovery score is measured against. Excluding the day itself matters:
// otherwise today's reading drags its own baseline toward itself and the score
// flattens to the middle no matter what.
function baseline(store, iso, field, n = 28) {
  const vals = Object.entries(daysOf(store))
    .filter(([d, v]) => d < iso && v && Number.isFinite(v[field]))
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, n)
    .map(([, v]) => v[field]);
  if (vals.length < 5) return null;      // too little history to compare against
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Derive a 0-100 readiness score from HRV, resting HR and sleep against the
// user's own baselines. Weighted toward HRV because it is the most responsive
// of the three to acute stress; RHR inverted (higher = worse); sleep scored
// against a 7.5 h reference rather than a baseline, since a chronically
// under-slept baseline would otherwise normalise itself into looking fine.
//
// This is a heuristic, not a validated instrument, and it is labelled as such
// wherever it surfaces. It exists so an Apple user gets a readiness signal at
// all — the alternative is no autoregulation, which is worse than an imperfect
// one when the whole point is easing loads on a bad day.
export function deriveRecovery(day, bases) {
  if (!day) return null;
  const parts = [];
  if (Number.isFinite(day.hrv) && bases.hrv) {
    const r = day.hrv / bases.hrv;                       // 1.0 = at baseline
    parts.push({ w: 0.5, s: clamp01((r - 0.7) / 0.5) }); // 0.7x -> 0, 1.2x -> 1
  }
  if (Number.isFinite(day.restingHR) && bases.rhr) {
    const r = day.restingHR / bases.rhr;                 // lower is better
    parts.push({ w: 0.3, s: clamp01((1.1 - r) / 0.2) }); // 1.1x -> 0, 0.9x -> 1
  }
  if (Number.isFinite(day.sleepHours)) {
    parts.push({ w: 0.2, s: clamp01((day.sleepHours - 4.5) / 3) });  // 4.5h -> 0, 7.5h -> 1
  }
  if (!parts.length) return null;
  const wsum = parts.reduce((a, p) => a + p.w, 0);
  const score = parts.reduce((a, p) => a + p.w * p.s, 0) / wsum;
  return Math.round(score * 100);
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));

const provider = {
  id: "apple",
  label: "Apple Health",

  // Everything WHOOP has except its proprietary scores, PLUS vo2max.
  caps: [CAP.recovery, CAP.sleep, CAP.burn, CAP.workouts, CAP.body, CAP.load, CAP.vo2max, CAP.zoneMinutes],

  async status() {
    const store = await fetchStore();
    const cfg = await resolvedConfig(db);
    const dates = store ? Object.keys(daysOf(store)).sort() : [];

    if (!dates.length) {
      // Nothing at all yet. Which advice to give depends on whether the live
      // bridge is even possible — importing history works with no backend, so
      // "set up a Worker first" would be wrong for someone who only wants that.
      return { connected: false, unconfigured: true,
        detail: hasBackup(cfg)
          ? "No data yet. Import your Health export for history, or install the Shortcut to stay current."
          : "Import your Health export to load your history. For a live daily feed you'll also need the Cloud backup below." };
    }

    const last = dates[dates.length - 1];
    const staleDays = Math.round((Date.parse(todayISO()) - Date.parse(last)) / 86400000);
    // "Stale" only means anything when a LIVE feed is expected. History imported
    // from an export is old by definition, and flagging it as stale would be
    // telling the user something is broken when nothing is.
    const expectsLive = !!store.hasRemote;
    return {
      connected: true,
      days: dates.length,
      lastPush: expectsLive ? last : null,
      importedThrough: store.hasLocal ? last : null,
      sources: [store.hasLocal ? "import" : null, store.hasRemote ? "shortcut" : null].filter(Boolean),
      // A Shortcut that stopped firing is the main failure mode, and it's silent,
      // so say so rather than serving three-week-old numbers as today's.
      stale: expectsLive && staleDays > 2,
      staleDays: expectsLive ? staleDays : null,
    };
  },

  async connect() {
    throw new Error("Apple Health connects by installing the Shortcut — see Settings.");
  },
  async disconnect() { resetAppleCache(); },

  async recoveryToday() {
    const store = await fetchStore();
    if (!store) return null;
    const iso = todayISO();
    const day = dayOf(store, iso) || dayOf(store, prevISO(iso));
    if (!day) return null;
    const bases = {
      hrv: baseline(store, iso, "hrv"),
      rhr: baseline(store, iso, "restingHR"),
    };
    const pct = deriveRecovery(day, bases);
    if (pct == null) return null;
    return {
      recoveryPct: pct,
      restingHR: Number.isFinite(day.restingHR) ? Math.round(day.restingHR) : null,
      hrv: Number.isFinite(day.hrv) ? Math.round(day.hrv) : null,
      derived: true,
      source: "Apple Health",
      basis: bases.hrv ? "vs your 28-day HRV and resting-HR baseline" : "from sleep only",
    };
  },

  async sleepFor(iso) {
    const store = await fetchStore();
    const day = store && (dayOf(store, iso || todayISO()) || dayOf(store, prevISO(iso || todayISO())));
    if (!day || !Number.isFinite(day.sleepHours)) return null;
    return {
      hours: Math.round(day.sleepHours * 10) / 10,
      // Apple has no "sleep performance" score; express it against a 8 h need so
      // the readiness auto-fill has the same 0-100 shape it expects.
      performancePct: Math.round(clamp01(day.sleepHours / 8) * 100),
      efficiencyPct: null,
    };
  },

  // Apple splits energy into active and basal; the sum is the equivalent of
  // WHOOP's whole-cycle burn. Falls back to active-only (clearly an undercount)
  // when basal is missing, since some Shortcut setups omit it.
  async burnFor(iso) {
    const store = await fetchStore();
    const day = store && dayOf(store, iso || todayISO());
    if (!day) return null;
    const a = Number(day.activeKcal), b = Number(day.basalKcal);
    if (!Number.isFinite(a) && !Number.isFinite(b)) return null;
    return Math.round((Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0));
  },

  async burnByDate() {
    const store = await fetchStore();
    const out = {};
    for (const [iso, d] of Object.entries(daysOf(store))) {
      const a = Number(d.activeKcal), b = Number(d.basalKcal);
      if (Number.isFinite(a) || Number.isFinite(b)) {
        out[iso] = Math.round((Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0));
      }
    }
    return out;
  },

  async workoutsFor(iso) {
    const store = await fetchStore();
    const day = store && dayOf(store, iso);
    const list = (day && day.workouts) || [];
    const bounds = resolveZoneBounds(await getProfile());
    return list.map((w) => normaliseWorkout(w, bounds)).filter(Boolean);
  },

  async bestWorkoutFor(iso) {
    const all = await this.workoutsFor(iso);
    if (!all.length) return null;
    const cardioish = all.filter((w) => /run|walk|cycl|elliptical|row|hiit|interval|hike/i.test(w.sport || ""));
    const pool = cardioish.length ? cardioish : all;
    return pool.sort((a, b) => (b.distanceKm || 0) - (a.distanceKm || 0) || (b.timeSeconds || 0) - (a.timeSeconds || 0))[0];
  },

  async body() {
    const store = await fetchStore();
    if (!store) return null;
    const dates = Object.keys(daysOf(store)).sort().reverse();
    for (const d of dates) {
      const day = daysOf(store)[d];
      if (Number.isFinite(day.weightKg)) {
        return {
          weightKg: Math.round(day.weightKg * 10) / 10,
          heightM: Number.isFinite(day.heightM) ? day.heightM : null,
          // Apple records observed max HR per workout, not a stored profile
          // value, so this is the highest seen recently rather than a true max.
          maxHR: Number.isFinite(day.maxHR) ? Math.round(day.maxHR) : null,
        };
      }
    }
    return null;
  },

  // The one thing Apple has and WHOOP doesn't.
  async vo2max() {
    const store = await fetchStore();
    if (!store) return null;
    const dates = Object.keys(daysOf(store)).sort().reverse();
    for (const d of dates) {
      const v = daysOf(store)[d].vo2max;
      if (Number.isFinite(v)) return { value: Math.round(v * 10) / 10, date: d };
    }
    return null;
  },

  // Load from active energy. Not comparable to WHOOP strain in absolute terms —
  // which is exactly why acwr() carries the unit label through to the UI.
  async loadSeries() {
    const store = await fetchStore();
    if (!store) return null;
    const days = Object.entries(daysOf(store))
      .filter(([, d]) => Number.isFinite(d.activeKcal))
      .map(([date, d]) => ({ date, value: d.activeKcal }));
    return acwr(days, { unit: "kcal", label: "Active energy" });
  },
};

// The Shortcut's workout shape -> the app's cardio shape. Tolerant about field
// names because Shortcut authors rename things, and a slightly different export
// shouldn't silently produce zero workouts.
function normaliseWorkout(w, bounds) {
  if (!w) return null;
  const num = (...keys) => {
    for (const k of keys) if (Number.isFinite(Number(w[k]))) return Number(w[k]);
    return null;
  };
  const seconds = num("durationSeconds", "duration", "timeSeconds");
  const meters = num("distanceMeters", "distance_meter");
  const km = num("distanceKm") != null ? num("distanceKm") : (meters != null ? meters / 1000 : null);
  const samples = Array.isArray(w.hrSamples) ? w.hrSamples : null;
  return {
    sport: w.type || w.sport || w.workoutType || null,
    start: w.start || null, end: w.end || null,
    timeSeconds: seconds != null ? Math.round(seconds) : null,
    distanceKm: km != null ? Math.round(km * 100) / 100 : null,
    avgHR: num("avgHR", "averageHeartRate"),
    maxHR: num("maxHR", "maxHeartRate"),
    kcal: num("activeKcal", "kcal", "calories"),
    strain: null,                                  // no Apple equivalent
    // Zone minutes against the USER'S zones when raw samples came through;
    // otherwise null, so a view shows "no zone data" rather than six zeroes.
    zoneMins: samples && bounds ? zoneMinutesFromSamples(samples, bounds) : null,
    source: "apple",
  };
}

function prevISO(iso) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default provider;
export const createProvider = () => provider;
