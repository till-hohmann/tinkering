// store.js — app-level data access on top of db.js: seeding, programs,
// sessions, and the comparison queries from requirements §9.

import * as db from "./db.js";
import { weekdayOf, weekNumberFor, previousOccurrence, todayISO } from "./model.js";
import { cloudPushDebounced } from "./cloudsync.js";
import { DEFAULT_ZONE_BOUNDS, maxHRof } from "./cardio-intel.js";

// User settings that ride along with the cloud/file backup (NOT the device-local
// seeding bookkeeping like programVersion/seedVersion — those must stay local).
// NOTE: "deploymentConfig" is deliberately absent. It holds the backup endpoint
// and its bearer token, i.e. a credential for this very sync channel — syncing
// it through the service it unlocks would be circular, and it would put a
// working key into every export file. It stays device-local, always.
export const SYNCED_PREFS = ["profile", "zoneBounds", "vo2maxLog", "nutritionLog", "bodyweightKg", "proteinPerKg", "deficitTarget", "measurementsLog", "dexaLog", "weightLog", "mobilityLog", "mobilityProg"];
export async function syncedPrefs() {
  const out = {};
  for (const k of SYNCED_PREFS) { const v = await db.getPref(k); if (v !== undefined) out[k] = v; }
  return out;
}
// Apply backed-up prefs. add-missing by default (durability: a wiped device adopts
// the cloud value, but a local choice is never clobbered); overwrite on an explicit
// file restore.
async function restorePrefs(prefs, { overwrite = false } = {}) {
  if (!prefs) return;
  let touchedProfile = false;
  for (const k of SYNCED_PREFS) {
    if (prefs[k] === undefined) continue;
    if (overwrite || (await db.getPref(k)) === undefined) { await db.setPref(k, prefs[k]); touchedProfile ||= k === "profile"; }
  }
  // The profile is written straight to the pref store here, behind profile.js's
  // back. Without this its in-memory copy — and the display units derived from
  // it — would keep serving the pre-restore values until the next cold start.
  if (touchedProfile) (await import("./profile.js")).clearProfileCache();
}

// Full local state for the cloud backup (programs + sessions + synced settings).
export async function snapshot() {
  return { kind: "strong-backup", exportedAt: new Date().toISOString(),
    programs: await db.getAll("programs"), sessions: await db.getAll("sessions"),
    prefs: await syncedPrefs() };
}
const pushCloud = () => cloudPushDebounced(snapshot);

// Non-destructive restore from a cloud/backup snapshot: add programs/sessions we
// don't already have and adopt any missing settings; NEVER overwrite local data.
// Returns count of new sessions.
export async function mergeRestore(data) {
  if (!data) return 0;
  for (const p of data.programs || []) {
    if (!(await db.get("programs", p.id))) await db.put("programs", p);
  }
  let added = 0;
  if (data.sessions && data.sessions.length) {
    const have = new Set((await db.getAll("sessions")).map((s) => s.id));
    for (const s of data.sessions) if (s && s.id && !have.has(s.id)) { await db.put("sessions", s); added++; }
  }
  await restorePrefs(data.prefs);
  return added;
}

// --- First-run seeding ---------------------------------------------------
// Program always seeds from the committed plan. Seed sessions auto-load from
// data/seed-sessions.json when it's deployed. Bump SEED_VERSION whenever the
// seed data changes so installed devices re-seed.
//
// Two important guards (both were bugs before):
//  - only mark seeded AFTER sessions actually load, so a missing file retries
//    on the next launch instead of permanently flagging the device "seeded".
//  - reject the SPA index.html fallback (a 404 returns the app shell with a 200
//    status), so we never try to JSON-parse HTML.
const PROGRAM_VERSION = 18;  // bump when any data/program-N.json (the plans) change
const SEED_VERSION = 5;      // bump when data/seed-sessions.json changes
// All shipped program plans, in chronological block order. The app stores them
// all and resolves which one is active by date (see getActiveProgram). Blocks 3-5
// are empty "shell" blocks (draft:true) — the phase intent shows in the plan; the
// real daily plan for each is built at its handoff, off fresh data.
const PROGRAM_FILES = ["program-1.json", "program-2.json", "program-3.json", "program-4.json", "program-5.json"];

export async function seedIfNeeded() {
  const programs = await db.getAll("programs");
  // (re)import the program plans on first run AND whenever PROGRAM_VERSION bumps,
  // so corrections to future weeks/blocks reach devices that already have a copy.
  const progV = await db.getPref("programVersion");
  if (!programs.length || progV !== PROGRAM_VERSION) {
    let loadedAny = false, firstId = null;
    for (const file of PROGRAM_FILES) {
      try {
        const res = await fetch(`./data/${file}?v=` + PROGRAM_VERSION);
        if (!res.ok) continue;
        const text = await res.text();
        if (!text.trim().startsWith("{")) continue;       // reject the SPA fallback HTML
        const { program } = JSON.parse(text);
        if (program && program.id) {
          await db.put("programs", program);              // upsert by id
          loadedAny = true;
          if (!firstId) firstId = program.id;
        }
      } catch (_) { /* file not reachable yet — skip, retries next launch */ }
    }
    if (loadedAny) {
      // first run only: point the legacy active pointer at the first block.
      // Selection is auto-by-date by default (pref unset == auto), so this is
      // just a fallback; later blocks take over on their start date.
      if (!programs.length && firstId) await db.setPref("activeProgramId", firstId);
      await db.setPref("programVersion", PROGRAM_VERSION);
    }
    // NO program files and none stored is the NORMAL state for a fresh public
    // install — nothing ships with a plan any more. This used to throw, which
    // meant the very first boot of an empty app died on an error screen instead
    // of reaching the builder. The caller checks for a null active program and
    // routes to the builder instead.
  }
  const seededV = await db.getPref("seedVersion");
  if (seededV !== SEED_VERSION) {
    try {
      const res = await fetch("./data/seed-sessions.json?v=" + SEED_VERSION);
      if (res.ok) {
        const text = await res.text();
        if (text.trim().startsWith("{")) {           // real JSON, not the SPA fallback
          const { sessions } = JSON.parse(text);
          if (sessions && sessions.length) {
            // NON-DESTRUCTIVE restore: only add sessions we don't already have,
            // so re-seeding (after a storage wipe, or on a version bump) can never
            // overwrite or clobber locally-logged/edited data.
            const existing = await db.getAll("sessions");
            const have = new Set(existing.map((s) => s.id));
            const fresh = sessions.filter((s) => !have.has(s.id));
            if (fresh.length) await db.putAll("sessions", fresh);
            await db.setPref("seedVersion", SEED_VERSION);
          }
        }
      }
    } catch (_) {
      /* file not reachable yet — leave unseeded so it retries next launch */
    }
  }
}

// --- Programs ------------------------------------------------------------
// True if `isoDate`/today falls within a program's calendar range
// [startDate, startDate + lengthWeeks*7) — the exclusive end.
function isDateCurrent(p, todayDate) {
  if (!p || !p.startDate || !p.lengthWeeks) return false;
  const start = new Date(p.startDate + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + p.lengthWeeks * 7);
  return todayDate >= start && todayDate < end;
}

// Resolve the active program. Default = AUTOMATIC by date, so a later block
// (e.g. Block 2 on 2026-08-03) takes over on its start date with fresh
// within-program comparisons. A manual override (autoSelectProgram === false)
// pins a chosen program regardless of date — for running a block ahead/behind.
export async function getActiveProgram() {
  const all = await db.getAll("programs");
  if (!all.length) return null;
  const today = new Date(todayISO() + "T00:00:00");

  const auto = await db.getPref("autoSelectProgram");   // undefined == auto
  if (auto === false) {
    const id = await db.getPref("activeProgramId");
    const pinned = id && all.find((p) => p.id === id);
    if (pinned) return pinned;
    // pinned program missing — fall through to automatic
  }

  // the block whose calendar range contains today (latest start wins on overlap)
  const current = all.filter((p) => isDateCurrent(p, today))
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  if (current.length) return current[0];

  // fallbacks: status active → nearest upcoming → most recent past → first
  const byStatus = all.find((p) => p.status === "active");
  if (byStatus) return byStatus;
  const upcoming = all.filter((p) => p.startDate && new Date(p.startDate + "T00:00:00") > today)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  if (upcoming.length) return upcoming[0];
  const past = all.filter((p) => p.startDate).sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  return past[0] || all[0];
}

// Program-selection mode for the Settings UI. auto=true means resolve by date.
export async function getSelectionMode() {
  const auto = await db.getPref("autoSelectProgram");
  const activeId = await db.getPref("activeProgramId");
  return { auto: auto !== false, activeId };
}
// Pin a specific program (manual override, ignores date).
export async function setActiveProgramManual(id) {
  await db.setPref("activeProgramId", id);
  await db.setPref("autoSelectProgram", false);
}
// Back to automatic by-date selection.
export async function setAutoProgram() {
  await db.setPref("autoSelectProgram", true);
}

export const getAllPrograms = () => db.getAll("programs");
export const getProgram = (id) => db.get("programs", id);

// The equipment the engines should load against: the user's own places first,
// the program's shipped equipmentProfile as the fallback. Every caller that used
// to read `program.equipmentProfile` directly goes through here, so someone
// running an imported program at their own gym gets THEIR racks, not the
// program author's.
export async function equipmentForProgram(program) {
  const { getProfile, equipmentFor } = await import("./profile.js");
  return equipmentFor(await getProfile(), program);
}

export async function importProgram(program, makeActive = true) {
  await db.put("programs", program);
  if (makeActive) {
    // demote previously active to allow only one active comparison set
    const all = await db.getAll("programs");
    for (const p of all) {
      if (p.id !== program.id && p.status === "active") {
        p.status = "archived";
        await db.put("programs", p);
      }
    }
    program.status = "active";
    await db.put("programs", program);
    await db.setPref("activeProgramId", program.id);
    await db.setPref("autoSelectProgram", false);   // explicit import pins it
  }
  pushCloud();
}

// Restore a backup file (programs + sessions) into the DB (requirements §10).
export async function restoreBackup(data) {
  if (data.programs) for (const p of data.programs) await db.put("programs", p);
  if (data.sessions && data.sessions.length) await db.putAll("sessions", data.sessions);
  if (data.programs && data.programs.length) {
    const active = data.programs.find((p) => p.status === "active") || data.programs[0];
    await db.setPref("activeProgramId", active.id);
    await db.setPref("autoSelectProgram", false);   // restored state pins the active program
  }
  await restorePrefs(data.prefs, { overwrite: true });   // explicit restore adopts saved settings
  pushCloud();
}

// --- supplemental mobility routine (Wed/Fri/Sun) completion log --------------
// Cloud-synced via SYNCED_PREFS ("mobilityLog"). Entries are { date, key }
// (key = which session: A/B/C — so a session done on a different day keeps its
// identity); early v123 entries were plain ISO strings, normalised on read.
const normMob = (e) => (typeof e === "string" ? { date: e } : e);
export async function getMobilityLog() { return ((await db.getPref("mobilityLog")) || []).map(normMob); }
// REPLACES any existing entry for the same date — a redo overwrites the
// accidental completion instead of being silently ignored.
export async function addMobilityDone(iso, key, holds, eased) {
  const raw = ((await db.getPref("mobilityLog")) || []).filter((e) => normMob(e).date !== iso);
  raw.push({ date: iso, key, ...(holds && holds.length ? { holds } : {}), ...(eased ? { eased: true } : {}) });
  raw.sort((a, b) => (normMob(a).date < normMob(b).date ? -1 : 1));
  await db.setPref("mobilityLog", raw); pushCloud();
}
export async function removeMobilityDone(iso) {
  const raw = ((await db.getPref("mobilityLog")) || []).filter((e) => normMob(e).date !== iso);
  await db.setPref("mobilityLog", raw); pushCloud();
}
export async function mobilityEntryOn(iso) { return (await getMobilityLog()).find((e) => e.date === iso) || null; }
export async function mobilityDoneOn(iso) { return (await getMobilityLog()).some((e) => e.date === iso); }
export async function mobilityDoneDates() { return new Set((await getMobilityLog()).map((e) => e.date)); }
// Per-exercise hold-progression state (target seconds, streak, variant level) —
// consumed/advanced by mobility.js applyHoldResults after each tracked session.
export async function getMobilityProg() { return (await db.getPref("mobilityProg")) || {}; }
export async function setMobilityProg(state) { await db.setPref("mobilityProg", state || {}); pushCloud(); }

// --- Apple Health, imported locally ---------------------------------------
// The Shortcuts bridge posts to the backup Worker; this is the same shape held
// on-device, for history imported from an export.zip. Kept LOCAL and unsynced:
// it can be a few hundred KB, it is losslessly re-derivable from the export file
// the user still has, and pushing it through the training-log backup would bloat
// every snapshot for data the provider merges anyway.
export async function getAppleHealthLog() {
  const v = await db.getPref("appleHealthLog");
  return (v && v.byDate) ? v : { byDate: {} };
}
// Merge by date, field by field: a later import fills gaps without discarding
// anything the Shortcut has since pushed for the same day.
export async function mergeAppleHealthLog(byDate) {
  const cur = await getAppleHealthLog();
  const out = { ...cur.byDate };
  let added = 0, updated = 0;
  for (const [d, rec] of Object.entries(byDate || {})) {
    if (out[d]) { out[d] = { ...out[d], ...rec }; updated++; }
    else { out[d] = rec; added++; }
  }
  // Bound it the same way the Worker does — two years is far more than any view
  // reads, and an unbounded pref is how IndexedDB quota errors start.
  const dates = Object.keys(out).sort();
  for (const stale of dates.slice(0, Math.max(0, dates.length - 800))) delete out[stale];
  await db.setPref("appleHealthLog", { byDate: out, importedAt: todayISO() });
  return { added, updated, total: Object.keys(out).length };
}
export async function clearAppleHealthLog() { await db.setPref("appleHealthLog", { byDate: {} }); }

export const setLastExport = (iso) => db.setPref("lastExport", iso);
export const getLastExport = () => db.getPref("lastExport");

// Remember the location chosen for a date, so a second session the same day
// pre-selects it (you're almost always in one city per day).
export const setLastLocation = (date, location) => db.setPref("lastLocation", { date, location });
export const getLastLocation = () => db.getPref("lastLocation");

// In-progress workout draft — persisted as each exercise/phase completes so an
// interrupted session (a call, an app reload, navigating away) isn't lost. The
// session restores it on re-entry; cleared on save or explicit discard. Device-
// local only (NOT synced — it's transient in-progress state, not a record).
export const getDraft = () => db.getPref("activeDraft");
export const setDraft = (d) => db.setPref("activeDraft", d || null);
export const clearDraft = () => db.setPref("activeDraft", null);

// Heart-rate zones — explicit and editable (see cardio-intel.js).
// Stored as 6 numbers [Z1floor, Z2floor, Z3floor, Z4floor, Z5floor, maxHR].
//
// Resolution order, most-specific first:
//   1. the profile's explicit zoneBounds (the user edited them, or matched them
//      to a tracker's own bands)
//   2. zones derived from the profile's max HR — itself either explicit or
//      estimated from age
//   3. the legacy top-level "zoneBounds" pref, for installs that predate the
//      profile and haven't migrated yet
//   4. a labelled placeholder, so charts render instead of crashing
export async function getZoneBounds() {
  const { getProfile, resolveZoneBounds } = await import("./profile.js");
  const prof = await getProfile();
  const resolved = prof && resolveZoneBounds(prof);
  if (resolved) return resolved;
  const v = await db.getPref("zoneBounds");
  return Array.isArray(v) && v.length === 6 && v.every((n) => Number.isFinite(n))
    ? v.slice() : DEFAULT_ZONE_BOUNDS.slice();
}
// True when the zones on screen are the placeholder rather than the user's own —
// lets a view say "estimated" instead of presenting a guess as measurement.
export async function zonesAreEstimated() {
  const { getProfile, resolveZoneBounds } = await import("./profile.js");
  const prof = await getProfile();
  if (prof && resolveZoneBounds(prof)) return false;
  const v = await db.getPref("zoneBounds");
  return !(Array.isArray(v) && v.length === 6);
}
export async function setZoneBounds(arr) {
  const bounds = arr.map((n) => Math.round(n));
  const { patchProfile } = await import("./profile.js");
  await patchProfile({ physiology: { zoneBounds: bounds, maxHR: bounds[5] } });
  await db.setPref("zoneBounds", bounds);   // keep the legacy key in step for now
  pushCloud();   // settings ride along to the cloud so they survive a device wipe
}
export async function getMaxHR() { return maxHRof(await getZoneBounds()); }

// VO2max readings from Whoop (the source of truth — the app's own pace estimate
// over-reads from easy runs). A dated log so Progress can trend it; one entry per
// date (a new reading the same day replaces it). Synced to the cloud.
export async function getVO2maxLog() {
  const v = await db.getPref("vo2maxLog");
  return Array.isArray(v) ? v.slice().sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
}
export async function addVO2max(value, date) {
  const log = await getVO2maxLog();
  const v = Math.round(value * 10) / 10;
  const i = log.findIndex((e) => e.date === date);
  if (i >= 0) log[i] = { date, value: v }; else log.push({ date, value: v });
  log.sort((a, b) => (a.date < b.date ? -1 : 1));
  await db.setPref("vo2maxLog", log);
  pushCloud();
}

// --- Body measurements (cm) ------------------------------------------------
// A dated log of tape measurements — waist is the recomp fat signal; chest/arm/
// thigh optional. One entry per date (same-day re-measure replaces); each entry
// keeps only the fields given. Synced to the cloud like the VO2max log.
export async function getMeasurementsLog() {
  const v = await db.getPref("measurementsLog");
  return Array.isArray(v) ? v.slice().sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
}
export async function addMeasurement(date, values) {
  const clean = {};
  for (const k of ["waistCm", "chestCm", "armCm", "thighCm"]) {
    const n = Number(values && values[k]);
    if (Number.isFinite(n) && n > 0) clean[k] = Math.round(n * 10) / 10;
  }
  if (!Object.keys(clean).length) return;
  const log = await getMeasurementsLog();
  const i = log.findIndex((e) => e.date === date);
  if (i >= 0) log[i] = { ...log[i], ...clean, date }; else log.push({ date, ...clean });
  log.sort((a, b) => (a.date < b.date ? -1 : 1));
  await db.setPref("measurementsLog", log);
  pushCloud();
}

// --- DEXA scans (periodic gold-standard body composition) -----------------
// A dated log of full DEXA reads: fat/lean mass, distribution (android/gynoid,
// A/G), metabolic (RMR, RSMI, BMI) and bone (BMD, T/Z, centile). Quarterly-ish,
// so 2+ scans let the Body tab trend the true recomp signal (fat down, lean
// held). One entry per date (same-day re-scan replaces its given fields). Synced.
const DEXA_FIELDS = ["bmi", "bodyFatPct", "rmr", "rsmi", "totalMassKg", "totalFatKg",
  "ffmKg", "androidFatPct", "gynoidFatPct", "agRatio", "bmd", "tScore", "zScore", "centile"];
export async function getDexaLog() {
  const v = await db.getPref("dexaLog");
  return Array.isArray(v) ? v.slice().sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
}
export async function addDexaScan(date, values) {
  const clean = { date };
  for (const k of DEXA_FIELDS) {
    const n = Number(values && values[k]);
    if (Number.isFinite(n)) clean[k] = n;
  }
  if (Object.keys(clean).length <= 1) return;   // nothing but the date
  const log = await getDexaLog();
  const i = log.findIndex((e) => e.date === date);
  if (i >= 0) log[i] = { ...log[i], ...clean }; else log.push(clean);
  log.sort((a, b) => (a.date < b.date ? -1 : 1));
  await db.setPref("dexaLog", log);
  pushCloud();
}

// --- Bodyweight log (dated weigh-ins) -------------------------------------
// A standalone dated weight series (WHOOP-exported history + ongoing weigh-ins)
// so the Body chart isn't limited to weights attached to logged sessions. One
// entry per date (same-day re-weigh replaces). Synced like the other logs.
export async function getWeightLog() {
  const v = await db.getPref("weightLog");
  return Array.isArray(v) ? v.slice().sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
}
export async function addWeight(date, kg) {
  const n = Number(kg);
  if (!Number.isFinite(n) || n <= 0) return;
  const val = Math.round(n * 10) / 10;
  const log = await getWeightLog();
  const i = log.findIndex((e) => e.date === date);
  if (i >= 0) log[i] = { date, kg: val }; else log.push({ date, kg: val });
  log.sort((a, b) => (a.date < b.date ? -1 : 1));
  await db.setPref("weightLog", log);
  pushCloud();
}

// --- Nutrition (calories in, from MyFitnessPal/manual) --------------------
// Stored as a date-keyed object in a synced pref (small; no DB migration).
// WHOOP supplies calories OUT (cycle kilojoule) — see whoop.js; this is IN.
export async function getNutritionLog() {
  const v = await db.getPref("nutritionLog");
  return v && typeof v === "object" ? v : {};
}
export async function getNutrition(date) { return (await getNutritionLog())[date] || null; }
export async function setNutrition(date, entry) {
  const log = await getNutritionLog();
  const clean = {};
  for (const k of ["kcal", "protein", "carbs", "fat"]) if (entry[k] != null && entry[k] !== "") clean[k] = Math.round(Number(entry[k]) || 0);
  if (Object.keys(clean).length) log[date] = clean; else delete log[date];
  await db.setPref("nutritionLog", log);
  pushCloud();
}

// Current bodyweight (kg) for the protein target — explicit pref first, else the
// most recent session note, else null. Updated whenever bodyweight is logged.
export async function getBodyweight() {
  const pref = await db.getPref("bodyweightKg");
  if (Number.isFinite(pref) && pref > 0) return pref;
  const sessions = (await db.getAll("sessions")).filter((s) => s.sessionNotes && s.sessionNotes.bodyweightKg)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return sessions.length ? Number(sessions[0].sessionNotes.bodyweightKg) : null;
}
export async function setBodyweight(kg) {
  if (!Number.isFinite(kg) || kg <= 0) return;
  const val = Math.round(kg * 10) / 10;
  await db.setPref("bodyweightKg", val);
  // Keep the dated weight series in step, so a weigh-in entered in Settings
  // shows up on the Body chart instead of only moving the protein target.
  await addWeight(todayISO(), val);
  pushCloud();
}
// Protein target multiplier. The PROFILE owns this now; the legacy top-level
// pref is only a fallback for installs that predate the profile. Reading the
// pref first (as this did) meant Settings could show 1.8 while the Today card
// computed against 2.0 — the same number disagreeing with itself on two screens.
export async function getProteinPerKg() {
  const { getProfile } = await import("./profile.js");
  const prof = await getProfile();
  if (prof && prof.nutrition && Number.isFinite(prof.nutrition.proteinPerKg)) return prof.nutrition.proteinPerKg;
  const v = await db.getPref("proteinPerKg");
  return Number.isFinite(v) && v > 0 ? v : 1.8;
}
export async function setProteinPerKg(v) {
  const val = Math.round(v * 10) / 10;
  const { patchProfile } = await import("./profile.js");
  await patchProfile({ nutrition: { proteinPerKg: val } });
  await db.setPref("proteinPerKg", val);
  pushCloud();
}

// Target daily energy DEFICIT (kcal under WHOOP day-burn) for the recomp goal.
// The 2026-06-30 audit (Helms/Galpin/SBS): a recomp wants a MILD deficit
// (~250-500 kcal) + high protein. Default 400; editable in Settings. WHOOP burn
// is the "out" side, so balance (in − out) vs −target tells you if you're on track.
export async function getDeficitTarget() {
  const { getProfile } = await import("./profile.js");
  const prof = await getProfile();
  if (prof && prof.nutrition && Number.isFinite(prof.nutrition.deficitTarget)) return prof.nutrition.deficitTarget;
  const v = await db.getPref("deficitTarget");
  // 0 (maintenance) is the correct default for someone who has not said they
  // want to lose weight; the old 400 quietly put every install into a deficit.
  return Number.isFinite(v) && v >= 0 ? v : 0;
}
export async function setDeficitTarget(v) {
  const val = Math.max(0, Math.round((Number(v) || 0) / 25) * 25);
  const { patchProfile } = await import("./profile.js");
  await patchProfile({ nutrition: { deficitTarget: val } });
  await db.setPref("deficitTarget", val);
  pushCloud();
}

// Which cardio machine you last logged (outdoor run / treadmill / elliptical).
// Defaults the modality picker and biases the next-session target toward the same
// modality. Device-local (not synced) — it's a small UI convenience.
export async function getLastCardioModality() {
  const v = await db.getPref("lastCardioModality");
  return v || "run_outdoor";
}
export const setLastCardioModality = (m) => db.setPref("lastCardioModality", m || "run_outdoor");

// All cardio sessions on a weekday within a program, oldest→newest (feeds the
// cardio target + VO2max trend). Carries the day's prescription onto each so the
// intel can tell interval days from steady days.
export async function cardioHistory(programId, weekday, beforeDate) {
  const sessions = await getSessionsForKey(programId, weekday);
  return sessions.filter((s) => s.type === "cardio" && s.cardioResult &&
    (!beforeDate || s.date < beforeDate));
}

// --- Day resolution ------------------------------------------------------
// Resolve the planned Day for a program + ISO date.
export function resolveDay(program, isoDate) {
  const weekNumber = weekNumberFor(program, isoDate);
  const weekday = weekdayOf(isoDate);
  const week = (program.weeks || []).find((w) => w.weekNumber === weekNumber);
  const day = week ? week.days[weekday] : null;
  const template = program.dayTemplates ? program.dayTemplates[weekday] : null;
  return { weekNumber, weekday, week, day, template };
}

// --- Sessions ------------------------------------------------------------
export const saveSession = (session) => { const p = db.put("sessions", session); pushCloud(); return p; };
export const deleteSession = (id) => { const p = db.del("sessions", id); pushCloud(); return p; };
export const getSession = (id) => db.get("sessions", id);

export const getSessionsForProgram = (programId) =>
  db.getAllByIndex("sessions", "by-program", programId);

export const getAllSessions = () => db.getAll("sessions");

// Completed session(s) on a given date for the active program.
export async function getSessionOnDate(programId, isoDate) {
  const all = await db.getAllByIndex("sessions", "by-date", isoDate);
  return all.filter((s) => s.programId === programId);
}

// All sessions for a (program, weekday), oldest→newest.
export async function getSessionsForKey(programId, weekday) {
  const all = await db.getAllByIndex("sessions", "by-program-weekday", [programId, weekday]);
  return all.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Previous occurrence of one exercise on this weekday within the program,
// strictly before `beforeDate`. Returns { date, exercise } or null. (§9)
export async function previousExercise(programId, weekday, exerciseId, beforeDate) {
  const sessions = await getSessionsForKey(programId, weekday);
  const occurrences = [];
  for (const s of sessions) {
    const ex = (s.strengthResult || []).find((e) => e.exerciseId === exerciseId);
    if (ex && ex.sets && ex.sets.length) occurrences.push({ date: s.date, exercise: ex });
  }
  return previousOccurrence(occurrences, beforeDate);
}

// All prior occurrences of one exercise on this weekday within the program,
// strictly before `beforeDate`, oldest→newest. Feeds the progression engine
// (prescription uses the latest; stall detection uses the window).
// Cross-program fallback for the FIRST session of a new block: the engine's
// history is deliberately program-scoped (fair comparisons, clean PRs), so a
// fresh block would otherwise start blind. These return occurrences from ANY
// program before the date — the callers use them only when the in-program
// history is empty, and the source program's own plan supplies the rep range.
export async function exerciseHistoryAcross(weekday, exerciseId, beforeDate) {
  const occ = [];
  for (const s of await getAllSessions()) {
    if (s.weekday !== weekday || (beforeDate && !(s.date < beforeDate))) continue;
    const ex = (s.strengthResult || []).find((e) => e.exerciseId === exerciseId);
    if (ex && ex.sets && ex.sets.length) occ.push({ date: s.date, weekNumber: s.weekNumber, programId: s.programId, exercise: ex });
  }
  return occ.sort((x, y) => (x.date < y.date ? -1 : 1));
}
export async function cardioHistoryAcross(weekday, beforeDate) {
  return (await getAllSessions())
    .filter((s) => s.weekday === weekday && s.type === "cardio" && s.cardioResult && (!beforeDate || s.date < beforeDate))
    .sort((x, y) => (x.date < y.date ? -1 : 1));
}

export async function exerciseHistory(programId, weekday, exerciseId, beforeDate) {
  const sessions = await getSessionsForKey(programId, weekday);
  const occ = [];
  for (const s of sessions) {
    if (beforeDate && !(s.date < beforeDate)) continue;
    const ex = (s.strengthResult || []).find((e) => e.exerciseId === exerciseId);
    if (ex && ex.sets && ex.sets.length) occ.push({ date: s.date, weekNumber: s.weekNumber, exercise: ex });
  }
  return occ; // getSessionsForKey already sorts ascending by date
}

// Previous cardio session on this weekday within the program, before date. (§9)
export async function previousCardio(programId, weekday, beforeDate) {
  const sessions = await getSessionsForKey(programId, weekday);
  const earlier = sessions
    .filter((s) => s.type === "cardio" && s.cardioResult && s.date < beforeDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return earlier.length ? earlier[0] : null;
}

// Previous whole strength session on this weekday (for session-volume PR). (§9)
export async function previousStrengthSession(programId, weekday, beforeDate) {
  const sessions = await getSessionsForKey(programId, weekday);
  const earlier = sessions
    .filter((s) => s.type === "strength" && (s.strengthResult || []).length && s.date < beforeDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return earlier.length ? earlier[0] : null;
}
