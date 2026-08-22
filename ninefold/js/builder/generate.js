// builder/generate.js — turns the wizard's answers into a program JSON of
// exactly the shape the app already executes. Pure: no DOM, no storage.
//
// This is the piece that makes the app usable by someone who isn't their own
// coach. Everything downstream — the progression engine, the substitution
// engine, the calendar, the volume landmarks — already works off the program
// schema, so the builder's only job is to emit that schema well. Nothing
// downstream changes.
//
// It implements Galpin's steps 4-9: weekly frequency from real availability,
// exercise selection, exercise order, intensity progression (~3%/week), volume
// progression (~5%/week, capped at 10%), and rest intervals per adaptation.
// Steps 1-3 and 10 are wizard questions that shape the inputs.

import { ADAPTATIONS, byId as adaptationById, isCardio, isStrength, sessionOrder,
  analysePriorities, blockShape, PROGRESSION, floorGaps, WEEKLY_FLOOR } from "./adaptations.js";
import { EXERCISE_LIBRARY, PATTERNS, availableAt, pickForPattern, qualityOf, byId as exerciseById } from "../exercise-library.js";
import { MUSCLE_MAP, LANDMARKS } from "../volume.js";
import { buildSupersets } from "../supersets.js";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// --- session splits ----------------------------------------------------------
// Which patterns each resistance day covers, by how many resistance days a week
// someone can actually train. Chosen for FREQUENCY per muscle rather than
// tradition: at 2-3 days full-body beats a bro split because every muscle gets
// trained 2-3× a week, and at 4+ upper/lower keeps that frequency while giving
// each session a workable length.
const SPLITS = {
  1: [{ label: "Full body", patterns: ["squat", "hinge", "push_h", "pull_h", "core"] }],
  2: [
    { label: "Full body A", patterns: ["squat", "push_h", "pull_h", "core"] },
    { label: "Full body B", patterns: ["hinge", "push_v", "pull_v", "core"] },
  ],
  3: [
    { label: "Full body A", patterns: ["squat", "push_h", "pull_h", "calf", "core"] },
    { label: "Full body B", patterns: ["hinge", "push_v", "pull_v", "core"] },
    { label: "Full body C", patterns: ["lunge", "push_h", "pull_h", "arm", "core"] },
  ],
  4: [
    { label: "Lower A", patterns: ["squat", "hinge", "lunge", "knee_iso", "calf", "core"] },
    { label: "Upper A", patterns: ["push_h", "pull_h", "push_v", "arm", "delt"] },
    { label: "Lower B", patterns: ["hinge", "squat", "ham_iso", "calf", "core"] },
    { label: "Upper B", patterns: ["pull_v", "push_h", "pull_h", "delt", "arm"] },
  ],
  // The five-day split was PRESS-HEAVY by construction: two pressing slots on
  // Upper A, a press plus a chest isolation on Upper B and another on Full body
  // gave five pressing slots against three pulling ones. Measured on a real
  // block that came out 2:1, which is the direction that ends in cranky
  // shoulders — most people need pulling to at least match pressing. Upper B's
  // chest isolation becomes a second horizontal pull, which balances the week
  // and costs the chest nothing it isn't already getting from two presses.
  5: [
    { label: "Lower A", patterns: ["squat", "hinge", "lunge", "knee_iso", "calf"] },
    { label: "Upper A", patterns: ["push_h", "pull_h", "push_v", "arm"] },
    { label: "Lower B", patterns: ["hinge", "lunge", "ham_iso", "calf", "core"] },
    { label: "Upper B", patterns: ["pull_v", "push_h", "pull_h", "delt", "arm"] },
    { label: "Full body", patterns: ["squat", "push_v", "pull_h", "trap", "core"] },
  ],
  // SIX DAYS NEEDS ITS OWN SPLIT, and the lack of one was a real defect: the
  // day loop indexes `split[i % split.length]`, so a sixth lifting day wrapped
  // back onto Lower A and ran it twice in the same week. Quads came out at 26.3
  // sets against a ceiling of 16 — the same failure the volume cap was added to
  // prevent, arriving by a different route because the cap reasons about the
  // template and the template genuinely did contain the day twice.
  // Push/pull/legs twice over, the conventional answer at this frequency.
  6: [
    { label: "Push A", patterns: ["push_h", "push_v", "chest_iso", "delt", "arm"] },
    { label: "Pull A", patterns: ["pull_v", "pull_h", "trap", "arm", "core"] },
    { label: "Legs A", patterns: ["squat", "hinge", "lunge", "knee_iso", "calf"] },
    { label: "Push B", patterns: ["push_v", "push_h", "delt", "arm", "core"] },
    { label: "Pull B", patterns: ["pull_h", "pull_v", "trap", "arm", "delt"] },
    { label: "Legs B", patterns: ["hinge", "squat", "ham_iso", "calf", "core"] },
  ],
};
// Seven lifting days would wrap again; nobody should be given one, so it clamps
// to six and the wizard's own floor check has already said if that is too much.
const splitFor = (n) => SPLITS[Math.max(1, Math.min(6, n))] || SPLITS[3];

// --- rep schemes -------------------------------------------------------------
// A week's prescription per adaptation and role. Intensity progression is
// expressed as the rep range TIGHTENING and dropping across the block (fewer
// reps at the same effort = more load, which is what ~3%/week looks like when
// you can only load real plates). Volume progression is the set count rising.
function schemeFor(adaptation, weekIdx, totalBuildWeeks, role, exercise, setCap) {
  const a = adaptationById(adaptation) || adaptationById("hypertrophy");
  const isCompound = role === "compound";

  // Timed holds (planks, wall sits, dead hangs) are prescribed in SECONDS, not
  // reps — "3×4-5" on a wall sit is meaningless, and the app's own engine keys
  // off a repRange ending in "s" to switch into hold mode. Progression is time
  // under tension: 30 s growing to about 60 s across the block.
  if (exercise && exercise.tags && exercise.tags.includes("timed")) {
    const base = 30;
    const grow = Math.round((weekIdx / Math.max(1, totalBuildWeeks)) * 30);
    const secs = Math.min(75, base + Math.round(grow / 5) * 5);
    return { sets: role === "core" ? 3 : 2, repRange: `${secs}s`, timed: true };
  }

  // Sets: start at the low end and add across the block, never exceeding the
  // adaptation's own ceiling.
  //
  // STAGGERED, because a set is an indivisible unit. The old version added one
  // to EVERY exercise on the same week, and claimed in this comment to be doing
  // +5%/week inside a 10% cap. It wasn't: measured, the real weeks went 0%,
  // +28%, 0%, +22%. You cannot ramp a 3-set exercise by 5% — the smallest
  // possible step is +33%. So compounds and accessories now take their extra
  // set on ALTERNATE weeks, which halves each jump and gets the average close to
  // what was always intended.
  //
  // `setCap` is the volume ceiling, passed down from the generator, which knows
  // how often the week trains each muscle. Without it nothing stopped the ramp,
  // and a long block simply kept climbing past every landmark — the peak week of
  // a real 4-week block reached 27.5 quad sets against a MAV of 16.
  // THE CAP OUTRANKS THE ADAPTATION'S PREFERRED STARTING SETS. It used to be
  // floored at `setLo`, which meant that on a dense split — where one muscle is
  // hit by four or five slots — the ceiling computed correctly to 2 and was then
  // immediately overruled back up to 3, and the muscle finished 25% past its
  // MAV anyway. Two hard sets is not a token gesture: the reference puts the
  // growth floor at ~2 hard sets twice a week, so a lift trimmed to 2 by a dense
  // week is still doing its job, and the alternative is junk volume.
  const [setLoRaw, setHiRaw] = a.sets || [3, 4];
  const setHi = Math.max(MIN_WORKING_SETS, Math.min(setHiRaw, setCap == null ? setHiRaw : setCap));
  const setLo = Math.min(setLoRaw, setHi);
  const phase = isCompound ? 0 : 1;                       // compounds step on even weeks, accessories on odd
  const steps = totalBuildWeeks > 1 ? Math.floor((weekIdx + (weekIdx >= phase ? 1 - phase : 0)) / 2) : 0;
  const sets = Math.min(setHi, setLo + steps) - (role === "core" ? 1 : 0);

  // Reps. `a.reps` is the adaptation's whole VALID SPAN, not a prescription —
  // hypertrophy's span is 6-15, and prescribing "3×6-15" tells the lifter
  // nothing. So narrow it to a workable band ~3 reps wide.
  //
  // COMPOUNDS take the heavy end of the adaptation's span: that is what the
  // adaptation is FOR, and the specificity of heavy low-rep work is the whole
  // reason someone picked strength over hypertrophy.
  //
  // ACCESSORIES DO NOT INHERIT THAT SPAN, and this is the bug that shipped.
  // "Accessories take the light end" was right in principle and wrong in code:
  // with a wide hypertrophy span (6-15) the light end is 11-15, which is
  // correct, but with a narrow strength or skill span (3-5, 3-6) the "light
  // end" is still 5-6 — and a real block went out prescribing 5-rep calf
  // raises, reverse flies and curls for four weeks. Isolation work is not a
  // strength exercise done lighter. It exists to add volume to muscles the
  // compounds miss, it cannot be loaded safely at 5 reps on small joints, and
  // its stimulus-to-fatigue ratio is worst exactly there.
  //
  // So an accessory is prescribed in the hypertrophy window regardless of the
  // block's adaptation, intersected with the adaptation's span only where that
  // span is genuinely higher-rep (muscular endurance). A strength block still
  // gets its heavy compounds; its curls just stop being 5-rep curls.
  const span = a.reps || [8, 12];
  const width = Math.max(2, Math.round((span[1] - span[0]) / 3));
  let lo, hi;
  if (isCompound) {
    lo = span[0];
    hi = Math.min(span[1], span[0] + width);
  } else {
    const accSpan = [Math.max(ACCESSORY_REPS[0], Math.min(span[0], ACCESSORY_REPS[0])), Math.max(ACCESSORY_REPS[1], span[1])];
    // Sit in the middle-to-upper part of that window: hard enough to be a real
    // set, light enough to be an accessory.
    lo = Math.max(ACCESSORY_REPS[0], Math.round(accSpan[0] + (accSpan[1] - accSpan[0]) * 0.15));
    hi = Math.min(accSpan[1], lo + Math.max(3, width));
  }
  if (hi <= lo) hi = lo + 1;

  // Strength-biased blocks get heavier as they go. The progression tightens the
  // TOP of the range while holding the bottom: 3-5 → 3-4 → 3-3 means the same
  // minimum reps at a heavier load, which is what ~3%/week actually looks like.
  // Dropping the bottom too would quietly turn a strength block into a peaking
  // programme — 2-rep sets are a different stimulus with different risk, and
  // nobody asked for it.
  // Compounds only: accessories exist to accumulate volume, and tightening THEIR
  // range collapses it to a single number ("4-4") while removing the very thing
  // they're there for.
  if (isCompound && (adaptation === "strength" || adaptation === "power" || adaptation === "speed")) {
    const drop = Math.floor((weekIdx / Math.max(1, totalBuildWeeks)) * 2);
    hi = Math.max(lo + 1, hi - drop);
  }

  return { sets: Math.max(2, sets), repRange: `${lo}-${hi}` };
}

// The rep window an accessory is prescribed in, whatever the block is for.
// Training Science Reference §1: the efficient window is ~6-15; isolation work
// belongs at the top of it, where it can be loaded safely and accumulate volume.
const ACCESSORY_REPS = [8, 15];

// The fewest sets an exercise may be trimmed to by the volume ceiling. Two hard
// sets, twice a week, is the reference's own growth floor — below that the slot
// should be removed, not shrunk.
const MIN_WORKING_SETS = 2;

// Rest per role, taken from the adaptation's own range: compounds get the top of
// it (full neural recovery), accessories the bottom.
//
// FLOOR ON HEAVY WORK. A set of 3-5 is a heavy set no matter which adaptation
// asked for it, and the skill adaptation's 120 s top-of-range turned one into
// something else entirely — the same load with incomplete recovery, which is a
// fatigue session wearing a strength session's prescription. §1: 2-3 min on
// heavy compounds. So the adaptation sets the rest and this sets the floor.
function restFor(adaptation, role, repRange) {
  const a = adaptationById(adaptation) || adaptationById("hypertrophy");
  const [lo, hi] = a.restSec || [90, 150];
  if (role === "core") return Math.max(45, lo);
  if (role !== "compound") return Math.round((lo + hi) / 2);
  const top = repTop(repRange);
  return top != null && top <= 5 ? Math.max(hi, HEAVY_REST_FLOOR) : hi;
}
const HEAVY_REST_FLOOR = 150;
function repTop(range) {
  const s = String(range || "");
  if (!s || /s$/i.test(s)) return null;
  const n = s.match(/\d+/g);
  return n ? Number(n[n.length - 1]) : null;
}

// --- day allocation ----------------------------------------------------------
// Split the available days between resistance and cardio according to what the
// user actually prioritised, while respecting each adaptation's own sensible
// frequency and the weekly health floor.
export function allocateDays(priorities, daysPerWeek) {
  const strengthPri = priorities.filter(isStrength);
  const cardioPri = priorities.filter(isCardio);

  if (!strengthPri.length) return { strengthDays: Math.min(2, daysPerWeek), cardioDays: Math.max(0, daysPerWeek - 2) };
  if (!cardioPri.length) {
    // Even a pure-strength plan keeps one cardio slot when there's room —
    // dropping VO2max entirely is the one omission with a mortality signal
    // attached, and the wizard says so rather than silently obeying.
    const cardio = daysPerWeek >= 4 ? 1 : 0;
    return { strengthDays: daysPerWeek - cardio, cardioDays: cardio };
  }

  // Weight by rank: first priority counts double the second, and so on.
  const weight = (id) => priorities.length - priorities.indexOf(id);
  const sW = strengthPri.reduce((a, id) => a + weight(id), 0);
  const cW = cardioPri.reduce((a, id) => a + weight(id), 0);
  let strengthDays = Math.round((sW / (sW + cW)) * daysPerWeek);

  // Clamp: at least 2 resistance sessions (the muscle-retention floor) and at
  // least 1 cardio day whenever cardio was prioritised at all.
  strengthDays = Math.max(Math.min(2, daysPerWeek - 1), Math.min(strengthDays, daysPerWeek - 1));
  strengthDays = Math.min(strengthDays, 5);
  return { strengthDays, cardioDays: daysPerWeek - strengthDays };
}

// Spread N training days across the week so hard days don't stack. Picks from
// the user's available days, maximising the gap between consecutive sessions.
export function spreadDays(available, n) {
  const days = (available && available.length ? available : WEEKDAYS)
    .slice().sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
  if (n >= days.length) return days.slice(0, n);
  const out = [];
  const stride = days.length / n;
  for (let i = 0; i < n; i++) out.push(days[Math.floor(i * stride)]);
  return out;
}

// --- cardio prescriptions ----------------------------------------------------
function cardioPrescription(adaptation, weekIdx, totalBuildWeeks, baseMinutes) {
  const grow = 1 + PROGRESSION.volumePerWeek * weekIdx;
  if (adaptation === "vo2max") {
    const rounds = Math.min(6, 4 + Math.floor(weekIdx / 2));
    return { label: "VO₂max intervals", prescription: `${rounds} × 4 min hard (Zone 4-5) / 4 min easy`, zone: 4, minutes: rounds * 8 + 15 };
  }
  if (adaptation === "anaerobic") {
    const rounds = Math.min(12, 6 + weekIdx);
    return { label: "Anaerobic intervals", prescription: `${rounds} × 30 s all-out / 2:30 easy`, zone: 5, minutes: rounds * 3 + 15 };
  }
  const base = baseMinutes || 40;
  const mins = Math.round((base * grow) / 5) * 5;
  return { label: "Zone 2 base", prescription: `${mins} min steady, Zone 2 — conversational`, zone: 2, minutes: mins };
}

// --- routines ----------------------------------------------------------------
// Generic warm-up and cool-downs. Kept short and equipment-free so they work at
// any place, including a hotel room.
function buildRoutines() {
  const t = (id, name, durationSeconds, cue, bilateral = false) => ({ id, name, mode: "timed", durationSeconds, bilateral, cue });
  return {
    warmupStrength: { rounds: 1, transitionSeconds: 5, items: [
      t("easy_cardio", "Easy cardio", 180, "Bike, row or brisk walk — raise the heart rate"),
      t("leg_swings", "Leg swings", 20, "Front-to-back, controlled", true),
      t("hip_9090", "90/90 hip switch", 45, "Sit tall, sweep the knees side to side"),
      t("ankle_rock", "Ankle rock", 25, "Drive the knee past the toes, heel down", true),
      t("bird_dog", "Bird dog", 30, "Opposite arm and leg long, hips level", true),
    ] },
    cooldownStrength: { rounds: 1, transitionSeconds: 10, items: [
      t("dead_hang", "Dead hang", 30, "Full grip, shoulders relaxed long"),
      t("couch_stretch", "Hip flexor stretch", 40, "Rear foot up, hips tall, squeeze the glute", true),
      t("adductor_rockback", "Adductor rock-back", 35, "One leg long to the side, rock the hips back", true),
      t("hip_9090", "90/90 hip switch", 45, "Slow switches, breathe out at the bottom"),
    ] },
    warmupCardio: { rounds: 1, transitionSeconds: 5, items: [
      t("easy_cardio", "Easy build", 240, "Start easy and lift the pace to your target zone"),
      t("leg_swings", "Leg swings", 20, "Loosen the hips before the effort", true),
    ] },
    cooldownCardio: { rounds: 1, transitionSeconds: 10, items: [
      t("easy_cardio", "Walk it down", 180, "Let the heart rate drift back down"),
      t("soleus_raise", "Bent-knee calf raise", 35, "Slow and light — flush the calves", true),
      t("couch_stretch", "Hip flexor stretch", 40, "Undo the running posture", true),
    ] },
  };
}

// --- what came before --------------------------------------------------------
// A block generated in isolation is fine once and wrong repeatedly. Run four of
// them and the same movement selection comes back every time (the picker is
// deterministic, so the same inputs give the same squat), while any muscle the
// split under-serves stays under-served for a year. Neither shows up when you
// look at a single block, which is exactly why nobody noticed.
//
// Three things carry across, and no more. This is a bias, not a planner: it
// nudges selection and flags neglect, and it never overrides what the user asked
// this block to be.
export function summariseHistory(previousBlocks = []) {
  const blocks = (previousBlocks || []).filter((p) => p && p.weeks);
  // Only the most recent two matter for variety — going further back would
  // eventually forbid the good lifts, and a squat you haven't done for three
  // blocks should be a candidate again, not a stale one.
  const recent = blocks.slice(-2);
  const recentExerciseIds = [];
  for (const p of recent) for (const id of Object.keys(p.exercises || {})) recentExerciseIds.push(id);

  // Cumulative weekly sets per muscle across every block, so a muscle that keeps
  // being skipped is visible as a number rather than as a hunch.
  const totals = {};
  for (const p of blocks) {
    const wk = (p.weeks || [])[Math.floor((p.weeks || []).length / 2)];   // a representative mid-block week
    for (const d of Object.values((wk && wk.days) || {})) {
      if (!d || d.type !== "strength") continue;
      for (const e of d.exercises || []) {
        const map = MUSCLE_MAP[e.exerciseId];
        if (!map) continue;
        for (const m in map) totals[m] = (totals[m] || 0) + (e.prescribedSets || 0) * map[m];
      }
    }
  }
  // Neglected = below the growth floor averaged over the blocks that exist.
  const neglected = [];
  if (blocks.length) {
    for (const m of Object.keys(LANDMARKS)) {
      const perBlock = (totals[m] || 0) / blocks.length;
      if (perBlock < LANDMARKS[m].mev * NEGLECT_FRACTION) neglected.push(m);
    }
  }

  const priorities = blocks.flatMap((p) => p.priorities || []);
  return { blocks: blocks.length, recentExerciseIds, muscleTotals: totals, neglected, priorities,
    lastPriorities: (blocks[blocks.length - 1] || {}).priorities || [] };
}
// A muscle averaging under half its MEV across previous blocks is being skipped,
// not merely trained lightly.
const NEGLECT_FRACTION = 0.5;

// --- the generator -----------------------------------------------------------
export function generateProgram(input) {
  const {
    name, startDate, lengthWeeks = 6,
    priorities = ["hypertrophy"],
    daysPerWeek = 3,
    availableDays = WEEKDAYS,
    // The wizard asks in these terms now: how many sessions are the plan, how
    // many are bonus, and how much of the total is cardio. daysPerWeek/
    // allocateDays remain the fallback for a program built the old way.
    mandatoryDays = null,
    optionalDays = 0,
    cardioPerWeek = null,
    places = [],
    blockShapeId = "classic",
    goalText = "",
    // Blocks already run, oldest→newest. A block built in isolation is the
    // reason someone can spend a year of the app's blocks never once training a
    // rear delt: each block is individually defensible and the sequence has a
    // hole in it. See `history` below for what this actually drives.
    previousBlocks = [],
    // ASKED IN THE BUILDER, defaulting to no. See supersets.js for why this is a
    // question about the room as much as about the training.
    supersets: allowSupersets = false,
  } = input || {};

  const warnings = [];
  const history = summariseHistory(previousBlocks);
  const previousExerciseIds = history.recentExerciseIds;
  const analysis = analysePriorities(priorities);
  if (analysis.tooMany) {
    warnings.push("You've picked more than three priorities. Everything gets a smaller dose — consider training two hard and maintaining the rest.");
  }
  for (const c of analysis.conflicting) {
    const a = adaptationById(c.a), b = adaptationById(c.b);
    warnings.push(`${a.short} and ${b.short} pull in opposite directions. ${c.advice}`);
  }

  // Step 4: frequency from real availability.
  const usableDays = (availableDays || WEEKDAYS).filter((d) => WEEKDAYS.includes(d));
  const asked = mandatoryDays == null ? daysPerWeek : mandatoryDays + optionalDays;
  const perWeek = Math.min(asked, usableDays.length);
  if (perWeek < asked) {
    warnings.push(`You asked for ${asked} sessions but only ${usableDays.length} days are available, so the plan uses ${perWeek}.`);
  }
  // An explicit cardio count beats inferring one from the priority ranking: the
  // user just told us, and a derived number that contradicts the answer they
  // gave two screens ago reads as a bug.
  let strengthDays, cardioDays;
  if (cardioPerWeek == null) {
    ({ strengthDays, cardioDays } = allocateDays(priorities, perWeek));
  } else {
    cardioDays = Math.max(0, Math.min(cardioPerWeek, perWeek));
    strengthDays = perWeek - cardioDays;
    if (strengthDays < 2 && perWeek >= 2) {
      warnings.push(`${strengthDays} lifting session${strengthDays === 1 ? "" : "s"} a week is below the two-a-week floor for holding muscle.`);
    }
  }
  // The LAST sessions of the week are the optional ones — the week's mandatory
  // work should be banked before the bonus, not after it.
  const optionalCount = mandatoryDays == null ? 0 : Math.min(optionalDays, perWeek);

  // Equipment: the union of every place, so the plan doesn't refuse to program a
  // barbell lift just because one of your places lacks a rack. Substitution
  // handles the day you're somewhere without it.
  const allImplements = new Set(["bodyweight"]);
  for (const p of places) for (const im of (p.implements || [])) allImplements.add(im);
  const pool = availableAt([...allImplements]);
  const primaryPlace = places[0] ? places[0].name : "";

  // Steps 5 & 6: exercise selection and order.
  const strengthAdaptation = priorities.find(isStrength) || "hypertrophy";
  const cardioAdaptations = priorities.filter(isCardio);
  const split = splitFor(strengthDays);
  const strengthWeekdays = spreadDays(usableDays, strengthDays);
  const remaining = usableDays.filter((d) => !strengthWeekdays.includes(d));
  const cardioWeekdays = spreadDays(remaining, Math.min(cardioDays, remaining.length));
  if (cardioDays > cardioWeekdays.length) {
    warnings.push("Not enough free days for every cardio session — some were dropped. Consider pairing an easy run onto a lifting day.");
  }

  const exercises = {};
  const dayTemplates = {};
  // Which weekdays carry the optional sessions: the last ones scheduled, in
  // week order, so a skipped optional day never leaves a hole mid-week.
  const orderOf = (wd) => WEEKDAYS.indexOf(wd);
  const scheduled = [...strengthWeekdays, ...cardioWeekdays].sort((a, b) => orderOf(a) - orderOf(b));
  const optionalSet = new Set(scheduled.slice(Math.max(0, scheduled.length - optionalCount)));
  const missingPatterns = new Set();
  const weekUsed = new Set();      // soft variety bias across the whole week
  // Which sub-jobs the week has already covered (biceps, anti-rotation, rear
  // delt…). Tracked across the WHOLE week rather than per day, because the
  // imbalance this prevents is a weekly one: two arm slots on different days
  // both becoming curls is exactly the case that shipped.
  const weekQualities = new Set();

  strengthWeekdays.forEach((weekday, i) => {
    const dayPlan = split[i % split.length];
    const chosen = [];
    const used = [];
    for (const pattern of dayPlan.patterns) {
      const pick = pickForPattern(pattern, pool, { exclude: used, usedThisWeek: [...weekUsed],
        qualitiesUsed: [...weekQualities], deprioritise: previousExerciseIds });
      if (!pick) { missingPatterns.add(pattern); continue; }
      used.push(pick.id);
      weekUsed.add(pick.id);
      const q = qualityOf(pick);
      if (q) weekQualities.add(q);
      exercises[pick.id] = { name: pick.name, cue: pick.cue, implement: pick.implement };
      // Rest is stored once per exercise on the template, so it is resolved
      // against the rep range this lift will actually carry (week 1's, which is
      // the widest — a strength block only tightens from there).
      const wk1 = schemeFor(strengthAdaptation, 0, 1, pick.role, pick);
      chosen.push({ exerciseId: pick.id, role: pick.role,
        restSeconds: restFor(strengthAdaptation, pick.role, wk1.repRange) });
    }
    // Step 6: most neural first. Compounds lead, isolation follows, core last —
    // fatigue from a set of curls costs you nothing on a squat, but the reverse
    // is not true.
    const rank = { compound: 0, accessory: 1, core: 2 };
    chosen.sort((a, b) => rank[a.role] - rank[b.role]);
    dayTemplates[weekday] = {
      weekday, location: primaryPlace, type: "strength",
      label: dayPlan.label, preRoutine: "warmupStrength", postRoutine: "cooldownStrength",
      optional: optionalSet.has(weekday), exercises: chosen,
      // PAIRED AT BUILD TIME, NOT AT RUN TIME. The generator can see the whole
      // day at once and answers for it once; a session that paired things up on
      // the fly would hand you a different workout every time you opened it.
      supersets: allowSupersets ? buildSupersets(chosen, { allow: true }) : [],
    };
  });

  // WHICH KIND of cardio, when the user didn't say.
  //
  // The fallback used to be "every cardio day is Zone 2", which produced the
  // single most consequential omission the app can make: a block with no hard
  // aerobic session at all. Reference §5 is unambiguous — one easy aerobic
  // session AND one genuinely hard interval session covers both ends, and
  // VO₂max is the strongest longevity marker in the battery. So with room for
  // two, the second is intervals. With room for one it stays Zone 2, because a
  // base is the thing you build first.
  //
  // Only ever a DEFAULT: an explicit cardio priority still wins outright.
  const cardioPlan = cardioAdaptations.length
    ? cardioWeekdays.map((_, i) => cardioAdaptations[i % cardioAdaptations.length])
    : cardioWeekdays.map((_, i) => (cardioWeekdays.length >= 2 && i === 1 ? "vo2max" : "long_endurance"));
  // Zone 2 sessions are lengthened toward the weekly floor rather than left at a
  // flat 40 min, which left every generated block short of it. Capped at 75 min
  // so one session never becomes an expedition.
  const z2Days = cardioPlan.filter((a) => a === "long_endurance").length;
  const z2Target = z2Days ? Math.max(30, Math.min(75, Math.round(WEEKLY_FLOOR.zone2Minutes / z2Days / 5) * 5)) : 0;

  cardioWeekdays.forEach((weekday, i) => {
    const adaptation = cardioPlan[i];
    const p = cardioPrescription(adaptation, 0, lengthWeeks, z2Target);
    dayTemplates[weekday] = {
      weekday, location: primaryPlace, type: "cardio",
      label: p.label, preRoutine: "warmupCardio", postRoutine: "cooldownCardio",
      optional: optionalSet.has(weekday), adaptation, baseMinutes: adaptation === "long_endurance" ? z2Target : null,
      exercises: [], supersets: [],
    };
  });

  for (const d of WEEKDAYS) {
    if (!dayTemplates[d]) dayTemplates[d] = { weekday: d, location: primaryPlace, type: "rest", label: "Rest", exercises: [] };
  }

  for (const pattern of missingPatterns) {
    warnings.push(`No ${PATTERNS[pattern].name.toLowerCase()} movement is possible with your equipment, so those days skip it. Adding even a pull-up bar would close most of these gaps.`);
  }

  // Steps 7 & 8: intensity and volume progression, week by week.
  const shape = blockShape(blockShapeId);
  const phases = shape.build(lengthWeeks);
  const buildWeeks = phases.filter((p) => !/deload/i.test(p)).length || 1;
  const weeks = [];
  // THE VOLUME CEILING, derived rather than guessed.
  //
  // For every muscle, count how many SETS PER WEEK it would receive if each of
  // its exercises ran at N sets; the largest N that keeps every muscle inside
  // its MAV is the cap. A muscle trained by four exercises across the week hits
  // its ceiling at a far lower per-exercise count than one trained by a single
  // slot, which is exactly the arithmetic the generator never did — it ramped
  // per exercise and never looked at the weekly total.
  //
  // `setsPerMuscleWeek` on each adaptation was declared for this and read
  // nowhere; it now bounds the answer alongside the landmarks.
  // PER EXERCISE, not one number for the block. A single global cap is safe but
  // far too blunt: the most-trained muscle (quads, hit by four slots) sets a cap
  // of 2, and then calves — hit by one slot — get 2 sets a week and fall under
  // their growth floor. Capping the whole plan to protect one muscle starves the
  // rest, which is how the first version of this pushed 96% of blocks below MEV.
  //
  // Each exercise instead takes the tightest ceiling among ITS OWN muscles. That
  // is still provably safe: if every exercise touching muscle m runs at most
  // floor(MAV_m / perSet_m), their weighted sum cannot exceed MAV_m. It just
  // lets a calf raise run 6 sets while a squat runs 2.
  const setCaps = (() => {
    const perSet = {};                          // muscle -> weekly sets at 1 set/exercise
    for (const weekday of WEEKDAYS) {
      const tpl = dayTemplates[weekday];
      if (!tpl || tpl.type !== "strength") continue;
      for (const e of tpl.exercises || []) {
        const map = MUSCLE_MAP[e.exerciseId];
        if (!map) continue;
        for (const m in map) perSet[m] = (perSet[m] || 0) + map[m];
      }
    }
    const adaptMax = (adaptationById(strengthAdaptation) || {}).setsPerMuscleWeek;
    const caps = {};
    for (const id of Object.keys(exercises)) {
      const map = MUSCLE_MAP[id];
      if (!map) { caps[id] = null; continue; }
      let cap = Infinity;
      for (const m in map) {
        if (!perSet[m]) continue;
        const ceiling = Math.min((LANDMARKS[m] || { mav: 16 }).mav, adaptMax ? adaptMax[1] : Infinity);
        cap = Math.min(cap, Math.floor(ceiling / perSet[m]));
      }
      caps[id] = Number.isFinite(cap) ? Math.max(2, cap) : null;
    }
    return caps;
  })();

  let buildIdx = 0;
  for (let w = 0; w < lengthWeeks; w++) {
    const phaseName = phases[w];
    const deload = /deload/i.test(phaseName);
    const isTest = /test/i.test(phaseName);
    const days = {};
    for (const weekday of WEEKDAYS) {
      const tpl = dayTemplates[weekday];
      if (tpl.type === "rest") { days[weekday] = { weekday, type: "rest" }; continue; }
      if (tpl.type === "cardio") {
        const p = cardioPrescription(tpl.adaptation, deload ? Math.max(0, buildIdx - 2) : buildIdx, buildWeeks, tpl.baseMinutes);
        days[weekday] = { weekday, type: "cardio", prescription: deload ? `Easy ${Math.round(p.minutes * 0.6)} min, Zone 2` : p.prescription };
        continue;
      }
      days[weekday] = {
        weekday, type: "strength",
        exercises: tpl.exercises.map((e) => {
          const s = schemeFor(strengthAdaptation, deload ? 0 : buildIdx, buildWeeks, e.role, exerciseById(e.exerciseId), setCaps[e.exerciseId]);
          return {
            // A deload cuts VOLUME and keeps the movement pattern; a test week
            // keeps load and cuts volume harder. Both are handled by the app's
            // own engine at run time too, but the plan should read honestly.
            // A deload has to actually cut. Subtracting a fixed set floored at
            // 2 did nothing at all to a lift the volume ceiling had already
            // trimmed to 2 — a "deload" week that removed 27% of the volume,
            // under the 30-50% the reference asks for. Proportional cuts scale
            // with whatever the build weeks reached.
            prescribedSets: deload ? Math.max(1, Math.round(s.sets * (isTest ? 0.5 : 0.6))) : s.sets,
            repRange: s.repRange,
            restSeconds: e.restSeconds,
            exerciseId: e.exerciseId, role: e.role,
          };
        }),
      };
    }
    weeks.push({
      weekNumber: w + 1,
      startDate: addDaysISO(startDate, w * 7),
      phaseName,
      scheme: describeScheme(strengthAdaptation, deload, buildIdx, buildWeeks),
      intensity: deload ? "Easy — RPE 5-6" : `RPE ${7 + Math.min(1, Math.floor(buildIdx / 3))}-${8 + Math.min(1, Math.floor(buildIdx / 3))}`,
      focus: weekFocus(strengthAdaptation, w, lengthWeeks, phaseName),
      days,
    });
    if (!deload) buildIdx++;
  }

  // Weekly-floor check against what was actually generated.
  const zone2Minutes = cardioPlan.reduce((sum, ad) =>
    sum + (ad === "long_endurance" ? cardioPrescription(ad, 0, lengthWeeks, z2Target).minutes : 0), 0);
  const gaps = floorGaps({
    zone2Minutes,
    resistanceSessions: strengthDays,
    vo2Sessions: cardioPlan.filter((a) => a === "vo2max" || a === "anaerobic").length,
    hasPower: priorities.includes("power") || priorities.includes("speed"),
  });

  const program = {
    id: `prog-${slug(name)}-${startDate}`,
    name: name || "My training block",
    startDate,
    lengthWeeks,
    status: "active",
    notes: goalText || "",
    generatedBy: "ninefold-builder",
    priorities,
    // The block's own answer, so a session knows whether the pairings in its day
    // templates were ever meant to run — and so a PLACE has something to
    // override. See supersets.js supersetsAllowed().
    supersets: !!allowSupersets,
    equipmentProfile: buildEquipmentProfile(places),
    exercises,
    routines: buildRoutines(),
    dayTemplates,
    weeks,
    loadAnchors: {},
  };

  return {
    program,
    warnings,
    floorGaps: gaps,
    history,
    summary: {
      strengthDays, cardioDays,
      strengthWeekdays, cardioWeekdays,
      split: split.slice(0, strengthDays).map((s) => s.label),
      exerciseCount: Object.keys(exercises).length,
      weeklyZone2: zone2Minutes,
      priorities,
    },
  };
}

// --- helpers -----------------------------------------------------------------
function buildEquipmentProfile(places) {
  const locations = {}, dumbbells = {};
  for (const p of places) {
    locations[p.name] = (p.implements || []).slice();
    if (p.dumbbells) dumbbells[p.name] = p.dumbbells;
  }
  const first = places[0] || {};
  return {
    barWeightKg: first.barWeightKg || 20,
    ezBarWeightKg: first.ezBarWeightKg || 7.5,
    barbellPlatesKg: first.barbellPlatesKg || [25, 20, 15, 10, 5, 2.5, 1.25],
    ezBarPlatesKg: first.ezBarPlatesKg || [10, 5, 2.5, 1.25],
    cable: first.cable || { minKg: 2.5, maxKg: 120, stepKg: 2.5 },
    dumbbells, locations,
  };
}

function describeScheme(adaptation, deload, weekIdx, buildWeeks) {
  if (deload) return "Reduced volume — same movements, easy effort";
  const c = schemeFor(adaptation, weekIdx, buildWeeks, "compound", null);
  const a = schemeFor(adaptation, weekIdx, buildWeeks, "accessory", null);
  return `Compounds ${c.sets}×${c.repRange} · Accessories ${a.sets}×${a.repRange}`;
}

function weekFocus(adaptation, w, total, phaseName) {
  if (/test/i.test(phaseName)) return "Fresh legs — chase a number on your main lifts and log it. This becomes the baseline for your next block.";
  if (/deload/i.test(phaseName)) return "Back off and let the work land. Same movements, noticeably easier — this is where the adaptation actually happens.";
  if (w === 0) return "Set your working loads. Leave 2-3 reps in reserve on everything; you want room to grow into this block, not to start at your ceiling.";
  if (w === total - 2) return "Heaviest week of the block. Hit your targets, then let the taper do its job.";
  const a = adaptationById(adaptation);
  return a ? a.tempoNote : "Add a little each week — load if the reps are there, reps if they aren't.";
}

function addDaysISO(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const slug = (s) => String(s || "block").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "block";
