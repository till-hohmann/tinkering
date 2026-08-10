// deviations.js — what you did differently today, and what to do about it.
// Pure: no DOM, no storage. The session records deviations as they happen
// (see strength.js), this turns them into questions and applies the answers.
//
// WHY THE QUESTION IS WORTH ASKING AT ALL. A plan you keep overriding in the
// same direction isn't being overridden — it's wrong, and it stays wrong because
// correcting it means leaving the gym, opening the builder and rebuilding a
// block over a fourth set of curls. Nobody does that, so the plan and the
// training drift apart until the plan is decoration.
//
// Asked once, at the end, about what actually happened, it costs one tap.
//
// THREE ANSWERS, because two are not enough. "Yes" and "no" force a choice
// between rewriting the plan and discarding the information, and the honest
// answer is usually neither: the extra set mattered, but not enough to change
// six weeks of programming. So "consider it" keeps the signal without touching
// the template — see volumeSignal in progression.js for what it does.

import { metaFor } from "./substitution.js";

export const YES = "yes";
export const NO = "no";
export const CONSIDER = "consider";

// Build the questions from a session's deviations. Returns [] when nothing
// changed, which is the overwhelmingly common case and must cost nothing —
// a prompt that appears after an ordinary workout is a prompt people learn to
// dismiss without reading.
//
// Only deviations that SURVIVED into the log count. Adding a set and then not
// doing it, or swapping to an exercise and skipping it, changed nothing about
// the session and must not generate a question about the plan.
export function deviationQuestions(dev, program) {
  const out = [];
  const name = (id) => metaFor(program, id).name || id;
  for (const a of (dev && dev.added) || []) {
    if (!a.sets) continue;
    out.push({ key: `add:${a.exerciseId}`, kind: "added", exerciseId: a.exerciseId,
      name: name(a.exerciseId), sets: a.sets, planned: 0, actual: a.sets, delta: a.sets,
      question: `You added ${a.sets} set${a.sets === 1 ? "" : "s"} of ${name(a.exerciseId)} today.`,
      yesLabel: "Add it to the plan" });
  }
  for (const c of (dev && dev.setChanges) || []) {
    if (!c.delta || !c.actual) continue;
    const n = Math.abs(c.delta);
    out.push({ key: `sets:${c.exerciseId}`, kind: "sets", exerciseId: c.exerciseId,
      name: name(c.exerciseId), planned: c.planned, actual: c.actual, delta: c.delta,
      question: `You did ${c.actual} set${c.actual === 1 ? "" : "s"} of ${name(c.exerciseId)} instead of ${c.planned}`
        + ` — ${n} ${c.delta > 0 ? "more" : "fewer"}.`,
      yesLabel: `Make it ${c.actual} in the plan` });
  }
  return out;
}

// Apply the "yes" answers to a block. Returns a NEW program — the caller decides
// whether to save it, and a pure function that mutated the live program object
// would change the plan even when the save failed.
//
// FUTURE WEEKS ONLY. The week just trained is history: `prescribedRangeAt` reads
// the plan to work out what was asked of you at the time, so rewriting the
// current week would silently restate the past and corrupt every comparison
// that depends on it. "Include it in my program" means from next time.
export function applyTemplateDecisions(program, questions, decisions, { weekday, fromWeek } = {}) {
  const wanted = (questions || []).filter((q) => (decisions || {})[q.key] === YES);
  if (!wanted.length || !weekday) return program;

  const next = { ...program, exercises: { ...(program.exercises || {}) } };
  const applyToList = (list, q) => {
    if (!Array.isArray(list)) return list;
    if (q.kind === "sets")
      return list.map((e) => (e.exerciseId === q.exerciseId ? { ...e, prescribedSets: q.actual } : e));
    if (list.some((e) => e.exerciseId === q.exerciseId)) return list;   // already there
    // Core work stays last — an added accessory belongs before it, not after.
    const entry = { exerciseId: q.exerciseId, role: q.role || "accessory",
      prescribedSets: q.actual, repRange: q.repRange || "8-12", restSeconds: q.restSeconds || 90 };
    const coreAt = list.findIndex((e) => e.role === "core");
    if (coreAt < 0) return [...list, entry];
    return [...list.slice(0, coreAt), entry, ...list.slice(coreAt)];
  };
  const applyAll = (list) => wanted.reduce((acc, q) => applyToList(acc, q), list);

  next.weeks = (program.weeks || []).map((w) => {
    if (fromWeek != null && w.weekNumber <= fromWeek) return w;
    const day = w.days && w.days[weekday];
    if (!day || day.type !== "strength") return w;
    return { ...w, days: { ...w.days, [weekday]: { ...day, exercises: applyAll(day.exercises) } } };
  });

  // The day template is what a REGENERATED or extended block starts from, so a
  // change that lives only in `weeks` is forgotten the next time the plan grows.
  const tpl = program.dayTemplates && program.dayTemplates[weekday];
  if (tpl) next.dayTemplates = { ...program.dayTemplates, [weekday]: { ...tpl, exercises: applyAll(tpl.exercises) } };

  // An added lift needs a library entry or it renders as a raw id forever.
  for (const q of wanted) {
    if (q.kind !== "added" || next.exercises[q.exerciseId]) continue;
    const m = metaFor(program, q.exerciseId);
    next.exercises[q.exerciseId] = { name: m.name, cue: m.cue || "", implement: m.implement };
  }
  return next;
}

// Stamp the "consider it" answers onto the logged result, which is where the
// progression engine will read them next time this exercise comes round.
// Nothing is written for "yes" (the plan now says so, no nudge needed) or "no".
export function stampEffort(strengthResult, questions, decisions) {
  const byId = new Map();
  for (const q of questions || []) {
    if ((decisions || {})[q.key] !== CONSIDER) continue;
    // An added exercise has no prescribed count to deviate from, so its delta is
    // its whole volume — which would read as a huge headroom signal. What it
    // actually says is "this was extra work", i.e. one step, same as any other.
    byId.set(q.exerciseId, q.kind === "added" ? 1 : Math.sign(q.delta));
  }
  if (!byId.size) return strengthResult;
  return (strengthResult || []).map((ex) =>
    (byId.has(ex.exerciseId) ? { ...ex, extraSets: byId.get(ex.exerciseId) } : ex));
}
