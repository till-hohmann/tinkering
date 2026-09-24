// units.js — the display-unit layer.
//
// THE RULE, and the reason this file is small and boring: stored data is ALWAYS
// METRIC. Every weight in IndexedDB, every plate denomination in an equipment
// profile, every distance in a cardio result is kg / cm / km. Units are a
// presentation concern, converted at the two edges — reading a number out to the
// screen, and taking one back in from an input.
//
// That is deliberate. If units were stored, switching them would either
// invalidate every logged session or require rewriting the whole history, and
// a half-migrated log is worse than either. Storing one system means a US user
// and a European user have the same database and the same engines, and the
// progression maths never has to know which one it's serving.
//
// WHAT AN IMPERIAL GYM ACTUALLY IS: not "kg numbers shown in lb", but a rack
// with 45/25/10/5/2.5 lb plates and a 45 lb bar. Those are real, discrete,
// physical objects, so IMPERIAL_EQUIPMENT below expresses them as their exact kg
// equivalents. The progression engine then rounds to weights that genuinely
// exist on that rack, and the display converts them back to the clean round
// numbers the user expects. Rounding to metric plates and converting the result
// would prescribe 47.6 lb, which is not a thing you can load.

export const LB_PER_KG = 2.2046226218487757;
export const IN_PER_CM = 0.393700787401575;
export const MI_PER_KM = 0.621371192237334;

export const kgToLb = (kg) => (kg == null ? null : kg * LB_PER_KG);
export const lbToKg = (lb) => (lb == null ? null : lb / LB_PER_KG);

// --- resolving the active system --------------------------------------------
//
// THE AMBIENT PROFILE. Units belong to the person, not to the call site, and
// the person doesn't change halfway down a screen. Threading a profile argument
// through every formatter would mean making `model.js` — pure, storage-free,
// imported by everything — take a profile it has no other use for, and would
// still miss any call site whose author forgot.
//
// So the active profile is registered once (profile.js does it on every read and
// every save) and every function here takes it as an OPTIONAL argument that
// defaults to it. Explicit still wins, which keeps the tests parameterised and
// lets a view format in a unit that isn't the current one. Unset = metric,
// which is also what a fresh install has before onboarding runs.
const DEFAULT_UNITS = { weight: "kg", length: "cm", distance: "km" };
// Pass this where a readout must stay metric whatever the user's units are —
// the vault export, whose column names say `_kg` and `_km`, is the one case.
export const METRIC_PROFILE = { units: DEFAULT_UNITS };
let ambient = null;
export function setDisplayProfile(profile) { ambient = profile || null; }
export const displayProfile = () => ambient;

export const unitsOf = (profile) => ((profile || ambient) || {}).units || DEFAULT_UNITS;
export const isImperialWeight = (profile) => unitsOf(profile).weight === "lb";

export const weightLabel = (profile) => (isImperialWeight(profile) ? "lb" : "kg");
export const lengthLabel = (profile) => (unitsOf(profile).length === "in" ? "in" : "cm");
export const distanceLabel = (profile) => (unitsOf(profile).distance === "mi" ? "mi" : "km");

// --- weight ------------------------------------------------------------------
// Display value as a NUMBER, rounded the way each system is actually spoken.
//
// The pound case needs two rules, not one. Rounding everything to whole pounds
// reads correctly for a bodyweight or a loaded total (nobody says 220.46 lb) but
// turns the 2.5 lb plate — a real object on a real rack — into "3". So halves are
// preserved below 20 lb, where fractional denominations exist, and everything
// above rounds clean.
export function weightValue(kg, profile) {
  if (kg == null) return null;
  if (!isImperialWeight(profile)) return Math.round(kg * 10) / 10;
  const lb = kgToLb(kg);
  return Math.abs(lb) < 20 ? Math.round(lb * 2) / 2 : Math.round(lb);
}
// Display string with unit. `withUnit: false` for tables that carry their own header.
export function fmtWeight(kg, profile, { withUnit = true } = {}) {
  const v = weightValue(kg, profile);
  if (v == null) return "–";
  const n = Number.isInteger(v) ? String(v) : v.toFixed(1);
  return withUnit ? `${n} ${weightLabel(profile)}` : n;
}
// Take a number the user typed and return kg for storage.
export function weightToKg(value, profile) {
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return isImperialWeight(profile) ? lbToKg(n) : n;
}

// --- length / distance -------------------------------------------------------
export function lengthValue(cm, profile) {
  if (cm == null) return null;
  return unitsOf(profile).length === "in" ? Math.round(cm * IN_PER_CM * 10) / 10 : Math.round(cm * 10) / 10;
}
export const fmtLength = (cm, profile) =>
  cm == null ? "–" : `${lengthValue(cm, profile)} ${lengthLabel(profile)}`;
export function lengthToCm(value, profile) {
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return unitsOf(profile).length === "in" ? n / IN_PER_CM : n;
}

export function distanceValue(km, profile) {
  if (km == null) return null;
  return unitsOf(profile).distance === "mi" ? Math.round(km * MI_PER_KM * 100) / 100 : Math.round(km * 100) / 100;
}
export const fmtDistance = (km, profile) =>
  km == null ? "–" : `${distanceValue(km, profile)} ${distanceLabel(profile)}`;
export function distanceToKm(value, profile) {
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return unitsOf(profile).distance === "mi" ? n / MI_PER_KM : n;
}

// --- pace --------------------------------------------------------------------
// Pace is stored as seconds per km and read out as seconds per DISPLAYED unit,
// so an imperial user gets minutes per mile — a slower-looking number for the
// same run, which is the whole point of showing it in their unit.
export const paceLabel = (profile) => `/${distanceLabel(profile)}`;
export function paceValue(secPerKm, profile) {
  if (secPerKm == null) return null;
  return unitsOf(profile).distance === "mi" ? secPerKm / MI_PER_KM : secPerKm;
}
export function fmtPace(secPerKm, profile, { withUnit = true } = {}) {
  const v = paceValue(secPerKm, profile);
  if (v == null) return "–";
  const m = Math.floor(v / 60), s = Math.round(v % 60);
  const mmss = `${m}:${String(s).padStart(2, "0")}`;
  return withUnit ? `${mmss} ${paceLabel(profile)}` : mmss;
}

// --- editing a stored value ---------------------------------------------------
//
// THE TRAP THIS EXISTS TO CLOSE. A form that shows a stored value must not
// convert it back on save unless the user actually typed something new. The
// displayed number is ROUNDED — 18 kg reads as "40 lb" — so a blind round-trip
// stores 18.1437 kg, and the next open-and-save quantises it again. Opening an
// editor and pressing Save with no edit at all silently rewrites the log.
//
// So an edit field records what it was shown, and on save an unchanged field
// keeps the stored value byte for byte. Only a genuine edit converts.
//   const input = el("input", { value: String(weightValue(kg)) });
//   input.dataset.shown = input.value;
//   ...
//   set.weightKg = readEdit(input, set.weightKg, (v) => weightToKg(v));
export function readEdit(input, stored, toStorage) {
  const typed = String(input.value ?? "").trim();
  if (typed === String(input.dataset.shown ?? "").trim()) return stored;
  const v = toStorage(typed);
  return v == null ? stored : v;
}

// --- imperial equipment ------------------------------------------------------
// Real American gym kit, expressed in kg so the engines stay metric.
const LB = (n) => Math.round((n / LB_PER_KG) * 1e6) / 1e6;

export const IMPERIAL_EQUIPMENT = {
  barWeightKg: LB(45),                                    // standard olympic bar
  ezBarWeightKg: LB(25),
  barbellPlatesKg: [45, 35, 25, 10, 5, 2.5].map(LB),
  ezBarPlatesKg: [25, 10, 5, 2.5].map(LB),
  cable: { minKg: LB(5), maxKg: LB(250), stepKg: LB(5) },
  // 5-100 lb in 5 lb steps is the usual commercial rack.
  dumbbells: { minKg: LB(5), maxKg: LB(100), stepKg: LB(5) },
};

export const METRIC_EQUIPMENT = {
  barWeightKg: 20,
  ezBarWeightKg: 7.5,
  barbellPlatesKg: [25, 20, 15, 10, 5, 2.5, 1.25],
  ezBarPlatesKg: [10, 5, 2.5, 1.25],
  cable: { minKg: 2.5, maxKg: 120, stepKg: 2.5 },
  dumbbells: { minKg: 2.5, maxKg: 50, stepKg: 2.5 },
};

export const defaultEquipmentFor = (profile) =>
  (isImperialWeight(profile) ? IMPERIAL_EQUIPMENT : METRIC_EQUIPMENT);

// --- has this place still got a stock rack? ----------------------------------
// Switching units is a display change for every number the app STORES, but a
// rack is not a number — it is physical objects. A 20 kg bar shown in pounds is
// "44 lb", which is not a bar anyone owns, and the engine would then round loads
// to weights that cannot be loaded. So Settings offers to re-base the kit on a
// switch, and this is the guard on that offer: only a rack that still matches
// the stock set may be rewritten. A rack somebody has edited is a statement
// about their own gym and must never be silently replaced.
const near = (a, b) => a != null && b != null && Math.abs(a - b) < 0.05;

export function isStockRack(place, equip) {
  if (!place || !equip) return false;
  if (!near(place.barWeightKg, equip.barWeightKg)) return false;
  const p = place.barbellPlatesKg || [], q = equip.barbellPlatesKg || [];
  return p.length === q.length && p.every((v, i) => near(v, q[i]));
}

// WHICH SYSTEM IS THIS RACK FROM? — a two-way question, answered by comparing.
//
// This was written as `|bar - 20.41| < 0.5`, and the tolerance was the bug: the
// olympic bar is 45 lb = 20.41 kg and the metric bar is 20 kg, which are 0.41 kg
// apart. A metric rack therefore satisfied the imperial test, "Pounds" was lit
// permanently, and the Metric chip could not be selected — tapping it wrote a
// 20 kg bar that the very next read classified as imperial again.
//
// An absolute tolerance can't separate two values that close. Asking which of
// the two the bar is NEARER to always answers, always answers exactly one way,
// and stays right for a rack whose bar has been edited to something in between.
export function isImperialRack(place) {
  const bar = (place && place.barWeightKg) || 0;
  return Math.abs(bar - IMPERIAL_EQUIPMENT.barWeightKg) < Math.abs(bar - METRIC_EQUIPMENT.barWeightKg);
}

// The kit fields a re-base replaces — everything that names a real object.
export const rackFields = (equip) => ({
  barWeightKg: equip.barWeightKg, ezBarWeightKg: equip.ezBarWeightKg,
  barbellPlatesKg: [...equip.barbellPlatesKg], ezBarPlatesKg: [...equip.ezBarPlatesKg],
  cable: { ...equip.cable }, dumbbells: { ...equip.dumbbells },
});

// Plate face colours, keyed by the DISPLAYED denomination so an imperial rack
// gets the colours an American lifter expects (45 blue, 25 green, 10 white)
// rather than whatever the kg equivalent happens to land on.
const PLATE_COLORS_KG = { 25: "#ef4444", 20: "#3b82f6", 15: "#eab308", 10: "#22c55e", 5: "#e5e7eb", 2.5: "#f97316", 1.25: "#9ca3af" };
const PLATE_COLORS_LB = { 45: "#3b82f6", 35: "#eab308", 25: "#22c55e", 10: "#e5e7eb", 5: "#f97316", 2.5: "#9ca3af" };

// A plate face shows the DENOMINATION STAMPED ON THE DISC, which is not quite
// the same thing as a displayed weight. `weightValue` rounds metric to one
// decimal, so the 1.25 kg plate — a real disc on every European rack — came out
// as "1.3", and then missed its entry in the colour table below and rendered in
// the fallback blue. Imperial denominations survive `weightValue` intact (it
// keeps halves below 20 lb, exactly so the 2.5 lb plate stays 2.5), so only the
// metric side needs the raw number. The loaded TOTAL is unaffected either way —
// it is computed from exact kg and was always right.
const plateDenom = (kg, profile) =>
  (isImperialWeight(profile) ? weightValue(kg, profile) : Math.round(kg * 100) / 100);

export function plateColor(kg, profile) {
  const table = isImperialWeight(profile) ? PLATE_COLORS_LB : PLATE_COLORS_KG;
  return table[plateDenom(kg, profile)] || "#60a5fa";
}
// Face label for a plate — the denomination, no unit (it's on a disc).
export const plateLabel = (kg, profile) => String(plateDenom(kg, profile));
