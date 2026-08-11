// yoga/script.js — turns a pose into the words a teacher actually says.
//
// THE STRUCTURE IS NOT INVENTED. Teaching sources converge on the same anatomy
// for cueing a pose, and this module implements exactly that order:
//
//   1. NAME IT FIRST      — people who know the pose start moving on the name.
//   2. BREATH BEFORE BODY — cue the breath, then the part, then the direction.
//   3. GROUND UP          — feet or hands first, then two or three cues working
//                           upward. `cues` below is authored in that order, and
//                           the level truncates it rather than reordering it.
//   4. REFINE, THEN OFFER — once they are in it, the way deeper or the way out.
//   5. CUE THE EXIT       — "one more breath, then we move on". Coming out badly
//                           is where people get hurt, and silence is not a cue.
//
// THE HARD LIMIT IS THREE CUES, AND ONE OR TWO FOR A BEGINNER. Comprehension
// runs out well before the pose does; a fourth cue does not land, it displaces
// the third. That is why levels.js carries a `cueBudget` and why this module
// treats it as a constraint rather than a preference.
//
// WHAT THE LEVEL ACTUALLY CHANGES. Not the pose's meaning — the amount of
// scaffolding and the vocabulary. A beginner hears plain English, no Sanskrit,
// two cues and the way in. An expert hears the Sanskrit, three cues, the
// refinement and the bind. Every level is offered the way OUT, because the one
// thing a person practising alone cannot do is ask whether it is meant to feel
// like that.

import { byId } from "./asanas.js";
import { levelById } from "./levels.js";
import { POSE_CUES } from "./cues.js";

// --- the frames ---------------------------------------------------------------
// Deliberately few, and varied by index rather than at random, so a practice
// does not open six poses in a row with the identical sentence — and so the same
// seed always produces the same words.
const ENTER_FRAMES = [
  "Now we're moving into",
  "Let's come into",
  "From here, find your way into",
  "Next up is",
  "Moving on to",
];
const HOLD_FRAMES = [
  (n) => `We'll stay here for ${n}.`,
  (n) => `Settle in — ${n} here.`,
  (n) => `Hold for ${n}.`,
  (n) => `Give this ${n}.`,
];
const EXIT_FRAMES = [
  "One more deep breath here, and then we'll move on.",
  "Last breath in this one. Enjoy it.",
  "One more breath, then we'll come out slowly.",
  "Take one more full breath here before we change.",
];
/** Said once at the very start, before anything moves. */
export const OPENING = [
  "Welcome. Find a comfortable seat, and let's begin.",
  "Take a moment to arrive. Let the breath get long and slow.",
  "Breathe in through the nose, and out through the nose. Let that be the pace for everything that follows.",
];
/** Said as savasana begins. */
export const SAVASANA_SCRIPT = [
  "Lie all the way down. Let the floor take everything.",
  "Nothing left to hold, nothing left to do. Just rest here.",
];
export const CLOSING = "That's your practice. Take that steadiness with you.";

const breathPhrase = (n) => (n === 1 ? "one breath" : `${n} breaths`);
const timePhrase = (sec) => {
  if (sec >= 90) { const m = Math.round(sec / 60); return `${m} minute${m === 1 ? "" : "s"}`; }
  return `${Math.round(sec / 5) * 5} seconds`;
};

/** Deterministic pick — same flow, same words, every time. */
const pick = (arr, i) => arr[Math.abs(i) % arr.length];

/**
 * Compose the spoken ENTRY for one pose.
 *
 * Returns { text, parts } — `parts` so the render pipeline can cut the utterance
 * into separately-cached clips later without re-deriving the structure.
 */
export function entryScript(item, levelId, index = 0) {
  const L = levelById(levelId);
  const asana = byId(item.asanaId) || {};
  const c = POSE_CUES[item.asanaId] || {};
  const parts = [];

  // 1. NAME IT — IN ENGLISH, ALWAYS.
  //
  // The Sanskrit stays ON SCREEN, where it is spelled correctly and you can read
  // it at your own pace. It is never SPOKEN, at any level, because the speech
  // engine mangles it: "Eka Pada Rajakapotasana" comes out as something no
  // teacher would recognise, and a badly-said Sanskrit name is worse than no
  // Sanskrit name — it teaches you the wrong sound.
  //
  // Phonetic respelling ("AY-ka PAH-da RAH-ja-ka-po-TAHS-ana") was the
  // alternative, and it works, but it is an approximation of a language dressed
  // up as the real thing. Showing the correct spelling and saying the English is
  // the honest version of the same trade.
  const spoken = c.spoken || (asana.name || "").toLowerCase();
  const sideWord = item.side ? `, ${String(item.side).toLowerCase()} side` : "";
  parts.push({ role: "name", text: `${pick(ENTER_FRAMES, index)} ${spoken}${sideWord}.` });

  // 2. HOW TO GET THERE.
  if (c.enter) parts.push({ role: "enter", text: c.enter });

  // 3. ALIGNMENT, GROUND UP, TRUNCATED BY THE LEVEL'S BUDGET.
  // Ground-up ordering means slicing from the FRONT drops the most foundational
  // cue — which is exactly what an expert should not be told and a beginner must.
  const skip = Math.min(L.cueSkip || 0, Math.max(0, (c.cues || []).length - 1));
  const cues = (c.cues || []).slice(skip, skip + L.cueBudget);
  for (const t of cues) parts.push({ role: "cue", text: t });

  // 4. THE WAY IN, OR THE WAY ON.
  // A beginner is never opened with the harder variation — that is the
  // hierarchy the teaching literature warns against, where the "real" pose is
  // implicitly the hard one and everything else is a lesser version of it.
  if (L.offerDeeper && c.deeper) parts.push({ role: "deeper", text: c.deeper });
  if (L.offerEasier && c.easier) parts.push({ role: "easier", text: c.easier });
  if (levelId === "beginner" && c.beginnerNote) parts.push({ role: "note", text: c.beginnerNote });
  if (levelId === "expert" && c.expertNote) parts.push({ role: "note", text: c.expertNote });

  // 5. HOW LONG. Said out loud, because not knowing how long you are staying is
  // the difference between settling and bracing.
  const dur = item.holdBreaths && !item.dynamic
    ? breathPhrase(item.holdBreaths)
    : timePhrase(item.durationSeconds || 0);
  parts.push({ role: "hold", text: pick(HOLD_FRAMES, index)(dur) });

  return { text: parts.map((p) => p.text).join(" "), parts };
}

/** The call one breath before the end of a hold. */
export function exitScript(item, levelId, index = 0) {
  const c = POSE_CUES[item.asanaId] || {};
  // Where a pose has a specific way out, say that instead of the generic line.
  if (c.exit) return { text: c.exit, parts: [{ role: "exit", text: c.exit }] };
  const t = pick(EXIT_FRAMES, index);
  return { text: t, parts: [{ role: "exit", text: t }] };
}

/**
 * A linked sun-salutation round is ONE spoken passage, not six.
 * The movements are called as they happen, the way a teacher does over a flow.
 */
export function salutationScript(variant, round, rounds, levelId) {
  const L = levelById(levelId);
  const head = round === 1
    ? `Let's take ${rounds} round${rounds === 1 ? "" : "s"} of sun salutation ${variant}.`
    : `Round ${round}.`;
  const body = variant === "A"
    ? "Inhale, reach the arms up. Exhale, fold forward. Inhale, halfway lift. Exhale, step or float back. Inhale, open the chest. Exhale, downward dog."
    : "Inhale, sink into your chair. Exhale, fold. Inhale, halfway. Exhale, back it goes. Inhale, open the chest. Exhale, downward dog. Inhale, warrior one, right side.";
  const tail = round === 1 && L.cueBudget > 1
    ? "Let the breath lead — the body follows it, not the other way around." : "";
  const text = [head, body, tail].filter(Boolean).join(" ");
  return { text, parts: [{ role: "salutation", text }] };
}

/**
 * EVERY hold sentence the composer can ever produce, enumerated.
 *
 * The render pipeline used to infer these by sweeping a hand-picked list of
 * breath counts, which silently missed two whole shapes: an odd count like seven
 * breaths, and the TIME phrasings ("40 seconds", "2 minutes") that yin and
 * restorative produce because their holds are not counted in breaths at all. A
 * practice would reach those poses and the teacher would simply not say how long
 * you were staying.
 *
 * The space is small and closed, so it is enumerated rather than sampled.
 */
export function allHoldPhrases() {
  const out = new Set();
  const say = (p) => HOLD_FRAMES.forEach((f) => out.add(f(p)));
  for (let n = 1; n <= 30; n++) say(breathPhrase(n));
  // timePhrase rounds to 5 s below 90 s, and to whole minutes above.
  for (let s = 5; s < 90; s += 5) say(timePhrase(s));
  for (let m = 1; m <= 12; m++) say(timePhrase(m * 60));
  return [...out];
}

/** Everything the script layer will ever need to say, for the render pipeline. */
export function allUtterances(levelId) {
  const out = new Map();
  const add = (key, text) => { if (text) out.set(key, text); };
  for (const t of OPENING) add("frame:opening:" + hash(t), t);
  for (const t of SAVASANA_SCRIPT) add("frame:savasana:" + hash(t), t);
  add("frame:closing", CLOSING);
  for (const t of EXIT_FRAMES) add("frame:exit:" + hash(t), t);
  return out;
}

// Small stable hash for clip filenames.
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Structural check on the authored cue content. */
export function checkScript({ asanas }) {
  const problems = [];
  for (const a of asanas) {
    if (a.phases.length === 1 && a.phases[0] === "series") continue;   // series-only, still wants cues
    const c = POSE_CUES[a.id];
    if (!c) { problems.push(`${a.id}: no spoken cues authored`); continue; }
    if (!c.enter) problems.push(`${a.id}: no entry instruction`);
    if (!c.cues || c.cues.length < 2) problems.push(`${a.id}: needs at least 2 alignment cues (has ${(c.cues || []).length})`);
    if ((c.cues || []).length > 4) problems.push(`${a.id}: ${c.cues.length} cues authored — more than 3 will never be spoken`);
    if (!c.easier) problems.push(`${a.id}: every pose must offer a way in`);
    // A pose with no way ON reads identically to an advanced and an expert
    // practitioner, which makes two of the three levels a lie. The exceptions are
    // real: savasana has no advanced version, and inventing one would be
    // inventing yoga.
    const passive = a.family === "restorative" || a.family === "breath";
    if (!passive && !c.deeper && !c.expertNote)
      problems.push(`${a.id}: no "deeper" or expert note — advanced and expert would hear the same words`);
    // Emphasis capitals are for readers of this source. A speech engine reads
    // them as an initialism or shouts them.
    const spokenAll = [c.enter, ...(c.cues || []), c.easier, c.deeper, c.beginnerNote, c.expertNote, c.exit]
      .filter(Boolean).join(" ");
    const caps = spokenAll.match(/\b[A-Z]{2,}\b/g);
    if (caps) problems.push(`${a.id}: ALL-CAPS in spoken text (${[...new Set(caps)].join(", ")})`);
    // The jargon rule, enforced rather than trusted.
    const beginnerText = [c.enter, ...(c.cues || []).slice(0, 2), c.easier].join(" ");
    for (const jargon of ["mula bandha", "uddiyana", "drishti", "bandha", "prana vayu"])
      if (beginnerText.toLowerCase().includes(jargon))
        problems.push(`${a.id}: "${jargon}" appears in the text a beginner hears`);
  }
  for (const id of Object.keys(POSE_CUES))
    if (!asanas.find((a) => a.id === id)) problems.push(`cues authored for "${id}", which is not in the library`);
  return problems;
}
