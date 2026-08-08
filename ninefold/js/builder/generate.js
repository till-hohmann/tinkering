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
  analysePriorities, blockShape, PROGRESSION, floorGaps } from "./adaptations.js";
import { EXERCISE_LIBRARY, PATTERNS, availableAt, pickForPattern, byId as exerciseById } from "../exercise-library.js";

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
    { label: "Lower A", patterns: ["squat", "hinge", "lunge", "calf", "core"] },
    { label: "Upper A", patterns: ["push_h", "pull_h", "push_v", "arm", "delt"] },
    { label: "Lower B", patterns: ["hinge", "squat", "lunge", "calf", "core"] },
    { label: "Upper B", patterns: ["pull_v", "push_h", "pull_h", "delt", "arm"] },
  ],
  5: [
    { label: "Lower A", patterns: ["squat", "hinge", "lunge", "calf", "core"] },
    { label: "Upper A", patterns: ["push_h", "pull_h", "push_v", "arm"] },
    { label: "Lower B", patterns: ["hinge", "lunge", "squat", "calf"] },
    { label: "Upper B", patterns: ["pull_v", "push_h", "delt", "arm"] },
    { label: "Full body", patterns: ["squat", "push_v", "pull_h", "core"] },
  ],
};
const splitFor = (n) => SPLITS[Math.max(1, Math.min(5, n))] || SPLITS[3];

// --- rep schemes -------------------------------------------------------------
// A week's prescription per adaptation and role. Intensity progression is
// expressed as the rep range TIGHTENING and dropping across the block (fewer
// reps at the same effort = more load, which is what ~3%/week looks like when
// you can only load real plates). Volume progression is the set count rising.
function schemeFor(adaptation, weekIdx, totalBuildWeeks, role, exercise) {
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

  // Sets: start at the low end, add roughly a set per third of the block, never
  // exceeding the adaptation's own ceiling. This lands near +5%/week on volume
  // without ever jumping more than the 10% cap.
  const [setLo, setHi] = a.sets || [3, 4];
  const step = totalBuildWeeks > 1 ? Math.floor((weekIdx / totalBuildWeeks) * (setHi - setLo + 1)) : 0;
  const sets = Math.min(setHi, setLo + step) - (isCompound ? 0 : (role === "core" ? 1 : 0));

  // Reps. `a.reps` is the adaptation's whole VALID SPAN, not a prescription —
  // hypertrophy's span is 6-15, and prescribing "3×6-15" tells the lifter
  // nothing. So narrow it to a workable band ~3 reps wide: compounds take the
  // heavy end of the span, accessories the light end, where they belong (they
  // exist for volume, not load, and on light kit high reps are the only way to
  // make an accessory hard at all).
  const span = a.reps || [8, 12];
  const width = Math.max(2, Math.round((span[1] - span[0]) / 3));
  let lo, hi;
  if (isCompound) {
    lo = span[0];
    hi = Math.min(span[1], span[0] + width);
  } else {
    const mid = Math.round(span[0] + (span[1] - span[0]) * 0.55);
    lo = mid;
    hi = Math.min(span[1], mid + width + 1);
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

// Rest per role, taken from the adaptation's own range: compounds get the top of
// it (full neural recovery), accessories the bottom.
function restFor(adaptation, role) {
  const a = adaptationById(adaptation) || adaptationById("hypertrophy");
  const [lo, hi] = a.restSec || [90, 150];
  if (role === "compound") return hi;
  if (role === "core") return Math.max(45, lo);
  return Math.round((lo + hi) / 2);
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
function cardioPrescription(adaptation, weekIdx, totalBuildWeeks) {
  const grow = 1 + PROGRESSION.volumePerWeek * weekIdx;
  if (adaptation === "vo2max") {
    const rounds = Math.min(6, 4 + Math.floor(weekIdx / 2));
    return { label: "VO₂max intervals", prescription: `${rounds} × 4 min hard (Zone 4-5) / 4 min easy`, zone: 4, minutes: rounds * 8 + 15 };
  }
  if (adaptation === "anaerobic") {
    const rounds = Math.min(12, 6 + weekIdx);
    return { label: "Anaerobic intervals", prescription: `${rounds} × 30 s all-out / 2:30 easy`, zone: 5, minutes: rounds * 3 + 15 };
  }
  const base = 40;
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

// --- the generator -----------------------------------------------------------
export function generateProgram(input) {
  const {
    name, startDate, lengthWeeks = 6,
    priorities = ["hypertrophy"],
    daysPerWeek = 3,
    availableDays = WEEKDAYS,
    places = [],
    blockShapeId = "classic",
    goalText = "",
  } = input || {};

  const warnings = [];
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
  const perWeek = Math.min(daysPerWeek, usableDays.length);
  if (perWeek < daysPerWeek) {
    warnings.push(`You asked for ${daysPerWeek} sessions but marked only ${usableDays.length} days available, so the plan uses ${perWeek}.`);
  }
  const { strengthDays, cardioDays } = allocateDays(priorities, perWeek);

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
  const missingPatterns = new Set();

  strengthWeekdays.forEach((weekday, i) => {
    const dayPlan = split[i % split.length];
    const chosen = [];
    const used = [];
    for (const pattern of dayPlan.patterns) {
      const pick = pickForPattern(pattern, pool, { exclude: used });
      if (!pick) { missingPatterns.add(pattern); continue; }
      used.push(pick.id);
      exercises[pick.id] = { name: pick.name, cue: pick.cue, implement: pick.implement };
      chosen.push({ exerciseId: pick.id, role: pick.role, restSeconds: restFor(strengthAdaptation, pick.role) });
    }
    // Step 6: most neural first. Compounds lead, isolation follows, core last —
    // fatigue from a set of curls costs you nothing on a squat, but the reverse
    // is not true.
    const rank = { compound: 0, accessory: 1, core: 2 };
    chosen.sort((a, b) => rank[a.role] - rank[b.role]);
    dayTemplates[weekday] = {
      weekday, location: primaryPlace, type: "strength",
      label: dayPlan.label, preRoutine: "warmupStrength", postRoutine: "cooldownStrength",
      exercises: chosen, supersets: [],
    };
  });

  cardioWeekdays.forEach((weekday, i) => {
    const adaptation = cardioAdaptations.length ? cardioAdaptations[i % cardioAdaptations.length] : "long_endurance";
    const p = cardioPrescription(adaptation, 0, lengthWeeks);
    dayTemplates[weekday] = {
      weekday, location: primaryPlace, type: "cardio",
      label: p.label, preRoutine: "warmupCardio", postRoutine: "cooldownCardio",
      adaptation, exercises: [], supersets: [],
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
        const p = cardioPrescription(tpl.adaptation, deload ? Math.max(0, buildIdx - 2) : buildIdx, buildWeeks);
        days[weekday] = { weekday, type: "cardio", prescription: deload ? `Easy ${Math.round(p.minutes * 0.6)} min, Zone 2` : p.prescription };
        continue;
      }
      days[weekday] = {
        weekday, type: "strength",
        exercises: tpl.exercises.map((e) => {
          const s = schemeFor(strengthAdaptation, deload ? 0 : buildIdx, buildWeeks, e.role, exerciseById(e.exerciseId));
          return {
            // A deload cuts VOLUME and keeps the movement pattern; a test week
            // keeps load and cuts volume harder. Both are handled by the app's
            // own engine at run time too, but the plan should read honestly.
            prescribedSets: deload ? Math.max(2, s.sets - (isTest ? 2 : 1)) : s.sets,
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
  const zone2Minutes = cardioWeekdays.reduce((sum, d, i) => {
    const ad = cardioAdaptations.length ? cardioAdaptations[i % cardioAdaptations.length] : "long_endurance";
    return sum + (ad === "long_endurance" ? cardioPrescription(ad, 0, lengthWeeks).minutes : 0);
  }, 0);
  const gaps = floorGaps({
    zone2Minutes,
    resistanceSessions: strengthDays,
    vo2Sessions: cardioAdaptations.filter((a) => a === "vo2max" || a === "anaerobic").length ? cardioWeekdays.length : 0,
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
