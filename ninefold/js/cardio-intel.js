// cardio-intel.js — the cardio brain (pure, no DOM). Mirrors progression.js for
// the strength side: turns logged runs into heart-rate zones, a VO2max estimate,
// and a target for the next session, and tells the run player which HR band each
// segment should hit. Everything is derived from the few numbers we actually log
// from Whoop (distance / time / avg HR / RPE) plus the zone bands.
//
// Zones are EXPLICIT and editable (Settings), not derived from a single max HR —
// so they can be aligned 1:1 to Whoop. The model is 6 contiguous zones (Zone 0
// through Zone 5), stored as 6 numbers `bounds`:
//
//   bounds = [Z1floor, Z2floor, Z3floor, Z4floor, Z5floor, maxHR]
//
//   Zone 0 = below Z1floor          Zone 3 = [Z3floor, Z4floor-1]
//   Zone 1 = [Z1floor, Z2floor-1]   Zone 4 = [Z4floor, Z5floor-1]
//   Zone 2 = [Z2floor, Z3floor-1]   Zone 5 = [Z5floor, maxHR]
//
// maxHR (top of Zone 5) also feeds the VO2max estimate.
//
// Real zones come from the profile — either explicitly set, or derived from the
// user's max HR (see profile.js resolveZoneBounds). The constant below is a
// LAST-RESORT placeholder for an install that knows neither an age nor a max HR:
// a population-typical 190 bpm max run through the same %HRmax model. It exists
// so no view has to null-check its way through a chart, and the UI labels any
// zone display built on it as estimated — it is not anybody's real physiology.
export const PLACEHOLDER_MAX_HR = 190;
export const DEFAULT_ZONE_BOUNDS = [108, 129, 144, 160, 173, PLACEHOLDER_MAX_HR];
export const ZONE_NAMES = ["Recovery", "Easy", "Aerobic", "Tempo", "Threshold", "Max"];

// Cardio modality — runs get logged three ways, tracked somewhat
// independently while still cross-informing (a first-ever elliptical borrows the
// running baseline for an ambitious target; a strong session feeds the next one).
// Distance is comparable only within a modality (a machine's "km" isn't a road km),
// so pace/distance targets prefer the same modality and fall back to any. HR-zone
// intensity is shared across all three. VO2max + aerobic-efficiency estimates are
// only valid for a real outdoor run (machine distance is fabricated) — see below.
export const CARDIO_MODALITIES = [
  { id: "run_outdoor", label: "Run", sub: "outdoor" },
  { id: "run_treadmill", label: "Treadmill", sub: "indoor run" },
  { id: "elliptical", label: "Elliptical", sub: "low-impact" },
];
export const modalityLabel = (id) => (CARDIO_MODALITIES.find((m) => m.id === id) || CARDIO_MODALITIES[0]).label;
// Untagged historical runs are treated as outdoor (that was the default before
// modality tagging), so old data keeps flowing into the efficiency/VO2max trends.
export const isOutdoorRun = (m) => !m || m === "run_outdoor";
// A running modality (outdoor or treadmill) — pace is meaningful; elliptical isn't.
export const isRunModality = (m) => isOutdoorRun(m) || m === "run_treadmill";
// Map a WHOOP sport string onto a modality (best-effort, for the auto-fill).
export function modalityFromSport(sport = "") {
  const s = String(sport).toLowerCase();
  if (/elliptical/.test(s)) return "elliptical";
  if (/treadmill/.test(s)) return "run_treadmill";
  return "run_outdoor";
}

export function maxHRof(bounds = DEFAULT_ZONE_BOUNDS) { return bounds[5]; }

// Expand bounds into 6 zone objects, indexed 0..5 (index === zone number).
// loBpm is null for Zone 0 (open at the bottom); every other zone has both ends.
export function zonesFromBounds(bounds = DEFAULT_ZONE_BOUNDS) {
  const b = bounds;
  const zones = [{ z: 0, name: ZONE_NAMES[0], loBpm: null, hiBpm: b[0] - 1 }];
  for (let z = 1; z <= 5; z++) {
    zones.push({ z, name: ZONE_NAMES[z], loBpm: b[z - 1], hiBpm: z < 5 ? b[z] - 1 : b[5] });
  }
  return zones;
}

// Which zone a given heart rate falls in. Returns the zone object or null.
export function zoneForHR(hr, bounds = DEFAULT_ZONE_BOUNDS) {
  if (!hr) return null;
  const zones = zonesFromBounds(bounds);
  for (const z of zones) {
    const aboveLo = z.loBpm == null || hr >= z.loBpm;
    const belowHi = z.hiBpm == null || hr <= z.hiBpm;
    if (aboveLo && belowHi) return z;
  }
  return zones[zones.length - 1]; // above the top of Zone 5
}

// Run-segment kind → the zone it's meant to live in (a rising intensity ladder).
// warmup / easy recoveries / cooldown sit in Zone 1; the "Zone 2" continuous run
// targets Zone 2; tempo Zone 3; hard intervals Zone 4. Matches the program's
// "Zone 2"/"Zone 4" labels while using the editable (Whoop) bpm bands.
const KIND_ZONE = { warmup: 1, easy: 1, steady: 2, tempo: 3, hard: 4, cooldown: 1 };
export function segmentZoneNumber(kind) { return KIND_ZONE[kind] ?? 2; }

const RPE_BY_ZONE = { 0: "1-2", 1: "3-4", 2: "4-5", 3: "6-7", 4: "8-9", 5: "9-10" };

// Full target for a segment: the zone band + an RPE cue (prescription RPE wins).
export function segmentTarget(kind, bounds = DEFAULT_ZONE_BOUNDS, rpe) {
  const zn = segmentZoneNumber(kind);
  const z = zonesFromBounds(bounds)[zn];
  return { z: zn, name: z.name, loBpm: z.loBpm, hiBpm: z.hiBpm, rpe: rpe || RPE_BY_ZONE[zn] };
}

// --- VO2max estimate ------------------------------------------------------
// Submaximal estimate from one steady run. Two well-documented steps:
//   1. ACSM running metabolic equation (flat ground): the VO2 cost of the pace.
//      VO2 (ml/kg/min) = 0.2 * speed(m/min) + 3.5.
//   2. Swain et al. (1994) %HRmax → %VO2max:  %VO2 = (%HRmax - 37) / 0.64.
// VO2max = (VO2 at this pace) / (fraction of VO2max the run represents). Only
// meaningful for steady continuous runs where avg HR reflects a steady pace.
export function estimateVO2max(cardio, maxHR) {
  if (!cardio) return null;
  const { distanceKm, timeSeconds, avgHR } = cardio;
  if (!distanceKm || !timeSeconds || !avgHR || !maxHR) return null;
  const speed = (distanceKm * 1000) / (timeSeconds / 60); // m/min
  if (speed < 100 || speed > 400) return null;            // ~6-24 km/h sanity gate
  const vo2 = 0.2 * speed + 3.5;
  const pctHRmax = (avgHR / maxHR) * 100;
  const pctVO2 = (pctHRmax - 37) / 0.64;
  if (pctVO2 < 35 || pctVO2 > 100) return null;           // out of the model's range
  return vo2 / (pctVO2 / 100);
}

// Per-run VO2max series (steady runs only), oldest→newest, each {date, vo2}.
// `runs` = cardio sessions sorted ascending. A run counts as steady when it isn't
// an interval prescription and avg HR sits at/below Tempo (Zone 3) — interval
// averages run higher / noisier.
export function vo2maxSeries(runs, bounds = DEFAULT_ZONE_BOUNDS) {
  const maxHR = maxHRof(bounds);
  const z3hi = zonesFromBounds(bounds)[3].hiBpm;
  const out = [];
  for (const s of runs) {
    const c = s.cardioResult; if (!c) continue;
    if (!isOutdoorRun(c.modality)) continue;   // machine distance is fabricated → invalid
    const isIntervalish = classifyRun(s.prescription || "").kind === "interval" ||
      (c.avgHR && c.avgHR > z3hi + 8);
    if (isIntervalish) continue;
    const v = estimateVO2max(c, maxHR);
    if (v != null) out.push({ date: s.date, vo2: v });
  }
  return out;
}

// Smoothed "current" VO2max = mean of the last `n` steady estimates.
export function currentVO2max(runs, bounds = DEFAULT_ZONE_BOUNDS, n = 4) {
  const series = vo2maxSeries(runs, bounds);
  if (!series.length) return null;
  const tail = series.slice(-n);
  return tail.reduce((a, b) => a + b.vo2, 0) / tail.length;
}

// --- Aerobic efficiency ------------------------------------------------------
// Efficiency factor per steady run: speed (m/min) ÷ avg HR — metres travelled
// per heartbeat, scaled. Pace alone improves when you simply push harder;
// efficiency only improves when the aerobic engine does (same speed at lower
// HR, or more speed at the same HR). Steady runs only — interval averages mix
// recoveries in and say nothing. Returns oldest→newest [{date, ef}].
export function efficiencySeries(runs) {
  const out = [];
  for (const s of runs || []) {
    const c = s.cardioResult; if (!c) continue;
    if (!isOutdoorRun(c.modality)) continue;   // aerobic-efficiency needs a real road pace
    if (classifyRun(s.prescription || "").kind !== "steady") continue;
    const { distanceKm, timeSeconds, avgHR } = c;
    if (!distanceKm || !timeSeconds || !avgHR) continue;
    const speed = (distanceKm * 1000) / (timeSeconds / 60);   // m/min
    if (speed < 50 || speed > 400) continue;                  // sanity gate
    out.push({ date: s.date, ef: Math.round((speed / avgHR) * 100) / 100 });
  }
  return out;
}

// --- Prescription classifier ----------------------------------------------
// What KIND of run a prescription asks for — the single source of truth used by
// the target card, the post-run verdict, the Progress interval card and the
// VO2max series. Parses the actual structure ("4x4 min hard") rather than
// keyword-sniffing, and understands negation: "no intervals (deload)" is a
// steady deload jog, not an interval day (the bug that put a Zone-4 target on
// a deload run).
//   kind           "interval" | "tempo" | "steady"
//   deload         easy/taper day — don't push volume or intensity progression
//   reps           hard reps prescribed (interval days)
//   plannedHardMin total prescribed minutes at hard effort (interval days)
export function classifyRun(prescription = "") {
  const txt = String(prescription);
  const deload = /deload|taper/i.test(txt);
  // strip negated mentions so "no intervals" / "NO hard reps" don't classify
  const t = txt.replace(/\b(?:no|not|without)\s+(?:hard\s+)?(?:intervals?|reps?)\b/gi, "");
  // STRIDES days are steady days: short relaxed accelerations inside a Zone-2 run
  // (the Block-2+ Friday structure), not an interval session — the coaching card
  // should talk Zone-2 distance, not demand Zone-4 minutes.
  if (/strides/i.test(t)) return { kind: "steady", deload, reps: 0, plannedHardMin: 0 };
  const iv = t.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(min|s(?:ec)?)\b/i);
  if (iv || /norwegian|sprint|\bintervals?\b|\bhard\b/i.test(t)) {
    let reps = 0, plannedHardMin = 0;
    if (iv) {
      reps = +iv[1];
      const n = +String(iv[2]).replace(",", ".");
      const perMin = /^s/i.test(iv[3]) ? n / 60 : n;
      plannedHardMin = Math.round(reps * perMin * 10) / 10;
    }
    return { kind: "interval", deload, reps, plannedHardMin };
  }
  if (/tempo|continuous\s+zone\s*3/i.test(t)) return { kind: "tempo", deload, reps: 0, plannedHardMin: 0 };
  return { kind: "steady", deload, reps: 0, plannedHardMin: 0 };
}

// A one-word descriptor for a cardio day, derived from the actual prescription
// (not the program's fixed slot name) — so a week that prescribes a continuous
// tempo run shows "tempo", not the slot's default "intervals". Used for the
// day title on Today / Plan / day-detail.
export function runKindLabel(prescription = "") {
  const c = classifyRun(prescription);
  if (c.kind === "interval") return "intervals";
  if (c.kind === "tempo") return "tempo";
  return c.deload ? "easy" : "steady";
}

// --- Next-session target --------------------------------------------------
// Reads the upcoming day's prescription + this weekday's run history and returns
// a coach-style target. Three shapes:
//   steady   → hold the Zone 2 band; distance creeps up (never on a deload).
//   tempo    → hold the Zone 3 band for the continuous block.
//   interval → reach the Zone 4 band on the hard reps, judged by real time in
//              Zone 4-5 vs the prescribed hard minutes. A whole-run average HR
//              includes the recoveries, so it is NEVER used to call an interval
//              session "under target" (the recurring evaluation miss).
// `history` = prior cardio sessions on this weekday, oldest→newest. Entries that
// carry their own prescription only count when they're the same kind of run —
// a deload jog shouldn't inherit last Friday's interval verdict.
// `deload` (optional) forces deload handling when the caller knows the week phase.
export function nextCardioTarget({ prescription = "", history = [], bounds = DEFAULT_ZONE_BOUNDS, deload = false, modality = null } = {}) {
  const zones = zonesFromBounds(bounds);
  const z2 = zones[2], z3 = zones[3], z4 = zones[4];
  const cls = classifyRun(prescription);
  const easy = deload || cls.deload;
  const rel = history.filter((h) => !h.prescription || classifyRun(h.prescription).kind === cls.kind);
  // Prefer same-modality history; fall back to any modality when this is the first
  // session of its kind on this machine (so a first elliptical inherits the running
  // baseline as an ambitious start, and any modality seeds the next one).
  const sameMod = modality ? rel.filter((h) => (h.cardioResult.modality || "run_outdoor") === modality) : rel;
  const pool = sameMod.length ? sameMod : rel;
  const last = pool.length ? pool[pool.length - 1].cardioResult : null;

  if (cls.kind === "interval") {
    // enough of the prescribed hard time actually spent in Z4-5 counts as done
    const need = cls.plannedHardMin ? Math.max(4, Math.round(cls.plannedHardMin * 0.6)) : 6;
    const target = { kind: "interval", deload: easy, zone: z4, hrBand: [z4.loBpm, z4.hiBpm], rpe: "8-9",
      plannedHardMin: cls.plannedHardMin, needHardMin: need,
      headline: `Hard reps: ${z4.loBpm}-${z4.hiBpm} bpm (Zone 4)`,
      note: easy
        ? "Taper — hit the zone on the reps, but stop well short of exhaustion."
        : "Push each hard rep until the last minute feels near-maximal — that's the stimulus this session is for." };
    const zm = last && last.zoneMins;                       // real time-in-zone from WHOOP
    const hardMin = zm ? (zm[4] || 0) + (zm[5] || 0) : null;
    if (hardMin != null) {
      const planned = cls.plannedHardMin ? ` of ~${cls.plannedHardMin} prescribed` : "";
      if (hardMin >= need) {
        target.lastVerdict = `Last hard day: ${hardMin} min${planned} in Zone 4-5 — real threshold work. Hold or add a rep.`;
        target.verdictCls = "on";
      } else {
        target.lastVerdict = `Last hard day: only ${hardMin} min${planned} in Zone 4-5 — the hard reps didn't reach threshold. Push them into ${z4.loBpm}-${z4.hiBpm} bpm.`;
        target.verdictCls = "under";
      }
    } else if (last && last.avgHR) {
      // avg HR blends hard reps with easy recoveries — informative, never a verdict
      target.lastVerdict = `Last hard day averaged ${last.avgHR} bpm overall — that blends the recoveries in, so it can't judge the hard reps. Pull the run from WHOOP for real time in Zone 4-5.`;
      target.verdictCls = "info";
    }
    return target;
  }

  if (cls.kind === "tempo") {
    const target = { kind: "tempo", deload: easy, zone: z3, hrBand: [z3.loBpm, z3.hiBpm], rpe: "6-7",
      headline: `Tempo block: ${z3.loBpm}-${z3.hiBpm} bpm (Zone 3)`,
      note: "Comfortably hard — a pace you could hold for an hour, held for the continuous block." };
    const zm = last && last.zoneMins;
    if (zm) {
      const tempoMin = (zm[3] || 0) + (zm[4] || 0);
      target.lastVerdict = tempoMin >= 15
        ? `Last tempo day: ${tempoMin} min at Zone 3+ — solid. Same again or a touch longer.`
        : `Last tempo day: only ${tempoMin} min reached Zone 3 — settle into the band earlier this time.`;
      target.verdictCls = tempoMin >= 15 ? "on" : "under";
    }
    return target;
  }

  // steady Zone-2 day
  const target = { kind: "steady", deload: easy, zone: z2, hrBand: [z2.loBpm, z2.hiBpm], rpe: "4-5",
    headline: `Hold ${z2.loBpm}-${z2.hiBpm} bpm (Zone 2, aerobic)`,
    note: easy
      ? "Deload — conversational the whole way. Hold or even shorten the distance; the win is finishing fresh."
      : "Keep it easy enough to talk in full sentences; let the distance creep up over the block." };
  if (easy) return target;                            // no distance progression on a deload
  if (last && last.distanceKm) {
    const tooHard = last.avgHR && last.avgHR > z2.hiBpm + 4;
    const creep = tooHard ? 0 : 0.3;                 // +~300 m when the easy pace was honest
    target.distanceTargetKm = Math.round((last.distanceKm + creep) * 10) / 10;
    if (tooHard) {
      const z = zoneForHR(last.avgHR, bounds);
      target.lastVerdict = `Last run averaged ${last.avgHR} bpm (Zone ${z.z}) — above Zone 2. Ease the pace before adding distance.`;
      target.verdictCls = "under";
    } else {
      target.lastVerdict = `Aim for about ${target.distanceTargetKm} km at the same easy effort (last: ${last.distanceKm} km).`;
      target.verdictCls = "on";
    }
  }
  return target;
}
