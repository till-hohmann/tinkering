// health/index.js — one interface over every wearable, so the app can be fused
// to WHOOP, fused to Apple Health, or run on nothing at all without any view
// knowing which.
//
// WHY THIS EXISTS. Seven views used to import js/whoop.js directly, which meant
// "does the user have a tracker" was answered seven different ways and adding a
// second one would have meant seven parallel branches. Views now ask the active
// provider for a capability and get either data or null.
//
// THE HARD PART is that trackers do not agree on what they measure, and pretending
// otherwise produces numbers that look comparable and are not:
//
//   - STRAIN is a WHOOP invention: 0-21, logarithmic, proprietary. Apple has no
//     equivalent and never will. So there is no `strain()` in this interface —
//     there is `loadSeries()`, which returns whatever load signal the provider
//     actually has, carrying its own unit and label. WHOOP reports day strain,
//     Apple reports active energy. The ACWR maths (acute:chronic) is identical
//     either way because it is a ratio of a series against itself, which is
//     exactly why it's the right abstraction: the ratio is comparable even when
//     the underlying unit is not.
//
//   - RECOVERY % is likewise a WHOOP score. Apple exposes the inputs (HRV, RHR,
//     sleep) but no score, so the Apple provider computes one against the user's
//     own rolling baseline and flags it `derived: true`. A view can then say
//     "estimated from your HRV and sleep" instead of implying a vendor score.
//
//   - VO2MAX runs the other way: Apple computes and exposes it, WHOOP shows it
//     in-app but has never exposed it via API. So `vo2max()` returns a real
//     number on Apple and null on WHOOP, where manual entry stays the path.
//
//   - ZONE MINUTES are better on Apple, not worse: WHOOP returns time in WHOOP's
//     own six zones, while Apple returns raw HR samples the app can bucket into
//     the user's OWN zones from their profile.
//
// Capabilities are declared, not guessed. A view checks `has(CAP.recovery)`
// before rendering a recovery card; it never calls a method and interprets a
// null as "unsupported", because null also means "offline" and "no data yet".

import * as db from "../db.js";
import { getProfile } from "../profile.js";

export const CAP = {
  recovery: "recovery",         // a readiness score for today
  sleep: "sleep",               // last night's duration / quality
  burn: "burn",                 // calories out per day (BMR + activity)
  workouts: "workouts",         // completed cardio sessions with HR
  body: "body",                 // bodyweight, height, observed max HR
  vo2max: "vo2max",             // cardiorespiratory fitness estimate
  load: "load",                 // a daily training-load series for ACWR
  zoneMinutes: "zoneMinutes",   // time-in-HR-zone per workout
};

// Registry. Keyed by the value stored in profile.tracker.provider.
const LOADERS = {
  whoop: () => import("./whoop.js"),
  apple: () => import("./apple.js"),
  none: () => import("./none.js"),
};

export const PROVIDERS = [
  { id: "none", label: "None", blurb: "Log everything by hand. Every feature still works." },
  { id: "whoop", label: "WHOOP", blurb: "Recovery, sleep, strain and workouts pull in automatically. Needs your own WHOOP developer app." },
  { id: "apple", label: "Apple Health", blurb: "An iPhone Shortcut pushes your metrics on a schedule. Works with Apple Watch, no developer account." },
];

let active = null;
let activeId = null;

// Resolve the provider the profile selects. Cached, because views call this on
// every render and re-importing per call would be wasteful.
export async function provider() {
  const prof = await getProfile();
  const want = (prof && prof.tracker && prof.tracker.provider) || "none";
  if (active && activeId === want) return active;
  const load = LOADERS[want] || LOADERS.none;
  try {
    const mod = await load();
    active = mod.createProvider ? mod.createProvider({ db }) : mod.default;
  } catch (err) {
    console.warn(`health provider "${want}" failed to load; falling back to none`, err);
    active = (await LOADERS.none()).default;
  }
  activeId = want;
  return active;
}

export function resetProviderCache() { active = null; activeId = null; }

// Does the ACTIVE provider support this capability? The one question every view
// should ask before rendering anything tracker-shaped.
export async function has(cap) {
  const p = await provider();
  return !!(p && p.caps && p.caps.includes(cap));
}

// Convenience wrappers so a view never has to null-check the provider itself.
// Each returns the interface's documented empty value on any failure, so a
// tracker being offline degrades to "no data" rather than an exception.
const safe = (fn, empty) => async (...args) => {
  try {
    const p = await provider();
    if (!p || typeof p[fn] !== "function") return empty;
    const v = await p[fn](...args);
    return v === undefined ? empty : v;
  } catch (_) { return empty; }
};

export const status = safe("status", { connected: false });
export const recoveryToday = safe("recoveryToday", null);
export const sleepFor = safe("sleepFor", null);
export const burnFor = safe("burnFor", null);
export const burnByDate = safe("burnByDate", {});
export const workoutsFor = safe("workoutsFor", []);
export const bestWorkoutFor = safe("bestWorkoutFor", null);
export const body = safe("body", null);
export const vo2max = safe("vo2max", null);
export const loadSeries = safe("loadSeries", null);

// --- pulling a tracker's VO2max into the log ---------------------------------
// Apple computes VO2max ("Cardio Fitness") and exposes it; WHOOP never has. The
// app's VO2max trend reads `vo2maxLog`, which was manual-entry only — so an
// Apple user could SEE their number in the tracker panel and still had to retype
// it for it to reach a chart. That's the kind of gap that reads as the feature
// being broken.
//
// Idempotent by construction: the log holds one entry per date, so re-running
// this on every boot either writes the same value again or does nothing.
export async function syncTrackerVO2max() {
  try {
    if (!(await has(CAP.vo2max))) return null;
    const v = await vo2max();
    if (!v || !Number.isFinite(v.value)) return null;
    const { getVO2maxLog, addVO2max } = await import("../store.js");
    const log = await getVO2maxLog();
    const date = v.date || new Date().toISOString().slice(0, 10);
    // Nothing to do if that exact reading is already logged. Worth checking:
    // every write pushes the cloud backup, and the value only moves monthly.
    if (log.some((e) => e.date === date && Math.abs(e.value - v.value) < 0.05)) return null;
    await addVO2max(v.value, date);
    return { value: v.value, date };
  } catch (_) { return null; }        // a tracker being offline is not an error
}

// --- shared load maths -------------------------------------------------------
// ACWR from ANY daily series. Acute = last 7 days' mean, chronic = last 28 days'
// mean, ratio in ~0.8-1.3 is the usual "sweet spot", >1.5 a risky ramp, <0.8
// detraining. Deliberately unit-agnostic: it is a ratio of a series against
// itself, so it reads the same whether the input is WHOOP strain or kilojoules.
//
// The thresholds are a rule of thumb from team-sport literature, not a law —
// which is why callers present this as a trend, not a verdict.
export function acwr(days, { unit, label } = {}) {
  const clean = (days || [])
    .filter((d) => d && d.date && Number.isFinite(d.value))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (clean.length < 7) return { insufficient: true, days: clean.length };
  const vals = clean.map((d) => d.value);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const acute = mean(vals.slice(-7));
  const chronic = mean(vals.slice(-28));
  const ratio = chronic ? acute / chronic : null;
  const flag = ratio == null ? "ok" : ratio > 1.5 ? "high" : ratio < 0.8 ? "low" : "ok";
  return {
    acute: Math.round(acute * 10) / 10,
    chronic: Math.round(chronic * 10) / 10,
    ratio: ratio != null ? Math.round(ratio * 100) / 100 : null,
    flag, days: clean.length, series: vals.slice(-21), unit, label,
  };
}

// Bucket raw HR samples into the USER'S zones. Apple gives samples rather than a
// vendor's zone split, which means the split can be computed against the zones
// in the profile instead of someone else's bands.
// `samples` = [{ t: epochMs, bpm }], returns minutes per zone index 0-5.
export function zoneMinutesFromSamples(samples, bounds) {
  const out = [0, 0, 0, 0, 0, 0];
  if (!samples || samples.length < 2 || !bounds) return out;
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const zoneOf = (bpm) => {
    if (bpm < bounds[0]) return 0;
    for (let z = 1; z <= 5; z++) if (bpm < bounds[z]) return z;
    return 5;
  };
  for (let i = 1; i < sorted.length; i++) {
    const dtMin = (sorted[i].t - sorted[i - 1].t) / 60000;
    // Ignore gaps over 5 minutes — a paused watch shouldn't bank zone time.
    if (dtMin <= 0 || dtMin > 5) continue;
    out[zoneOf(sorted[i - 1].bpm)] += dtMin;
  }
  return out.map((m) => Math.round(m));
}
