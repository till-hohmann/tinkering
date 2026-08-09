// builder/adaptations.js — the 9 trainable adaptations, their protocols, and the
// interference model. Pure data + pure functions; no DOM, no storage.
//
// SOURCE. Andy Galpin's guest series on Huberman Lab (parts 1-4). Part 1 defines
// fitness as ~9 distinct adaptations and argues you assess before you program
// ("test, don't guess"). Part 2 gives the strength and hypertrophy protocols.
// Part 3 splits "endurance" into four different things with four different
// protocols. Part 4 is the design process itself, including the line this whole
// module hangs on:
//
//     "The closer they are to each other on the list, the more compatible."
//
// That makes interference COMPUTABLE rather than a table someone hand-wrote:
// the adaptations are ordered along a single neuromuscular→metabolic continuum,
// so the distance between two of them on that list predicts how well they
// coexist. Skill/speed/power sit together at one end, long-duration endurance at
// the other, and trying to build hypertrophy and speed in the same block means
// spanning most of the spectrum at once.
//
// A caveat the UI repeats: these are heuristics from a coaching framework, not
// laws. The numbers are defensible starting points, and the app's own
// progression engine adjusts from real logged performance within days.

export const ADAPTATIONS = [
  {
    id: "skill",
    name: "Skill & technique",
    short: "Skill",
    blurb: "Move well before you move heavy. Groove the patterns you'll load later.",
    // Loading parameters. `reps` is per set; `restSec` between sets.
    sets: [3, 5], reps: [3, 6], restSec: [60, 120], intensityPct: [40, 70],
    sessionsPerWeek: [2, 5],
    // Proximity to failure. Skill work is deliberately far from failure — fatigue
    // degrades the very thing you're trying to encode.
    rir: [4, 6],
    setsPerMuscleWeek: null,
    tempoNote: "Perfect reps only. Stop the set the moment form changes.",
    assess: "movement",
  },
  {
    id: "speed",
    name: "Speed",
    short: "Speed",
    blurb: "How fast you can move something light — including your own body.",
    sets: [3, 6], reps: [1, 5], restSec: [120, 300], intensityPct: [30, 60],
    sessionsPerWeek: [2, 3],
    rir: [5, 8],
    setsPerMuscleWeek: null,
    tempoNote: "Maximum intent. Every rep as fast as possible; stop when speed drops.",
    assess: "power",
  },
  {
    id: "power",
    name: "Power",
    short: "Power",
    blurb: "Force × velocity — the quality that fades fastest with age.",
    sets: [3, 6], reps: [1, 5], restSec: [120, 300], intensityPct: [30, 80],
    sessionsPerWeek: [2, 3],
    rir: [4, 6],
    setsPerMuscleWeek: null,
    tempoNote: "Explosive concentric, controlled return. Quality over quantity.",
    assess: "power",
  },
  {
    id: "strength",
    name: "Strength",
    short: "Strength",
    blurb: "Maximum force. Mostly a nervous-system skill, so it needs low fatigue and long rests.",
    // Galpin's "3 to 5" heuristic: 3-5 exercises, 3-5 reps, 3-5 sets,
    // 3-5 min rest, 3-5 days a week.
    sets: [3, 5], reps: [3, 5], restSec: [180, 300], intensityPct: [85, 95],
    sessionsPerWeek: [3, 5],
    rir: [1, 2],
    setsPerMuscleWeek: [10, 15],
    exercisesPerSession: [3, 5],
    tempoNote: "Intent to move the bar fast even when it moves slowly.",
    assess: "strength",
  },
  {
    id: "hypertrophy",
    name: "Muscle size",
    short: "Hypertrophy",
    blurb: "Volume is the driver here — total hard sets per muscle per week.",
    sets: [3, 5], reps: [6, 15], restSec: [60, 150], intensityPct: [60, 80],
    sessionsPerWeek: [3, 5],
    rir: [0, 3],
    // ~10-20 hard sets per muscle per week; more for advanced lifters.
    setsPerMuscleWeek: [10, 20],
    exercisesPerSession: [4, 7],
    tempoNote: "Controlled eccentric, full range. Take sets within 0-3 reps of failure.",
    assess: "strength",
  },
  {
    id: "muscular_endurance",
    name: "Muscular endurance",
    short: "Musc. endurance",
    blurb: "Repeated contractions without failing — high reps and long holds.",
    sets: [2, 4], reps: [15, 30], restSec: [30, 90], intensityPct: [30, 60],
    sessionsPerWeek: [2, 4],
    rir: [0, 2],
    setsPerMuscleWeek: [8, 16],
    exercisesPerSession: [4, 6],
    tempoNote: "Steady tempo, minimal rest. The burn is the point.",
    assess: "muscular_endurance",
  },
  {
    id: "anaerobic",
    name: "Anaerobic capacity",
    short: "Anaerobic",
    blurb: "All-out efforts of 20-60 s, and how fast you recover from them.",
    sets: [4, 10], reps: null, restSec: [120, 300], intensityPct: [90, 100],
    sessionsPerWeek: [1, 2],
    rir: null,
    setsPerMuscleWeek: null,
    intervalSec: [20, 60],
    tempoNote: "Genuinely all-out. Long recoveries — this is not a conditioning circuit.",
    assess: "anaerobic",
  },
  {
    id: "vo2max",
    name: "Maximal aerobic capacity",
    short: "VO₂max",
    blurb: "The single strongest predictor of all-cause mortality in the fitness battery.",
    sets: [4, 6], reps: null, restSec: [180, 240], intensityPct: [90, 95],
    sessionsPerWeek: [1, 2],
    rir: null,
    setsPerMuscleWeek: null,
    // The classic 4x4: four minutes hard, four minutes easy, four to six rounds.
    intervalSec: [180, 300],
    tempoNote: "Hard efforts of 3-5 min at 90-95% max HR, equal easy recovery.",
    assess: "vo2max",
  },
  {
    id: "long_endurance",
    name: "Long-duration endurance",
    short: "Endurance",
    blurb: "The Zone 2 base: mitochondria, capillaries, fat oxidation, metabolic health.",
    sets: null, reps: null, restSec: null, intensityPct: [60, 70],
    sessionsPerWeek: [2, 5],
    rir: null,
    setsPerMuscleWeek: null,
    // 150-180+ min per week, accumulable through daily activity.
    weeklyMinutes: [150, 240],
    tempoNote: "Conversational pace. If you can't talk in sentences, slow down.",
    assess: "vo2max",
  },
];

export const byId = (id) => ADAPTATIONS.find((a) => a.id === id) || null;
export const adaptationIndex = (id) => ADAPTATIONS.findIndex((a) => a.id === id);

// --- interference ------------------------------------------------------------
// Distance along the ordered list, normalised to 0-1. 0 = adjacent (fully
// compatible), 1 = opposite ends (skill vs long-duration endurance).
export function interference(idA, idB) {
  const i = adaptationIndex(idA), j = adaptationIndex(idB);
  if (i < 0 || j < 0 || i === j) return 0;
  return Math.abs(i - j) / (ADAPTATIONS.length - 1);
}

// Turn that into an actionable verdict. The thresholds are judgement calls, but
// they map onto the three things a program can actually DO about interference:
// nothing, separate the sessions, or stop trying to train both at once.
export function compatibility(idA, idB) {
  const d = interference(idA, idB);
  if (d <= 0.25) {
    return { level: "compatible", distance: d,
      advice: "These train well together — you can pair them in the same session." };
  }
  if (d <= 0.5) {
    return { level: "manageable", distance: d,
      advice: "Trainable together, but keep the higher-priority quality first in the session, or put them on different days." };
  }
  return { level: "conflicting", distance: d,
    advice: "These pull in opposite directions. Separate them by at least 6 hours — better, give each its own block and maintain the other." };
}

// Score a whole priority list. Returns the worst pair plus every conflicting
// pair, so the wizard can warn BEFORE someone builds a block that fights itself.
export function analysePriorities(ids) {
  const picks = (ids || []).filter(Boolean);
  const pairs = [];
  for (let i = 0; i < picks.length; i++) {
    for (let j = i + 1; j < picks.length; j++) {
      pairs.push({ a: picks[i], b: picks[j], ...compatibility(picks[i], picks[j]) });
    }
  }
  const conflicting = pairs.filter((p) => p.level === "conflicting");
  const worst = pairs.slice().sort((x, y) => y.distance - x.distance)[0] || null;
  return { pairs, conflicting, worst,
    // Two priorities is the sweet spot; three is workable if they're close;
    // more than three and nothing gets a real dose.
    tooMany: picks.length > 3,
    spread: worst ? worst.distance : 0 };
}

// Order adaptations within a session: most neural first, because the qualities
// at the top of the list are the ones fatigue destroys. This is Galpin's
// "train the highest-priority/most-neural quality first".
export const sessionOrder = (ids) =>
  (ids || []).slice().sort((a, b) => adaptationIndex(a) - adaptationIndex(b));

// Is this adaptation trained with weights, with cardio, or either? Drives which
// day templates the generator builds.
export const MODALITY = {
  skill: "strength", speed: "strength", power: "strength", strength: "strength",
  hypertrophy: "strength", muscular_endurance: "strength",
  anaerobic: "cardio", vo2max: "cardio", long_endurance: "cardio",
};
export const isCardio = (id) => MODALITY[id] === "cardio";
export const isStrength = (id) => MODALITY[id] === "strength";

// --- the minimum effective weekly template -----------------------------------
// Galpin's "if you only did this" floor, from part 4. The builder uses it to
// warn when a plan drops below what he'd call a maintenance dose for health,
// regardless of what the user is chasing.
export const WEEKLY_FLOOR = {
  zone2Minutes: 150,
  resistanceSessions: 2,
  vo2Sessions: 1,
  powerWork: true,
};

// Check a generated plan against that floor. Returns human-readable gaps rather
// than a score — the point is to tell someone what they're giving up, not to
// grade them.
export function floorGaps({ zone2Minutes = 0, resistanceSessions = 0, vo2Sessions = 0, hasPower = false }) {
  const gaps = [];
  if (zone2Minutes < WEEKLY_FLOOR.zone2Minutes) {
    gaps.push(`Zone 2 is at ${Math.round(zone2Minutes)} min/week; the health floor is ${WEEKLY_FLOOR.zone2Minutes}. Walking counts.`);
  }
  if (resistanceSessions < WEEKLY_FLOOR.resistanceSessions) {
    gaps.push(`Only ${resistanceSessions} resistance session${resistanceSessions === 1 ? "" : "s"} a week. Two is the floor for keeping muscle.`);
  }
  if (vo2Sessions < WEEKLY_FLOOR.vo2Sessions) {
    gaps.push("No hard aerobic session. One a week protects VO₂max, the strongest longevity marker in the battery.");
  }
  if (!hasPower) {
    gaps.push("No power or explosive work. Fast-twitch function declines fastest with age and is the hardest to get back.");
  }
  return gaps;
}

// --- progression rates -------------------------------------------------------
// Galpin's step 7/8: roughly 3% a week on load, ~5% on volume, and never more
// than 10%. Expressed as multipliers so the generator can apply them per week.
export const PROGRESSION = {
  intensityPerWeek: 0.03,
  volumePerWeek: 0.05,
  volumeMaxPerWeek: 0.10,
};

// --- block shapes ------------------------------------------------------------
// Two cadences, both defensible, and the builder offers both rather than picking.
// "Classic" is Galpin's: load for ~6 weeks, then a deload. "Taper & test" is the
// pattern this app's own author validated across two blocks — no mid-block
// deload, one taper-and-test week closing the block, using daily readiness as
// the in-week valve instead. The second loses ~12% fewer training weeks.
export const BLOCK_SHAPES = [
  {
    id: "classic",
    name: "Load then deload",
    blurb: "Six weeks building, one week easy. The standard cadence — predictable, and it banks recovery on a schedule.",
    // Deload every 7th week, and always close the block on one. The naive
    // version of this ("every 7th OR the last week") produced TWO CONSECUTIVE
    // deloads at 8, 15, 22... weeks, which is a fortnight of detraining rather
    // than a recovery week — so any run of two collapses back to a build week.
    build: (weeks) => {
      const out = Array.from({ length: weeks }, (_, i) => ((i + 1) % 7 === 0 ? "Deload and Recover" : "Build"));
      if (weeks > 1) out[weeks - 1] = "Deload and Recover";
      for (let i = 1; i < weeks; i++) {
        if (out[i] === "Deload and Recover" && out[i - 1] === "Deload and Recover") out[i - 1] = "Build";
      }
      return out;
    },
  },
  {
    id: "taper_test",
    name: "Build then taper & test",
    blurb: "No mid-block deload — one taper-and-test week closes the block, and you use daily readiness to ease off when you actually need it. More training weeks, but it asks you to be honest on bad days.",
    build: (weeks) => Array.from({ length: weeks }, (_, i) =>
      i === weeks - 1 ? "Deload and Test" : "Build"),
  },
];
export const blockShape = (id) => BLOCK_SHAPES.find((b) => b.id === id) || BLOCK_SHAPES[0];
