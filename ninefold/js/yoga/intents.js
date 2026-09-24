// yoga/intents.js — what you actually pick before a practice. Pure data.
//
// YOU PICK A PURPOSE AND A LENGTH; THE APP PICKS THE STYLE. This is deliberate
// and it is the one design decision here taken from outside the training
// literature. The yoga classes people actually complete are titled by intent and
// duration — "20 minute yoga for lower back", "morning yin" — and the style word
// is a subtitle at most. Asking someone to choose between Vinyasa and Hatha
// before they can practise is asking them to know the answer to get the question.
// The chosen style is always NAMED on the way in, and can be overridden.
//
// EACH INTENT DECLARES WHAT IT SUBSTITUTES, and the honesty of that field is the
// whole point:
//   "strength"  — a real session, but NOT an equivalent one. Yoga is isometric
//                 work; isometric training transfers to isometric strength
//                 (SMD 0.43) and not to dynamic strength (SMD -0.20, ns), and is
//                 highly joint-angle specific. It will not maintain a squat.
//   "mobility"  — cleanly equivalent. Yin, restorative, hatha and mobility-biased
//                 flows ARE mobility and stability work: same job, same intensity
//                 band, same progression logic.
//   null        — a standalone extra. Low fatigue cost, complements everything.
//
// NOTHING here substitutes a cardio session, at any length or vigour.

import { LIMITATION_KEYS } from "./asanas.js";

const I = (id, label, blurb, style, opts = {}) => ({
  id, label, blurb, style,
  substitutes: opts.substitutes === undefined ? "mobility" : opts.substitutes,
  // Family weights. 1 is neutral; >1 pulls the generator toward that family,
  // 0 excludes it. These are what makes "after a run" different from "wake up"
  // at the same length and style.
  emphasis: opts.emphasis || {},
  // Peaks this intent is willing to climb to. Empty means no peak at all, which
  // is correct for yin and for anything meant to end the day.
  peaks: opts.peaks || [],
  minutes: opts.minutes || [10, 15, 20, 30, 45, 60],
  defaultMinutes: opts.defaultMinutes || 20,
  // Style the user may switch to without the intent stopping making sense.
  alternatives: opts.alternatives || [],
  // The length is a consequence of the postures rather than a choice, so the
  // picker shows the computed duration instead of offering lengths.
  fixedLength: !!opts.fixedLength,
  note: opts.note || "",
});

export const INTENTS = [
  I("wake_up", "Wake up",
    "Short, warming, on the feet. Something to start the day on.",
    "vinyasa", {
      substitutes: null,
      emphasis: { standing: 1.6, backbend: 1.3, balance: 1.2, restorative: 0.4, hip_opener: 0.8 },
      peaks: ["ardha_chandrasana", "virabhadrasana_3", "utthita_hasta_padangusthasana", "parivrtta_trikonasana"],
      minutes: [10, 15, 20, 30],
      defaultMinutes: 15,
      alternatives: ["hatha"],
    }),

  I("strong_flow", "Strong flow",
    "A vigorous practice with a real peak. Counts as a session — not as a lifting session.",
    "vinyasa", {
      substitutes: "strength",
      emphasis: { standing: 1.5, core: 1.5, balance: 1.3, backbend: 1.2, restorative: 0.5 },
      peaks: ["bakasana", "urdhva_dhanurasana", "natarajasana", "ardha_chandrasana",
        "parivrtta_parsvakonasana", "virabhadrasana_3", "parivrtta_trikonasana"],
      minutes: [20, 30, 45, 60],
      defaultMinutes: 45,
      alternatives: ["hatha"],
      note: "Conditioning, positional strength and skill. It will not maintain a squat or a bench.",
    }),

  I("hips_low_back", "Hips & low back",
    "The two areas a desk and a barbell both take from. Slow, held, floor-heavy.",
    "hatha", {
      emphasis: { hip_opener: 2.2, forward_fold: 1.5, twist: 1.4, supine: 1.3, balance: 0.4, core: 0.5 },
      peaks: [],
      minutes: [10, 15, 20, 30, 45],
      defaultMinutes: 20,
      alternatives: ["yin"],
    }),

  I("post_run", "After a run",
    "Calves, hamstrings and hip flexors, with nothing that asks the legs to work again.",
    "hatha", {
      emphasis: { forward_fold: 2.0, hip_opener: 1.8, supine: 1.4, standing: 0.6, core: 0.2,
        balance: 0.2, inversion: 0.6 },
      peaks: [],
      minutes: [10, 15, 20, 30],
      defaultMinutes: 15,
      alternatives: ["yin"],
    }),

  I("shoulders_neck", "Shoulders & neck",
    "Upper back, chest and shoulders — the pressing side of a training week, undone.",
    "hatha", {
      emphasis: { backbend: 1.8, twist: 1.5, seated: 1.3, supine: 1.2, standing: 0.6,
        hip_opener: 0.5, balance: 0.3, core: 0.4 },
      peaks: [],
      minutes: [10, 15, 20, 30],
      defaultMinutes: 15,
      alternatives: ["yin"],
    }),

  I("full_body", "Move everything",
    "A balanced practice that visits every family once. The default when nothing hurts.",
    "hatha", {
      emphasis: {},
      peaks: ["utthita_hasta_padangusthasana", "parivrtta_trikonasana", "ustrasana", "virabhadrasana_3"],
      minutes: [15, 20, 30, 45, 60],
      defaultMinutes: 30,
      alternatives: ["vinyasa", "yin"],
    }),

  I("wind_down", "Wind down",
    "Long passive holds. Muscles off, gravity doing the work.",
    "yin", {
      emphasis: { hip_opener: 1.8, forward_fold: 1.6, supine: 1.5, twist: 1.3, restorative: 1.4,
        standing: 0, balance: 0, core: 0, inversion: 0.3 },
      peaks: [],
      minutes: [15, 20, 30, 45, 60],
      defaultMinutes: 30,
      alternatives: ["restorative", "hatha"],
    }),

  I("sleep", "Before bed",
    "Fully supported, almost nothing to hold. Ends where you are already lying down.",
    "restorative", {
      substitutes: null,
      emphasis: { restorative: 2.5, supine: 1.8, forward_fold: 1.2, hip_opener: 1.0,
        standing: 0, balance: 0, core: 0, backbend: 0.3, inversion: 0.4 },
      peaks: [],
      minutes: [10, 15, 20, 30],
      defaultMinutes: 15,
      alternatives: ["yin"],
    }),

  I("ashtanga", "Ashtanga Primary",
    "The full Primary Series as it is actually practised: fixed order, five breaths, every time.",
    "ashtanga", {
      substitutes: "strength",
      emphasis: {},
      peaks: [],
      minutes: [90],
      defaultMinutes: 90,
      fixedLength: true,
      alternatives: [],
      note: "Authored, not generated — a fixed series is fixed by definition.",
    }),
];

const BY_ID = new Map(INTENTS.map((i) => [i.id, i]));
export const intentById = (id) => BY_ID.get(id) || null;

/** Emphasis weight for a family under this intent. 1 = neutral. */
export const emphasisFor = (intent, family) => {
  const e = (intent && intent.emphasis) || {};
  return e[family] === undefined ? 1 : e[family];
};

/**
 * What a completed session of this intent means for the week.
 * Adherence always; hard sets never.
 */
export function accountingFor(intent) {
  return {
    countsForAdherence: true,
    hardSets: 0,                                     // decided, and shown rather than hidden
    substitutes: intent ? intent.substitutes : null,
    cardio: false,
  };
}

export function checkIntents({ styles, asanas } = {}) {
  const problems = [];
  const seen = new Set();
  for (const i of INTENTS) {
    if (seen.has(i.id)) problems.push(`${i.id}: duplicate intent`);
    seen.add(i.id);
    if (styles && !styles[i.style]) problems.push(`${i.id}: unknown style "${i.style}"`);
    for (const s of i.alternatives) if (styles && !styles[s]) problems.push(`${i.id}: unknown alternative style "${s}"`);
    for (const p of i.peaks) if (asanas && !asanas(p)) problems.push(`${i.id}: peak "${p}" is not in the library`);
    for (const p of i.peaks) if (asanas && asanas(p) && !asanas(p).peak) problems.push(`${i.id}: "${p}" is listed as a peak but the library says it is not one`);
    if (!i.minutes.includes(i.defaultMinutes)) problems.push(`${i.id}: default ${i.defaultMinutes} min is not one of its offered lengths`);
    if (i.substitutes !== null && i.substitutes !== "strength" && i.substitutes !== "mobility")
      problems.push(`${i.id}: substitutes "${i.substitutes}" is not a thing a session can substitute`);
  }
  // A guard against the one mistake that would make the app lie about training.
  for (const i of INTENTS) if (String(i.substitutes) === "cardio") problems.push(`${i.id}: yoga is never a cardio substitute`);
  for (const k of LIMITATION_KEYS) if (typeof k !== "string") problems.push("limitation keys must be strings");
  return problems;
}
