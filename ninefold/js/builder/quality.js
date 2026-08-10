// builder/quality.js — does this block actually hold up? Pure: no DOM, no storage.
//
// WHY THIS EXISTS. The generator was written as a pipeline — pick a split, fill
// each pattern, ramp the sets — and every stage was locally reasonable. Nothing
// ever looked at the FINISHED block and asked whether it was a good plan. So a
// 4-week block shipped with 27.5 quad sets in week 3 (landmark ceiling 16), two
// biceps exercises and no triceps, isolation work prescribed at 5-6 reps, and
// 40 min of Zone 2 a week against a 150-minute floor. Each of those is
// deterministic and checkable in a few lines; none of them was checked.
//
// The rules here come from `Training Science Reference (2026)` and from the same
// landmarks the Progress tab already draws (volume.js LANDMARKS), so the app
// grades a generated plan by the standard it grades a real training week by.
//
// SEVERITY IS THE WHOLE DESIGN. `error` means the plan is wrong in a way that
// will cost the user progress or joints, and the builder repairs it. `warn`
// means a defensible trade-off worth naming — a warning the user chose (a
// strength block with one cardio day) must stay a warning, not get "fixed" out
// from under them. Nothing here silently overrules an explicit choice.

import { MUSCLE_MAP, LANDMARKS } from "../volume.js";
import { byId as exerciseById, PATTERNS } from "../exercise-library.js";
import { byId as adaptationById, WEEKLY_FLOOR } from "./adaptations.js";

// A set of an exercise credits its muscles by the map's weighting (1.0 primary,
// 0.5 secondary) — identical to how the Progress tab counts a logged week, so
// the plan and the log are measured on one scale.
export function setsByMuscle(week) {
  const acc = {};
  for (const day of Object.values((week && week.days) || {})) {
    if (!day || day.type !== "strength") continue;
    for (const e of day.exercises || []) {
      const map = MUSCLE_MAP[e.exerciseId];
      if (!map) continue;
      for (const m in map) acc[m] = (acc[m] || 0) + (e.prescribedSets || 0) * map[m];
    }
  }
  return acc;
}

export function setsByPattern(week) {
  const acc = {};
  for (const day of Object.values((week && week.days) || {})) {
    if (!day || day.type !== "strength") continue;
    for (const e of day.exercises || []) {
      const lib = exerciseById(e.exerciseId);
      if (!lib) continue;
      acc[lib.pattern] = (acc[lib.pattern] || 0) + (e.prescribedSets || 0);
    }
  }
  return acc;
}

const isDeload = (w) => /deload|taper|test/i.test(w.phaseName || "");
const buildWeeks = (p) => (p.weeks || []).filter((w) => !isDeload(w));
// The week the plan is judged on: peak build volume is where a too-aggressive
// ramp actually lands, and judging week 1 would pass almost anything.
export function peakWeek(program) {
  const weeks = buildWeeks(program);
  if (!weeks.length) return (program.weeks || [])[0] || null;
  return weeks.reduce((best, w) => {
    const tot = Object.values(setsByMuscle(w)).reduce((a, b) => a + b, 0);
    return !best || tot > best.tot ? { w, tot } : best;
  }, null).w;
}

// Reps as a number pair; timed holds ("45s") return null — they progress in
// seconds and none of the rep rules apply to them.
export function parseReps(range) {
  const s = String(range || "");
  if (/s$/i.test(s)) return null;
  const n = s.match(/\d+/g);
  if (!n) return null;
  return { lo: Number(n[0]), hi: Number(n[n.length - 1]) };
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Grade a finished block. Returns { checks, errors, warnings, ok } where each
 * check is { id, severity, ok, message, detail }.
 *
 * `adaptation` is the strength adaptation the block was generated under — the
 * rest and rep rules are relative to it, since 3-5 reps at 300 s is a correct
 * strength prescription and 3-5 reps at 90 s is not.
 */
export function auditBlock(program, { adaptation = "hypertrophy" } = {}) {
  const checks = [];
  const add = (id, severity, ok, message, detail) => checks.push({ id, severity, ok, message, detail });
  const weeks = program.weeks || [];
  const peak = peakWeek(program);
  const a = adaptationById(adaptation) || adaptationById("hypertrophy");

  // --- 1. weekly volume per muscle vs the landmarks -------------------------
  // The single biggest failure mode: the set ramp had no ceiling, so a long
  // block simply kept adding sets until every muscle was past its MAV.
  //
  // MAV IS A SOFT CEILING, and the severity has to say so. The reference puts
  // the productive range at ~10-20 sets "with diminishing returns as you climb"
  // — it is not a cliff, and half a set past 16 is not a defect. Half a set is
  // exactly what a dense split produces from SECONDARY credit alone (a deadlift
  // gives quads 0.25), so an error at the first decimal over would fire on
  // arithmetic rather than on bad programming and teach people to ignore it.
  //
  // So: past the ceiling at all is worth saying; MEANINGFULLY past it is the
  // error. The block that started this — 27.5 quad sets against 16, +72% — is
  // an error under any threshold. A 16.5 is a note.
  const muscles = setsByMuscle(peak);
  const over = [], badlyOver = [], under = [], missing = [];
  for (const m of Object.keys(LANDMARKS)) {
    const v = round1(muscles[m] || 0), L = LANDMARKS[m];
    if (v === 0) missing.push(m);
    else if (v > L.mav) {
      over.push(`${m} ${v} (max ${L.mav})`);
      if (v > L.mav * (1 + MAV_TOLERANCE)) badlyOver.push(`${m} ${v} (max ${L.mav})`);
    } else if (v < L.mev) under.push(`${m} ${v} (min ${L.mev})`);
  }
  add("volume.over_mav", "error", badlyOver.length === 0,
    badlyOver.length ? `Well above the productive ceiling in peak week: ${badlyOver.join(", ")}` : "No muscle is meaningfully over its ceiling.",
    { over: badlyOver });
  add("volume.near_mav", "warn", over.length === 0,
    over.length ? `Just past the ceiling (diminishing returns): ${over.join(", ")}` : "Weekly volume is inside the landmarks.",
    { over });
  add("volume.under_mev", "warn", under.length === 0,
    under.length ? `Below the growth floor: ${under.join(", ")}` : "Every trained muscle clears its floor.", { under });
  // A muscle at ZERO is different from a muscle that is merely light: it is an
  // area the plan ignores entirely, which is what compounds over several blocks
  // into a real imbalance.
  //
  // Severity depends on whether the plan had the ROOM. With three or more
  // lifting days, a muscle at zero is a selection bug and the builder should not
  // ship it. With two, it is arithmetic: ten muscle groups at the reference's
  // own floor of two hard sets twice a week needs about twenty working sets a
  // session, which is not a session. Calling that an error would mean the
  // builder refusing to produce the only plan a two-day week can hold.
  const liftDays = Object.values(program.dayTemplates || {}).filter((t) => t && t.type === "strength").length;
  const roomToCover = liftDays >= 3;
  add("coverage.untrained", roomToCover ? "error" : "warn", missing.length === 0,
    missing.length
      ? `Not trained at all: ${missing.join(", ")}${roomToCover ? "" : " — unavoidable on two lifting days; rotate what you prioritise between blocks."}`
      : "Every major muscle group is trained.",
    { missing, liftDays });

  // --- 2. rep ranges have to suit the ROLE, not just the adaptation ---------
  // Isolation work exists to add volume to muscles the compounds miss. At 5-6
  // reps a calf raise or a reverse fly is a joint-stressful way to accumulate
  // almost none — and that is exactly what a narrow strength/skill rep span
  // produced, because accessories inherited it.
  const badAccessory = [];
  for (const w of weeks) for (const d of Object.values(w.days || {})) for (const e of d.exercises || []) {
    if (e.role === "compound" || e.role === "core") continue;
    const r = parseReps(e.repRange);
    if (r && r.hi < ACCESSORY_MIN_TOP) badAccessory.push(`${e.exerciseId} ${e.repRange}`);
  }
  const uniqAcc = [...new Set(badAccessory)];
  add("reps.accessory_too_heavy", "error", uniqAcc.length === 0,
    uniqAcc.length ? `Isolation work prescribed below ${ACCESSORY_MIN_TOP} reps: ${uniqAcc.slice(0, 6).join(", ")}${uniqAcc.length > 6 ? "…" : ""}`
      : "Accessory rep ranges suit isolation work.", { offenders: uniqAcc });

  // --- 3. rest has to match the adaptation ----------------------------------
  // Heavy low-rep work on 90-120 s rest is a different session from the one the
  // prescription claims: incomplete recovery turns a strength set into a
  // fatigue set at the same load.
  const restBand = a.restSec || [60, 180];
  const badRest = [];
  for (const d of Object.values((peak && peak.days) || {})) for (const e of d.exercises || []) {
    if (e.role !== "compound") continue;
    const r = parseReps(e.repRange);
    if (r && r.hi <= 5 && (e.restSeconds || 0) < HEAVY_MIN_REST) badRest.push(`${e.exerciseId} ${e.repRange} @ ${e.restSeconds}s`);
  }
  add("rest.too_short_for_heavy", "error", badRest.length === 0,
    badRest.length ? `Heavy compounds on short rest: ${[...new Set(badRest)].slice(0, 4).join(", ")} (want ≥${HEAVY_MIN_REST}s)`
      : "Rest suits the prescribed loads.", { offenders: [...new Set(badRest)], restBand });

  // --- 4. push / pull balance ----------------------------------------------
  // Measured on MUSCLE volume, not on how many pattern slots each side got.
  //
  // Counting slots looked equivalent and isn't: once the volume ceiling trims a
  // dense muscle harder than a sparse one, a week with four pressing and four
  // pulling slots reports 14 pressing sets against 8 pulling — while the back is
  // actually receiving MORE weekly volume than the chest, because those 8 sets
  // are rows and pulldowns that credit the back at 1.0 and the 14 are spread
  // across chest and shoulders. The claim worth checking is the physiological
  // one (is the back keeping up with the front), so check that.
  const front = (muscles.Chest || 0) + (muscles.Shoulders || 0) * 0.5;
  const back = muscles.Back || 0;
  const ratio = back ? front / back : Infinity;
  const patSets = setsByPattern(peak);
  add("balance.push_pull", "warn", back > 0 && ratio <= PUSH_PULL_MAX,
    back === 0 ? "No pulling work at all." : `Chest and shoulders ${round1(front)} sets against back ${round1(back)} (${ratio.toFixed(2)}:1).`,
    { front: round1(front), back: round1(back), ratio: round1(ratio),
      pressSlots: round1((patSets.push_h || 0) + (patSets.push_v || 0) + (patSets.chest_iso || 0)),
      pullSlots: round1((patSets.pull_h || 0) + (patSets.pull_v || 0)) });

  // --- 5. arms: the pattern lumps biceps and triceps together ---------------
  // `pickForPattern` penalises repeating an EXERCISE, not a muscle, so two arm
  // slots reliably became two curls — biceps 17.5 sets against triceps 7.5,
  // which is backwards for the larger of the two.
  const direct = { Biceps: 0, Triceps: 0 };
  for (const d of Object.values((peak && peak.days) || {})) for (const e of d.exercises || []) {
    const map = MUSCLE_MAP[e.exerciseId] || {};
    for (const m of ["Biceps", "Triceps"]) if (map[m] >= 1) direct[m] += (e.prescribedSets || 0);
  }
  const armOk = !(direct.Biceps > 0 && direct.Triceps === 0) &&
    !(direct.Triceps > 0 && direct.Biceps === 0) &&
    (Math.max(direct.Biceps, direct.Triceps) <= ARM_RATIO_MAX * Math.max(1, Math.min(direct.Biceps, direct.Triceps)));
  add("balance.arms", "warn", armOk,
    `Direct arm work: biceps ${direct.Biceps} sets, triceps ${direct.Triceps}.`, direct);

  // --- 6. variety within a pattern -----------------------------------------
  // Two core slots that are both anti-rotation train one quality twice and
  // leave anti-extension and lateral untrained. Same shape of bug as the arms:
  // the picker sees exercise ids, not what they train.
  const varietyGaps = [];
  for (const p of ["core", "delt", "arm"]) {
    const ids = new Set();
    const tags = new Set();
    for (const d of Object.values((peak && peak.days) || {})) for (const e of d.exercises || []) {
      const lib = exerciseById(e.exerciseId);
      if (!lib || lib.pattern !== p) continue;
      ids.add(lib.id);
      for (const t of lib.tags || []) if (QUALITY_TAGS.has(t)) tags.add(t);
    }
    if (ids.size >= 2 && tags.size === 1) varietyGaps.push(`${p} (${ids.size} slots, all ${[...tags][0].replace(/_/g, " ")})`);
  }
  add("variety.within_pattern", "warn", varietyGaps.length === 0,
    varietyGaps.length ? `Repeats one quality instead of covering the pattern: ${varietyGaps.join(", ")}` : "Patterns with several slots cover different qualities.",
    { varietyGaps });

  // --- 7. spinal load spacing ----------------------------------------------
  // Heavy squat/hinge on back-to-back days is the one scheduling mistake that
  // shows up as a back, not as a stalled lift.
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const axialDays = order.filter((wd) => {
    const d = (peak && peak.days) || {};
    const day = d[wd];
    if (!day || day.type !== "strength") return false;
    return (day.exercises || []).some((e) => {
      const lib = exerciseById(e.exerciseId);
      const r = parseReps(e.repRange);
      return lib && AXIAL.has(lib.id) && r && r.hi <= 6;
    });
  });
  const adjacent = axialDays.filter((wd, i) => i > 0 && order.indexOf(wd) === order.indexOf(axialDays[i - 1]) + 1);
  add("spacing.axial", "warn", adjacent.length === 0,
    adjacent.length ? `Heavy spinal loading on consecutive days: ${adjacent.join(", ")}` : "Heavy spinal work is spaced.",
    { axialDays, adjacent });

  // --- 8. the weekly health floor ------------------------------------------
  let zone2 = 0, vo2 = 0;
  for (const d of Object.values((peak && peak.days) || {})) {
    if (!d || d.type !== "cardio") continue;
    const mins = Number((String(d.prescription || "").match(/(\d+)\s*min/) || [])[1] || 0);
    if (/zone\s*4|zone\s*5|hard|interval|all-out/i.test(d.prescription || "")) vo2 += 1; else zone2 += mins;
  }
  add("cardio.zone2_floor", "warn", zone2 >= WEEKLY_FLOOR.zone2Minutes,
    `Zone 2 is ${zone2} min/week (floor ${WEEKLY_FLOOR.zone2Minutes}).`, { zone2 });
  add("cardio.vo2", "warn", vo2 >= WEEKLY_FLOOR.vo2Sessions,
    vo2 ? `${vo2} hard aerobic session/week.` : "No hard aerobic session — the strongest longevity marker in the battery.", { vo2 });

  // --- 9. progression shape -------------------------------------------------
  // Measured in SETS PER EXERCISE, not in percent.
  //
  // The first version of this check compared weekly volume totals against the
  // generator's stated 10% cap and failed 100% of blocks — correctly, in that
  // the generator was not meeting its own spec, and uselessly, in that no plan
  // ever can: the smallest change you can make to a 3-set exercise is +1 set,
  // which is +33%. A check nothing can pass is noise, and noise gets muted.
  //
  // The real question is whether more than one set was piled onto the same
  // exercise at once, which IS controllable, plus a ceiling on the whole week so
  // that adding one set to twenty exercises still registers.
  const bw = buildWeeks(program);
  const totals = bw.map((w) => Object.values(setsByMuscle(w)).reduce((x, y) => x + y, 0));
  let worstRamp = 0, bigJumps = [];
  for (let i = 1; i < totals.length; i++) {
    if (totals[i - 1] > 0) worstRamp = Math.max(worstRamp, (totals[i] - totals[i - 1]) / totals[i - 1]);
    for (const wd of Object.keys(bw[i].days || {})) {
      const now = (bw[i].days[wd] || {}).exercises || [];
      const before = ((bw[i - 1].days || {})[wd] || {}).exercises || [];
      for (const e of now) {
        const was = before.find((x) => x.exerciseId === e.exerciseId);
        if (was && (e.prescribedSets - was.prescribedSets) > 1)
          bigJumps.push(`${e.exerciseId} ${was.prescribedSets}→${e.prescribedSets} (wk ${bw[i].weekNumber})`);
      }
    }
  }
  add("progression.ramp", "warn", bigJumps.length === 0 && worstRamp <= RAMP_MAX + 1e-9,
    bigJumps.length ? `More than one set added at once: ${bigJumps.slice(0, 3).join(", ")}`
      : `Steepest weekly volume jump is ${pct(worstRamp, 1)}% (cap ${pct(RAMP_MAX, 1)}%).`,
    { worstRamp: round1(worstRamp * 100), bigJumps, totals });

  // --- 10. the deload has to actually deload -------------------------------
  const dl = (program.weeks || []).filter(isDeload);
  if (dl.length && totals.length) {
    const peakTot = Math.max(...totals);
    const dlTot = Object.values(setsByMuscle(dl[dl.length - 1])).reduce((x, y) => x + y, 0);
    const cut = peakTot ? 1 - dlTot / peakTot : 0;
    add("deload.depth", "warn", cut >= DELOAD_MIN_CUT && cut <= DELOAD_MAX_CUT,
      `Deload cuts volume ${pct(cut, 1)}% (want ${pct(DELOAD_MIN_CUT, 1)}-${pct(DELOAD_MAX_CUT, 1)}%).`, { cut: round1(cut * 100) });
  }

  const errors = checks.filter((c) => c.severity === "error" && !c.ok);
  const warnings = checks.filter((c) => c.severity === "warn" && !c.ok);
  return { checks, errors, warnings, ok: errors.length === 0 };
}

// --- thresholds, named and in one place -------------------------------------
// Every one of these traces to Training Science Reference (2026); they are here
// rather than inline so a disagreement is a one-line change with a visible diff.
export const ACCESSORY_MIN_TOP = 8;   // §1: efficient window 6-15; isolation belongs at the top of it
export const HEAVY_MIN_REST = 150;    // §1 rest: 2-3 min on heavy compounds
export const PUSH_PULL_MAX = 1.35;    // pressing may lead slightly; 1.67:1 is how shoulders get cross
// How far past MAV counts as a real problem rather than arithmetic. The
// landmark is a guide with diminishing returns either side, so a fifth over it
// is the point at which the extra sets are clearly buying fatigue not growth.
export const MAV_TOLERANCE = 0.20;
export const ARM_RATIO_MAX = 2.5;     // neither arm muscle may be starved relative to the other
// A week may not gain more than this much total volume. Not the generator's
// stated 10%: one added set on a 3-set exercise is already +33%, so a 10% cap on
// whole sets is arithmetically unreachable. 25% is "one set landed on roughly
// half the exercises", which is a real week's progression.
export const RAMP_MAX = 0.25;
export const DELOAD_MIN_CUT = 0.30;   // §3: cut volume 30-50%
export const DELOAD_MAX_CUT = 0.65;   // a deload, not a week off

// Qualities a multi-slot pattern should spread across rather than repeat.
// `core`, `arm` and `delt` are each one PATTERN covering two or three distinct
// jobs — anti-rotation vs anti-extension, biceps vs triceps, side vs rear delt —
// and the generator's picker only ever knew about exercise ids, so it filled
// both slots from whichever job happened to be listed first.
export const QUALITY_TAGS = new Set(["anti-rotation", "anti-extension", "anti-lateral",
  "biceps", "triceps", "lateral-delt", "rear-delt"]);
export const qualityOf = (id) => {
  const lib = exerciseById(id);
  return (lib && (lib.tags || []).find((t) => QUALITY_TAGS.has(t))) || null;
};

// Lifts that load the spine hard enough that back-to-back days matter.
const AXIAL = new Set(["back_squat", "front_squat", "box_squat", "smith_squat", "deadlift",
  "sumo_deadlift", "trap_bar_deadlift", "rdl_barbell", "rack_pull", "pendlay_row",
  "bent_over_row", "t_bar_row", "push_press", "front_rack_lunge", "barbell_hip_thrust"]);
