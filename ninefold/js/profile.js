// profile.js — the single owner of everything personal.
//
// Ninefold ships empty. Nothing about a particular body, gym, city or goal may
// live in code any more; it all lives in one profile record, created by
// onboarding and stored like any other synced pref. This module is that record:
// its shape, its defaults, its derivations, and the one-time migration that
// lifts an existing install's scattered prefs into it.
//
// Three rules the rest of the app relies on:
//   - EVERY field has a working default or is explicitly null. A brand-new
//     profile must never crash a view; views check for null and show an empty
//     state rather than a zero.
//   - Derivations are computed, not stored, wherever the input can change
//     (max HR from age, protein target from bodyweight, zones from max HR), so
//     an edit upstream can never leave a stale number downstream. The one
//     exception is a value the user has explicitly overridden — see resolve*().
//   - Places are the generalisation of what used to be two hardcoded city
//     names. A place is a named set of available implements plus the loadable
//     weights actually on its racks.

import * as db from "./db.js";
import { resolvedConfig } from "./config.js";
import { cloudPushDebounced } from "./cloudsync.js";

export const PROFILE_KEY = "profile";
export const PROFILE_VERSION = 1;

// --- units -------------------------------------------------------------------
// Stored data is ALWAYS metric (kg, cm, km). Units are a display concern only,
// converted at the edges. This is deliberate: it means an existing log stays
// valid when someone switches units, and every engine keeps one set of numbers.
export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;
export const KM_PER_MI = 1.609344;

export const lbFromKg = (kg) => (kg == null ? null : kg / KG_PER_LB);
export const kgFromLb = (lb) => (lb == null ? null : lb * KG_PER_LB);
export const inFromCm = (cm) => (cm == null ? null : cm / CM_PER_IN);
export const cmFromIn = (i) => (i == null ? null : i * CM_PER_IN);
export const miFromKm = (km) => (km == null ? null : km / KM_PER_MI);
export const kmFromMi = (mi) => (mi == null ? null : mi * KM_PER_MI);

// --- the record --------------------------------------------------------------
export function defaultProfile() {
  return {
    version: PROFILE_VERSION,
    onboardedAt: null,              // ISO date; null = onboarding not finished

    name: "",
    sex: null,                      // 'male' | 'female' | null
                                    // Used ONLY to pick strength-standard ratios.
                                    // null is a first-class value: the benchmark
                                    // card hides itself rather than guessing.
    birthYear: null,                // drives the max-HR estimate and nothing else

    units: { weight: "kg", length: "cm", distance: "km" },
    theme: "aurora",

    goal: {
      kind: null,                   // 'recomp' | 'fatloss' | 'muscle' | 'performance' | 'health'
      weightKg: null,               // target bodyweight; null = not tracking a weight goal
      baselineKg: null,             // where the goal started from
      baselineDate: null,           // ISO
    },

    physiology: {
      maxHR: null,                  // explicit override; null = estimate from age
      zoneBounds: null,             // explicit 6-number override; null = derive from max HR
      restingHR: null,              // informational; providers update it
    },

    nutrition: {
      proteinPerKg: 1.8,            // a neutral lifter default; onboarding tunes by goal
      deficitTarget: 0,             // kcal/day under burn. 0 = maintenance, the
                                    // correct default for someone who hasn't said
                                    // they want to lose weight.
    },

    places: [],                     // see makePlace(); empty = "one unnamed place, assume everything"

    tracker: { provider: "none" },  // 'none' | 'whoop' | 'apple'

    // What the user actually wants to see. Every one of these gates a card, a
    // tab section or a Settings block, so an install that only wants to lift
    // never sees a nutrition prompt.
    features: {
      cardio: true,
      weight: true,
      measurements: false,
      dexa: false,
      nutrition: false,
      mobility: false,
      vo2max: false,
      strengthStandards: true,
    },
  };
}

// A place is a gym, a home rack, a hotel. `implements` is the vocabulary the
// engines already speak (barbell / ez_bar / cable / dumbbell_pair /
// dumbbell_single / bodyweight / treadmill / bike / rower / elliptical).
export function makePlace(name, patch = {}) {
  return {
    id: slug(name),
    name,
    implements: ["bodyweight"],
    barWeightKg: 20,
    ezBarWeightKg: 7.5,
    barbellPlatesKg: [20, 15, 10, 5, 2.5, 1.25],
    ezBarPlatesKg: [10, 5, 2.5, 1.25],
    cable: null,                    // { minKg, maxKg, stepKg }
    dumbbells: null,                // { minKg, maxKg, stepKg } | { valuesKg: [...] }
    ...patch,
  };
}

const slug = (s) => String(s || "place").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "place";

// --- read / write ------------------------------------------------------------
let cache = null;

export async function getProfile() {
  if (cache) return cache;
  const stored = await db.getPref(PROFILE_KEY);
  cache = stored ? mergeDefaults(stored) : null;
  return cache;
}

// Deep-ish merge so a profile written by an older version gains new fields with
// their defaults instead of leaving `undefined` holes in the views.
function mergeDefaults(stored) {
  const d = defaultProfile();
  return {
    ...d, ...stored,
    units: { ...d.units, ...(stored.units || {}) },
    goal: { ...d.goal, ...(stored.goal || {}) },
    physiology: { ...d.physiology, ...(stored.physiology || {}) },
    nutrition: { ...d.nutrition, ...(stored.nutrition || {}) },
    tracker: { ...d.tracker, ...(stored.tracker || {}) },
    features: { ...d.features, ...(stored.features || {}) },
    places: Array.isArray(stored.places) ? stored.places : d.places,
  };
}

export async function saveProfile(p) {
  const next = mergeDefaults({ ...p, version: PROFILE_VERSION });
  await db.setPref(PROFILE_KEY, next);
  cache = next;
  cloudPushDebounced(async () => {
    const { snapshot } = await import("./store.js");
    return snapshot();
  });
  return next;
}

// Patch a subtree without clobbering siblings: patchProfile({ goal: { weightKg: 85 } })
export async function patchProfile(patch) {
  const cur = (await getProfile()) || defaultProfile();
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch || {})) {
    next[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...(cur[k] || {}), ...v } : v;
  }
  return saveProfile(next);
}

export function clearProfileCache() { cache = null; }

export const isOnboarded = (p) => !!(p && p.onboardedAt);

// --- derivations -------------------------------------------------------------
// Tanaka (2001) rather than the folk 220−age: it is materially more accurate
// over 40 and has a smaller standard deviation. Still an estimate — an actual
// observed max, or one pulled from a tracker, always wins.
export const estimateMaxHR = (age) => (age == null ? null : Math.round(208 - 0.7 * age));

export function ageOf(profile, todayYear) {
  const by = profile && profile.birthYear;
  if (!by) return null;
  const y = todayYear || new Date().getFullYear();
  const age = y - by;
  return age > 0 && age < 120 ? age : null;
}

export function resolveMaxHR(profile) {
  const explicit = profile && profile.physiology && profile.physiology.maxHR;
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return estimateMaxHR(ageOf(profile));
}

// Zone floors as a fraction of max HR. Matches the model already used by the
// Settings "Set zones from max HR" action, which in turn lines up with WHOOP's
// six-zone display, so a WHOOP user's app and watch agree.
export const ZONE_PCT = [0.57, 0.68, 0.76, 0.84, 0.91];

export function resolveZoneBounds(profile) {
  const explicit = profile && profile.physiology && profile.physiology.zoneBounds;
  if (Array.isArray(explicit) && explicit.length === 6 && explicit.every((n) => Number.isFinite(n))) {
    return explicit.slice();
  }
  const max = resolveMaxHR(profile);
  if (!max) return null;                       // no age, no override → caller shows an empty state
  return [...ZONE_PCT.map((p) => Math.round(max * p)), max];
}

// Protein target in g/day. Null when there's no bodyweight to compute from.
export function proteinTarget(profile, bodyweightKg) {
  const perKg = (profile && profile.nutrition && profile.nutrition.proteinPerKg) || 1.8;
  return bodyweightKg ? Math.round(bodyweightKg * perKg) : null;
}

// --- places ------------------------------------------------------------------
// The engines (progression.js, substitution.js) consume one `equip` object of a
// fixed shape. Rather than rewrite them to understand profiles, we synthesise
// that shape here. Precedence: the user's own places win, the program's shipped
// equipmentProfile fills gaps, a permissive generic default is the floor.
//
// The generic default is deliberately permissive — a user who has not described
// their gym should get a working app that assumes a normal commercial setup,
// not one that refuses to prescribe anything.
export const GENERIC_EQUIPMENT = {
  barWeightKg: 20,
  ezBarWeightKg: 7.5,
  barbellPlatesKg: [25, 20, 15, 10, 5, 2.5, 1.25],
  ezBarPlatesKg: [10, 5, 2.5, 1.25],
  cable: { minKg: 2.5, maxKg: 120, stepKg: 2.5 },
  dumbbells: { minKg: 2.5, maxKg: 50, stepKg: 2.5 },
  locations: {},
};

const ALL_IMPLEMENTS = ["barbell", "ez_bar", "cable", "dumbbell_pair", "dumbbell_single", "bodyweight"];

export function equipmentFor(profile, program) {
  const fromProgram = (program && program.equipmentProfile) || null;
  const places = (profile && profile.places) || [];

  // No places described yet: fall back to the program's own profile, else generic.
  if (!places.length) {
    if (fromProgram) return fromProgram;
    return { ...GENERIC_EQUIPMENT, locations: { "": ALL_IMPLEMENTS.slice() } };
  }

  const equip = {
    barWeightKg: places[0].barWeightKg || GENERIC_EQUIPMENT.barWeightKg,
    ezBarWeightKg: places[0].ezBarWeightKg || GENERIC_EQUIPMENT.ezBarWeightKg,
    barbellPlatesKg: places[0].barbellPlatesKg || GENERIC_EQUIPMENT.barbellPlatesKg,
    ezBarPlatesKg: places[0].ezBarPlatesKg || GENERIC_EQUIPMENT.ezBarPlatesKg,
    cable: places[0].cable || (fromProgram && fromProgram.cable) || GENERIC_EQUIPMENT.cable,
    dumbbells: {},
    locations: {},
  };
  for (const pl of places) {
    const key = pl.name;                            // programs reference places by NAME
    equip.locations[key] = (pl.implements || []).slice();
    equip.dumbbells[key] = pl.dumbbells
      || (fromProgram && fromProgram.dumbbells && fromProgram.dumbbells[key])
      || GENERIC_EQUIPMENT.dumbbells;
  }
  // Keep any location the PROGRAM knows about that the profile hasn't described,
  // so importing someone else's program can't strand a day with no equipment.
  if (fromProgram && fromProgram.locations) {
    for (const [k, v] of Object.entries(fromProgram.locations)) {
      if (!equip.locations[k]) equip.locations[k] = v;
      if (!equip.dumbbells[k] && fromProgram.dumbbells) equip.dumbbells[k] = fromProgram.dumbbells[k];
    }
  }
  return equip;
}

// The place a session should default to. One place = no prompt at all, which is
// the common case; several = the session asks, remembering the last answer.
export function placeNames(profile) {
  return ((profile && profile.places) || []).map((p) => p.name);
}
export const needsPlacePrompt = (profile) => placeNames(profile).length > 1;

// --- migration ---------------------------------------------------------------
// Runs once, on the first boot after upgrading. Lifts the scattered legacy prefs
// into a profile, derives places from whatever the active program described, and
// applies any private-overlay defaults. NON-DESTRUCTIVE: legacy prefs are left
// exactly where they are, so a downgrade still works and nothing is lost if this
// gets it wrong.
export async function migrateIfNeeded(activeProgram) {
  const existing = await db.getPref(PROFILE_KEY);
  if (existing) return mergeDefaults(existing);

  const p = defaultProfile();
  const cfg = await resolvedConfig(db);
  const legacy = (cfg && cfg.legacyDefaults) || null;

  // 1. Values that were already prefs.
  const zb = await db.getPref("zoneBounds");
  if (Array.isArray(zb) && zb.length === 6) {
    p.physiology.zoneBounds = zb.slice();
    p.physiology.maxHR = zb[5];
  }
  const perKg = await db.getPref("proteinPerKg");
  if (Number.isFinite(perKg) && perKg > 0) p.nutrition.proteinPerKg = perKg;
  const def = await db.getPref("deficitTarget");
  if (Number.isFinite(def) && def >= 0) p.nutrition.deficitTarget = def;

  // 2. Which features are in use, inferred from whether there's data. Someone
  //    upgrading should not have to re-enable the things they were already
  //    using, and someone installing fresh should not inherit a full dashboard.
  const hasRows = async (k) => {
    const v = await db.getPref(k);
    return Array.isArray(v) ? v.length > 0 : !!(v && Object.keys(v).length);
  };
  p.features.measurements = await hasRows("measurementsLog");
  p.features.dexa = await hasRows("dexaLog");
  p.features.nutrition = await hasRows("nutritionLog");
  p.features.mobility = await hasRows("mobilityLog");
  p.features.vo2max = await hasRows("vo2maxLog");
  p.features.weight = (await hasRows("weightLog")) || p.features.weight;

  // 3. Places from the active program's equipmentProfile — this is what turns
  //    the old hardcoded city names into real, editable records.
  const ep = activeProgram && activeProgram.equipmentProfile;
  if (ep && ep.locations) {
    p.places = Object.entries(ep.locations).map(([name, impls]) => makePlace(name, {
      implements: impls.slice(),
      barWeightKg: ep.barWeightKg,
      ezBarWeightKg: ep.ezBarWeightKg,
      barbellPlatesKg: ep.barbellPlatesKg,
      ezBarPlatesKg: ep.ezBarPlatesKg,
      cable: impls.includes("cable") ? ep.cable || null : null,
      dumbbells: (ep.dumbbells && ep.dumbbells[name]) || null,
    }));
  }

  // 4. Private-overlay defaults (goal, sex, birth year). Public builds have none.
  if (legacy) {
    if (legacy.goal) p.goal = { ...p.goal, ...legacy.goal };
    if (legacy.sex) p.sex = legacy.sex;
    if (legacy.birthYear) p.birthYear = legacy.birthYear;
    if (legacy.tracker) p.tracker = { ...p.tracker, ...legacy.tracker };
  }

  // 5. An install with real history is already past onboarding — don't force an
  //    existing user through a wizard designed for empty state.
  const sessions = await db.getAll("sessions").catch(() => []);
  if (sessions.length) p.onboardedAt = new Date().toISOString().slice(0, 10);

  await db.setPref(PROFILE_KEY, p);
  cache = p;
  return p;
}
