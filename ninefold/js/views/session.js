// session.js — orchestrates one Day: Pre-routine → Core → Post-routine → Notes → Summary
// (requirements §5/§6/§8). Builds a Session, saves it, and routes to the summary.

import { getActiveProgram, getProgram, resolveDay, saveSession, exerciseHistory, getLastLocation, setLastLocation, setBodyweight,
  getDraft, setDraft, clearDraft , exerciseHistoryAcross, getAllPrograms, equipmentForProgram,
  getStretchProg, setStretchProg, saveProgram } from "../store.js";
import { deviationQuestions, applyTemplateDecisions, stampEffort, YES, NO, CONSIDER } from "../deviations.js";
import { getProfile, patchProfile, placeNames, withPlace } from "../profile.js";
import { applyStretchTargets, applyStretchResults } from "../stretch.js";
import { todayISO } from "../model.js";
import * as M from "../model.js";
import { el, mount, go, locationBadge, clear, backBtn, addActionBar, setChildren } from "../ui.js";
import { illustration, workoutFigure } from "../illustrations.js";
import { unlockAudio } from "../components/sound.js";
import { interruptSheet } from "../components/interrupt.js";
import { recommend, roundLoad, isDeloadWeek } from "../progression.js";
import { needsSub, primarySubstitute, candidatesFor, isApprox, metaFor, seedSubLoad,
  backCalcOriginal, SUB_EXERCISES } from "../substitution.js";
import { runRoutine, isStretch } from "./routine.js";
import { isStrengthHold } from "../holds.js";
import { runStrength } from "./strength.js";
import { runCardioCore, logCardio } from "./cardio.js";
import { recoveryToday, body as trackerBody, provider, has, CAP } from "../health/index.js";
import { placeEditor, blankPlace, tidyPlace } from "../components/place-editor.js";
import { weightLabel, weightValue, weightToKg, readEdit } from "../units.js";

const repLo = (range) => { const n = (range || "").match(/\d+/); return n ? Number(n[0]) : 8; };
const isTimedSets = (ex) => ex && ex.sets && ex.sets.length && ex.sets.every((s) => s.reps == null);
function anchorLoad(program, id) {
  const a = program.loadAnchors && program.loadAnchors[id];
  const n = a && String(a).match(/\d+(\.\d+)?/);
  return n ? Number(n[0]) : null;
}
function prescribedRangeAt(program, weekNumber, weekday, exerciseId) {
  const wk = (program.weeks || []).find((w) => w.weekNumber === weekNumber);
  const d = wk && wk.days && wk.days[weekday];
  const ex = d && (d.exercises || []).find((e) => e.exerciseId === exerciseId);
  return ex ? ex.repRange : null;
}

function addDaysISO(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const pad = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// Thrown by a core phase when the user chooses to leave the workout (X button):
// "later" keeps the saved draft, "discard" throws it away, "complete" logs what's
// been done so far. Unwinds the linear session flow so we don't march on to the
// cool-down / notes.
class SessionExit { constructor(kind) { this.kind = kind; } }

// Entry: today's scheduled session (logs under today, as always).
export async function renderSession(iso) {
  const program = await getActiveProgram();
  const r = resolveDay(program, iso);
  return runSession({ program, ...r, srcIso: iso, logDate: iso });
}

// Entry: "do this planned day now" — start ANY programmed day (past, future, or
// another block) and log it under TODAY. The picked day supplies
// the exercises / prescription and its own weekday-chain drives progression
// (srcIso = the plan day's real date, used only for history + week lookups); the
// saved session is dated today.
export async function renderPlannedSession(pid, weekNumber, weekday) {
  const program = (await getProgram(pid)) || (await getActiveProgram());
  const week = (program.weeks || []).find((w) => w.weekNumber === weekNumber);
  const day = week ? week.days[weekday] : null;
  const template = program.dayTemplates ? program.dayTemplates[weekday] : null;
  const srcIso = week ? addDaysISO(week.startDate, M.WEEKDAYS.indexOf(weekday)) : todayISO();
  return runSession({ program, weekNumber, weekday, week, day, template, srcIso, logDate: todayISO() });
}

async function runSession({ program, weekNumber, weekday, week, day, template, srcIso, logDate }) {
  if (!day || day.type === "rest") {
    return mount([el("div.card", {}, [el("h2", { text: "Rest day" }),
      el("button.btn.block", { onclick: () => go("#/") }, "Back")])]);
  }

  const stage = el("div.stage");
  mount([stage]);

  const draftId = `sess-${logDate}-${weekday}`;
  let draft = {
    id: draftId,
    date: logDate, programId: program.id, weekNumber, weekday,
    location: template.location, type: day.type,
    preRoutineDone: false, postRoutineDone: false,
    cardioResult: null, strengthResult: [], sessionNotes: {},
    completedAt: null, source: "app",
    // store the cardio prescription so later analytics can tell interval days
    // from steady days (VO2max trend uses steady runs only)
    ...(day.type === "cardio" ? { prescription: day.prescription || "" } : {}),
  };

  // Resume an interrupted session? If a saved draft for this day has real logged
  // progress, offer to continue from where it stopped (so a call / reload / swipe
  // mid-workout doesn't lose the sets already logged).
  let resuming = false;
  const persist = () => { try { setDraft(draft); } catch {} };
  try {
    const saved = await getDraft();
    const hasProgress = saved && ((saved.strengthResult && saved.strengthResult.length) || saved.cardioResult || (saved._exIndex | 0) > 0);
    if (saved && saved.id === draftId && !saved.completedAt && hasProgress) {
      const choice = await resumePrompt(stage, saved, day);
      if (choice === "continue") { draft = { ...draft, ...saved }; resuming = true; }
      else if (choice === "complete") { return finalizeAndSave({ ...draft, ...saved }); }
      else { await clearDraft(); }   // "discard" → drop it, start fresh below
    } else if (saved && saved.date !== logDate) {
      await clearDraft();   // stale draft from another day
    }
  } catch {}

  // finalize helper — shared by the normal end-of-flow and the "complete now"
  // exits. Stamps completion, saves, clears the draft, routes to the summary.
  async function finalizeAndSave(d) {
    const now = new Date();
    d.completedAt = `${logDate}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:00`;
    delete d._exIndex;
    await saveSession(d);
    await clearDraft();
    go(weekday === "Sat" ? `#/weeksummary/${weekNumber}` : `#/summary/${d.id}`);
  }

  // "leave the workout" (X button) → save-for-later / complete-now / discard.
  // A core phase rejects its promise with SessionExit so the flow unwinds here.
  function handleExit(kind) {
    if (kind === "complete") return finalizeAndSave(draft);
    if (kind === "later") { persist(); go("#/"); return; }   // keep the saved draft
    return clearDraft().then(() => go("#/"));                 // discard
  }

  // promise-wrapped phases ---------------------------------------------------
  // Warm-ups and cool-downs now progress their stretches the way the mobility
  // sessions already did: the target comes from what you last actually held, and
  // stopping early is recorded rather than invisible. Dynamic items are untouched.
  const routinePhase = (routineKey, title) =>
    new Promise(async (res) => {
      const raw = program.routines[routineKey];
      if (!raw) return res(true);
      const prog = await getStretchProg();
      // A STRENGTH HOLD IS TRACKED TOO. isStretch happens to match dead hang by
      // name, but not plank, side plank or hollow hold — so a routine carrying
      // those offered no end-hold button and recorded nothing, which is the same
      // silence the stretches were in before they got an engine.
      const tracked = (it) => isStretch(it) || isStrengthHold(it);
      const { def, items } = applyStretchTargets(raw, prog, tracked);
      runRoutine(stage, def, program, {
        title, trackHolds: true, trackWhen: tracked,
        onComplete: async ({ completed, holds }) => {
          try {
            const { state } = applyStretchResults(prog, items, holds);
            if (holds && holds.length) await setStretchProg(state);
          } catch (err) { console.warn("stretch progression skipped", err); }
          res(completed);
        },
      });
    });

  // The Wednesday interval finisher (Block 2+): the "+ Intervals" the day label
  // promises. Builds the guided 30/30 block from template.finisherIntervals —
  // rounds grow weekly (base + addPerWeek, capped), taper/test weeks default to
  // skip — and runs it through the routine engine with cues + timer.
  const finisherPhase = () => new Promise((res) => {
    const f = template.finisherIntervals;
    const rounds = Math.min(f.baseRounds + (weekNumber - 1) * (f.addPerWeek || 0), f.maxRounds || 99);
    const taper = /taper|test|deload/i.test((week && week.phaseName) || "");
    const start = () => {
      const items = [{ id: "easy_cardio", name: "Spin easy — get ready", mode: "timed",
        durationSeconds: 60, bilateral: false, cue: "Settle in on the bike or crosstrainer" }];
      for (let r = 1; r <= rounds; r++) {
        items.push({ id: "bike_hard", name: `HARD ${r}/${rounds}`, mode: "timed",
          durationSeconds: f.workSec, bilateral: false, cue: "RPE 9 — drive the legs" });
        if (r < rounds) items.push({ id: "bike_easy", name: "Easy spin", mode: "timed",
          durationSeconds: f.easySec, bilateral: false, cue: "Light and loose" });
      }
      runRoutine(stage, { rounds: 1, transitionSeconds: 0, items }, program, {
        title: "Intervals",
        onComplete: ({ completed }) =>
          res(completed ? { done: true, rounds, workSec: f.workSec, easySec: f.easySec }
                        : { done: false, skipped: true }),
      });
    };
    clear(stage);
    stage.appendChild(el("div.row", { style: "gap:12px" }, [
      el("div.illotile", { style: "width:52px;height:52px;flex:none;padding:0" }, [illustration("bike")]),
      el("div", { style: "min-width:0" }, [
        el("div.label", { text: "Finisher" }),
        el("h2", { style: "margin:2px 0 0", text: `Intervals · ${rounds} × ${f.workSec}s/${f.easySec}s` }),
      ]),
    ]));
    stage.appendChild(el("div.card.tight", { style: "margin-top:12px" }, [
      el("p.note", { style: "margin:0", text: template.finisher || "30 s hard / 30 s easy — bike or crosstrainer." })]));
    if (taper) {
      stage.appendChild(el("p.note.center", { style: "margin-top:10px", text: "Taper week — the plan says sit this one out. Fresh legs matter more right now." }));
      stage.appendChild(el("button.btn.primary.big.block", { style: "margin-top:12px", onclick: () => res({ done: false, skipped: true, taper: true }) }, "Skip (taper)"));
      stage.appendChild(el("button.btn.block", { style: "margin-top:8px", onclick: start }, "Do it anyway"));
    } else {
      stage.appendChild(el("button.btn.primary.big.block", { style: "margin-top:12px", onclick: start }, `Start intervals · ${rounds} rounds`));
      stage.appendChild(el("button.btn.block", { style: "margin-top:8px", onclick: () => res({ done: false, skipped: true }) }, "Skip today"));
    }
  });

  // What the session did differently from its plan, captured live by runStrength
  // and asked about after the notes screen. Held on the draft so an interruption
  // and resume doesn't quietly forget it.
  const strengthPhase = (loc, rd) =>
    new Promise((res, rej) => runStrength(stage, program, day, weekday, srcIso, loc || template.location, {
      onComplete: (results, deviations) => { draft.deviations = deviations; res(results); },
      readiness: rd, adhocPlace,
      startIndex: resuming ? (draft._exIndex || 0) : 0,
      seed: resuming ? draft.strengthResult : null,
      // persist after each exercise so an interruption keeps the logged sets
      onProgress: (results, nextIndex) => { draft.strengthResult = results; draft._exIndex = nextIndex; persist(); },
      // X button: capture what's logged, then unwind to handleExit
      onExit: (kind, results) => {
        if (Array.isArray(results)) { draft.strengthResult = results.map(({ _i, ...r }) => r); persist(); }
        rej(new SessionExit(kind));
      },
    }));

  // the guided run itself (returns tracked moving-time in seconds, or null)
  const runCorePhase = () =>
    new Promise((res, rej) => runCardioCore(stage, program, day, weekday, srcIso, {
      onDone: res, onExit: (kind) => rej(new SessionExit(kind)) }));
  // the run-details entry, shown AFTER the cooldown so Whoop has finalized
  const cardioLogPhase = (trackedSec) =>
    new Promise((res, rej) => logCardio(stage, program, day, weekday, srcIso, {
      trackedSec, onComplete: res, onExit: (kind) => rej(new SessionExit(kind)) }));

  // Place check (every session) — train where the plan expects, or substitute.
  // On resume, keep the chosen place and skip straight back to the core.
  //
  // This used to assume exactly two places and flip between the literal strings
  // two hardcoded city names. Places now come from the profile and there can be
  // any number of them, including one.
  //
  // The prompt is now shown even with a SINGLE place, which looks like added
  // friction and isn't: with one place it was skipped, so the one person who
  // most needs to say "actually I'm in a hotel gym today" — someone who set the
  // app up around one gym — had no way to say it. One tap confirms, and the
  // escape hatch is always there.
  const plannedLoc = template.location;
  const profile = await getProfile();
  const known = placeNames(profile);
  const others = known.filter((n) => n !== plannedLoc);
  let actualLoc = draft.location;
  // A place that exists for this session only. Held on the draft, not the
  // profile, so a resume after a phone lock still knows which gym it's in.
  let adhocPlace = draft.adhocPlace || null;
  if (!resuming) {
    const lastLoc = await getLastLocation();
    const preferred = lastLoc && lastLoc.date === logDate ? lastLoc.location : plannedLoc;
    const picked = await locationPrompt(stage, plannedLoc, others, preferred, profile);
    actualLoc = picked.location;
    adhocPlace = picked.adhoc;
    await setLastLocation(logDate, actualLoc);
    draft.location = actualLoc;
    draft.adhocPlace = adhocPlace;
    draft.plannedLocation = plannedLoc;
    persist();
  }
  // substitute only when actually elsewhere AND some lift's kit is missing there
  // (a dumbbell day at another place just logs with the local weights).
  const sessionEquip = withPlace(await equipmentForProgram(program), adhocPlace);
  const substituting = day.type === "strength" && actualLoc !== plannedLoc &&
    (day.exercises || []).some((e) => needsSub(program.exercises[e.exerciseId].implement, actualLoc, sessionEquip));

  // readiness check (strength days) — eases loads / trims a set on a rough day.
  // On resume, rebuild the easing from the saved band instead of re-asking.
  let readiness = null;
  if (day.type === "strength") {
    if (resuming && draft.sessionNotes && draft.sessionNotes.readiness) {
      const r = draft.sessionNotes.readiness, drained = r.band === "Drained";
      readiness = { mult: drained ? 0.9 : 1, dropSet: drained, band: r.band, cls: drained ? "under" : "on", inputs: r };
    } else if (!resuming) {
      readiness = await readinessCheck(stage);
      if (readiness) {
        draft.sessionNotes.readiness = {
          sleep: readiness.inputs.sleep, energy: readiness.inputs.energy, soreness: readiness.inputs.soreness,
          recovery: readiness.inputs.recovery, score: readiness.score, band: readiness.band };
        persist();
      }
    }
  }

  // intro (skipped on resume — the resume prompt already oriented you)
  if (!resuming) await intro(stage, { program, template, week, day, weekNumber, actualLoc, substituting, readiness });

  // pre-routine (equipment-agnostic warm-up) — skipped on resume (already warm)
  if (template.preRoutine && !resuming) { draft.preRoutineDone = await routinePhase(template.preRoutine, "Warm-up"); persist(); }

  // core → finalize, guarded so an X-button exit unwinds cleanly to handleExit.
  try {
    let trackedSec = null;
    if (day.type === "strength") {
      if (substituting) {
        const { strengthResult, substitution } =
          await substitutedStrength(stage, program, day, weekday, srcIso, plannedLoc, actualLoc, readiness, adhocPlace);
        draft.strengthResult = strengthResult;
        draft.substitution = substitution;
        persist();
      } else {
        draft.strengthResult = (await strengthPhase(actualLoc, readiness)).map(({ _i, ...r }) => r);
        delete draft._exIndex;
        persist();
      }
    } else if (!(resuming && draft.cardioResult)) {
      trackedSec = await runCorePhase();
    }

    // interval finisher (before the cool-down, while the legs are warm)
    if (day.type === "strength" && template.finisherIntervals && !draft.finisher) {
      draft.finisher = await finisherPhase();
      persist();
    }

    // post-routine (cool-down) — Whoop finalizes the run metrics while you stretch
    if (template.postRoutine) { draft.postRoutineDone = await routinePhase(template.postRoutine, "Cool-down"); persist(); }

    // run details — entered after the cool-down, once Whoop has the final numbers
    if (day.type === "cardio" && !(resuming && draft.cardioResult)) {
      const c = await cardioLogPhase(trackedSec);
      if (c) { draft.cardioResult = c; persist(); }
    }

    // notes
    await notes(stage, draft);

    // Did today match the plan? Only asked when it didn't — see templateQuestions.
    // Deliberately AFTER the notes screen and before the save, so a "yes" is
    // written to the block in the same breath as the session it came from.
    const qs = deviationQuestions(draft.deviations, program);
    if (qs.length) {
      const answers = await templateQuestions(stage, qs);
      draft.strengthResult = stampEffort(draft.strengthResult, qs, answers);
      const patched = applyTemplateDecisions(program, qs, answers,
        { weekday, fromWeek: M.weekNumberFor(program, srcIso) });
      if (patched !== program) await saveProgram(patched);
      persist();
    }

    // finishing Saturday completes the week → show the weekly wrap-up
    return finalizeAndSave(draft);
  } catch (e) {
    if (e instanceof SessionExit) return handleExit(e.kind);
    throw e;
  }
}

// Shown when re-entering a day that already has an in-progress draft (e.g. after
// hard-closing the app mid-workout — iOS can't prompt at close, so the choice
// lands here on the way back in). Returns "continue" (resume), "complete" (log
// what's done and finish) or "discard" (throw it away and start fresh).
function resumePrompt(stage, saved, day) {
  return new Promise((res) => {
    clear(stage);
    const n = (saved.strengthResult || []).length;
    const what = day.type === "cardio"
      ? (saved.cardioResult ? "run already logged" : "in progress")
      : `${n} exercise${n === 1 ? "" : "s"} already logged`;
    const canComplete = n > 0 || !!saved.cardioResult;
    stage.appendChild(el("div", {}, [
      backBtn("Today", "#/"),
      el("div.card", { style: "margin-top:10px" }, [
        el("div.label", { text: "Session in progress" }),
        el("h1", { style: "margin:6px 0 4px", text: "Pick up where you left off" }),
        el("p.dim", { style: "margin:0", text: `This workout was already started — ${what}. Continue, log what you've done, or discard it.` }),
      ]),
    ]));
    const bar = addActionBar(
      el("button.btn.primary.big.block", { onclick: () => { unlockAudio(); bar.remove(); res("continue"); } }, "Continue session"),
      canComplete
        ? el("button.btn.block", { style: "margin-top:8px", onclick: () => { bar.remove(); res("complete"); } }, "Complete — log what's done")
        : null,
      el("button.btn.ghost.block", { style: "margin-top:8px", onclick: () => { bar.remove(); res("discard"); } }, "Discard & start over"),
    );
  });
}

function intro(stage, { program, template, week, day, weekNumber, actualLoc, substituting, readiness }) {
  return new Promise((res) => {
    clear(stage);
    const hasWarm = !!template.preRoutine;
    const exName = (e) => (program.exercises[e.exerciseId] || {}).name || e.exerciseId;
    const tileCls = day.type === "cardio" ? ".cardio" : ".strength";
    stage.appendChild(el("div", {}, [
      backBtn("Today", "#/"),
      el("div.row", { style: "margin-top:6px;gap:13px" }, [
        el("div.illotile", { style: "width:52px;height:52px;flex:none;padding:0" }, [illustration(workoutFigure(template, day))]),
        el("div", {}, [
          el("div.label", { text: hasWarm ? "Warm-up next" : "Get ready" }),
          el("h1", { style: "margin:4px 0 0", text: template.label }),
        ]),
      ]),
      el("div.row.wrap", { style: "margin-top:10px" }, [
        locationBadge(actualLoc || template.location),
        substituting ? el("span.badge", { style: "color:var(--violet);background:var(--violet-ghost);border-color:rgba(167,139,250,.3)", text: "⇄ Substitute" }) : null,
        readiness ? el("span.volchip." + readiness.cls, { text: readiness.band }) : null,
        el("span.badge.accent", { text: `Week ${weekNumber} · ${week.phaseName}` }),
      ]),
      day.type === "strength"
        ? el("div.list", { style: "margin-top:16px" }, day.exercises.map((e) =>
            el("div.item", {}, [
              el("div.ico", {}, [illustration(e.exerciseId)]),
              el("div.meta", {}, [el("div.t", { text: exName(e) }), el("div.s", { text: `${e.prescribedSets} × ${e.repRange}` })]),
            ])))
        : el("div.card", { style: "margin-top:16px" }, [el("p", { style: "margin:0", text: day.prescription })]),
    ]));

    const bar = addActionBar(
      el("button.btn.primary.big.block", { onclick: () => { unlockAudio(); bar.remove(); res(); } },
        hasWarm ? "Start warm-up" : "Start"));
  });
}

// --- "Should today's changes stick?" -----------------------------------------
// Shown only when the session actually deviated from its plan, which is why it
// can afford to be a full screen rather than a toast: it never appears after an
// ordinary workout, so it never becomes something to swipe away unread.
//
// Every row defaults to CONSIDER. The default matters more than the options do:
// "no" throws the information away and "yes" rewrites the block, and neither is
// a safe thing to do to someone who tapped through without reading.
function templateQuestions(stage, questions) {
  return new Promise((res) => {
    clear(stage);
    const answers = {};
    for (const q of questions) answers[q.key] = CONSIDER;

    const rows = questions.map((q) => {
      const opts = [
        [YES, q.yesLabel],
        [NO, "Just for today"],
        [CONSIDER, "Not in the plan, but remember it"],
      ];
      const seg = el("div.list", { style: "margin-top:9px" });
      const paint = () => setChildren(seg, ...opts.map(([val, label]) =>
        el("button.item" + (answers[q.key] === val ? ".on" : ""), { style: "text-align:left",
          "aria-pressed": answers[q.key] === val ? "true" : "false",
          onclick: () => { answers[q.key] = val; paint(); } }, [
          el("div.meta", {}, [el("div.t", { text: label })]),
          answers[q.key] === val ? el("span.badge.accent", { text: "✓" }) : null,
        ].filter(Boolean))));
      paint();
      return el("div.card", { style: "margin-top:12px" }, [
        el("div", { style: "font-weight:700", text: q.question }),
        el("p.note", { style: "margin:6px 0 0", text: q.kind === "added"
          ? "Adding it applies from next week onward — the session you just did is already logged either way."
          : "Changing it applies from next week onward. Either way today is logged as you did it." }),
        seg,
      ]);
    });

    stage.appendChild(el("div", {}, [
      el("h1", { text: "One thing before the summary" }),
      el("p.dim", { text: "Today didn't match the plan. Worth keeping?" }),
      ...rows,
    ]));
    const bar = addActionBar(el("button.btn.primary.big.block",
      { onclick: () => { bar.remove(); res(answers); } }, "Done"));
  });
}

async function notes(stage, draft) {
  // Bodyweight auto-fill, from whichever tracker is connected. Resolved BEFORE
  // the Promise below, because a Promise executor cannot be async — and making
  // it async would swallow any throw inside it rather than rejecting.
  // Rendered only when the active provider can supply a bodyweight: with no
  // tracker the row is just a plain input, which is the correct empty state
  // rather than a button that can never do anything.
  const bodyTracker = await provider();
  const canPullWeight = await has(CAP.body);
  return new Promise((res) => {
    clear(stage);
    const bw = el("input", { type: "text", inputmode: "decimal", placeholder: weightLabel(),
      style: inStyle(), value: draft.sessionNotes.bodyweightKg ? String(weightValue(draft.sessionNotes.bodyweightKg)) : "" });
    bw.dataset.shown = bw.value;    // redoing a session must not re-round its weigh-in (see readEdit)
    const energy = el("input", { type: "text", placeholder: "energy / sleep", style: inStyle(true) });
    const niggles = el("input", { type: "text", placeholder: "anything to watch", style: inStyle(true) });
    const bwPull = el("button.btn", { style: "padding:7px 12px", onclick: async () => {
      bwPull.disabled = true; const old = bwPull.textContent; bwPull.textContent = "…";
      try {
        const m = await trackerBody();
        if (m && m.weightKg != null) { bw.value = String(weightValue(m.weightKg)); bw.dataset.shown = ""; bwPull.textContent = "✓"; }
        else bwPull.textContent = "none";
      } catch (e) { bwPull.textContent = /401|not_linked/.test(e.message || "") ? "link first" : "offline"; }
      finally { setTimeout(() => { bwPull.disabled = false; bwPull.textContent = old; }, 1400); }
    } }, `⟲ ${bodyTracker.label}`);

    stage.appendChild(el("div", {}, [
      el("h1", { text: "Session notes" }),
      el("p.dim", { text: "Optional — skip if you like." }),
      el("div.row", { style: "margin:14px 0;align-items:center;gap:8px" }, [el("div", { text: "Bodyweight" }), el("span.spacer"), bw, canPullWeight ? bwPull : null].filter(Boolean)),
      el("div", { style: "margin:12px 0" }, [el("div.dim", { text: "Energy / sleep" }), energy]),
      el("div", { style: "margin:12px 0" }, [el("div.dim", { text: "Niggles" }), niggles]),
    ]));
    const bar = addActionBar(el("button.btn.primary.big.block", { onclick: () => {
      if (bw.value) {
        const kg = readEdit(bw, draft.sessionNotes.bodyweightKg ?? 0, (v) => weightToKg(M.parseNum(v)));
        draft.sessionNotes.bodyweightKg = kg; setBodyweight(kg);
      }
      if (energy.value) draft.sessionNotes.energySleep = energy.value;
      if (niggles.value) draft.sessionNotes.niggles = niggles.value;
      bar.remove();
      res();
    } }, "Finish & see summary"));
  });
  function inStyle(full) {
    return `${full ? "width:100%;margin-top:6px;text-align:left;" : "width:130px;text-align:right;"}font-size:1.15rem;padding:10px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:10px;color:var(--text)`;
  }
}

// --- Location check: are you where the plan expects? ----------------------
// `others` is every OTHER place the profile knows about — one row each, so this
// works with two places or ten. Only reached when there is a real choice.
//
// Resolves to { location, adhoc }. `adhoc` is a place record that exists for
// this session only and is never written to the profile — see withPlace().
function locationPrompt(stage, planned, others, preferred, profile) {
  return new Promise((res) => {
    const draw = () => {
      clear(stage);
      const choice = (title, sub, loc, isPlanned, isPreferred) =>
        el("button.item", { style: "text-align:left" + (isPreferred ? ";border-color:var(--accent)" : ""), onclick: () => res({ location: loc, adhoc: null }) }, [
          el("div.meta", {}, [el("div.t", { text: title }), el("div.s", { text: isPreferred && !isPlanned ? "earlier today · substitute here" : sub })]),
          el("span.badge" + (isPlanned ? ".accent" : ""), { text: isPlanned ? "Planned" : "Swap" }),
        ]);
      const elsewhere = others.length === 1 ? others[0] : "somewhere else";
      const blurb = others.length
        ? `Scheduled at ${planned}. If you're at ${elsewhere}, the app swaps in equipment-matched lifts and converts your results back into the plan.`
        : `Scheduled at ${planned}. Training somewhere else today? Add it and the app matches the session to what's actually there.`;
      stage.appendChild(el("div", {}, [
        backBtn("Today", "#/"),
        el("div.label", { style: "margin-top:8px", text: "Location check" }),
        el("h1", { style: "margin:4px 0 0", text: "Where are you training?" }),
        el("p.dim", { text: blurb }),
        el("div.list", { style: "margin-top:16px" }, [
          choice(`I'm at ${planned}`, "Run the workout as planned", planned, true, preferred === planned),
          ...others.map((o) => choice(`I'm at ${o}`, "Substitute for the equipment here", o, false, preferred === o)),
        ]),
        // Somewhere new. Travelling, a hotel gym, a friend's garage — previously
        // the only options were the places you'd already described, so the answer
        // to "I'm somewhere else entirely" was to lie and pick the closest one.
        el("button.btn.block", { style: "margin-top:12px", onclick: addPlace }, "+ Somewhere else"),
      ]));
    };

    // Somewhere new. Two exits, because "a gym I'll use again" and "a gym I'll
    // never see again" are different facts and only one of them is worth
    // remembering. Making every one-off permanent is how a frequent traveller
    // ends up choosing today's session from a list of forty dead hotels.
    function addPlace() {
      const place = blankPlace(profile);
      const status = el("p.note", { style: "min-height:1em;margin-top:10px" });
      clear(stage);
      const editor = placeEditor(place, profile, {
        onChange: () => { status.textContent = ""; },
        nameLabel: "What's it called? (optional)",
      });
      stage.appendChild(el("div", {}, [
        backBtn("Back", "#/"),
        el("div.label", { style: "margin-top:8px", text: "Somewhere else" }),
        el("h1", { style: "margin:4px 0 0", text: "What's here?" }),
        el("p.dim", { text: "Tick what this place actually has. The app picks matched movements for today and converts the results back into your plan." }),
        el("div.card", { style: "margin-top:14px" }, [editor]),
        status,
      ]));

      // Just for today: no name required, nothing written to the profile. It
      // still needs A name because the engines key equipment by place name, so
      // an unnamed one becomes "Away" — which also means a run of one-off gyms
      // reads as one honest label in the history rather than forty singletons.
      const useOnce = el("button.btn.big.block", { onclick: () => {
        const p = tidyPlace(place, profile, "Away");
        bar.remove();
        res({ location: p.name, adhoc: p });
      } }, "Just for today");

      const saveIt = el("button.btn.primary.big.block", { onclick: async () => {
        const named = tidyPlace(place, profile, "");
        if (!named.name) { status.textContent = "Give it a name to save it — or use it just for today."; return; }
        const existing = (profile && profile.places) || [];
        if (existing.some((p) => p.name.toLowerCase() === named.name.toLowerCase())) {
          status.textContent = `You already have a place called ${named.name}.`; return;
        }
        await patchProfile({ places: [...existing, named] }).catch(() => {});
        bar.remove();
        res({ location: named.name, adhoc: null });
      } }, "Save as a place");

      const bar = addActionBar(useOnce, saveIt);
      // Leaving the new-place screen must return to the picker, not the app.
      const bb = stage.querySelector(".backbtn");
      if (bb) bb.onclick = () => { bar.remove(); draw(); };
    }

    draw();
  });
}

// --- Readiness check: ease the loads on a rough day -----------------------
// WHOOP recovery (auto-pulled on open) stands in for sleep + energy — they're
// already baked into the recovery score — so you only rate soreness by hand. If
// WHOOP isn't reachable, it falls back to manual sleep + energy + soreness.
function readinessCheck(stage) {
  return new Promise((res) => {
    clear(stage);
    const state = { sleep: 1, energy: 1, soreness: 1, recovery: null }; // recovery=% when from WHOOP
    const out = el("div.row", { style: "align-items:center;gap:10px" });

    function band() {
      let score;
      if (state.recovery != null) {
        const rs = state.recovery < 34 ? 0 : state.recovery < 67 ? 3 : 6;   // red / yellow / green
        score = Math.max(0, Math.min(6, rs - (2 - state.soreness)));          // soreness only drags down
      } else {
        score = state.sleep + state.energy + state.soreness;                 // manual fallback (0–6)
      }
      if (score >= 5) return { band: "Primed", mult: 1.0, dropSet: false, score, cls: "in", msg: "Hit your prescribed targets." };
      if (score >= 3) return { band: "Steady", mult: 1.0, dropSet: false, score, cls: "in", msg: "Normal session — hit your targets." };
      return { band: "Drained", mult: 0.9, dropSet: true, score, cls: "under", msg: "Loads eased ~10% and a set trimmed — recover." };
    }
    function refresh() { clear(out); const b = band(); out.appendChild(el("span.volchip." + b.cls, { text: b.band })); out.appendChild(el("span.note", { text: b.msg })); }

    const seg = (key, opts) => {
      const s = el("div.segmented");
      opts.forEach(([label, val]) => {
        const btn = el("button" + (state[key] === val ? ".on" : ""), { onclick: () => {
          state[key] = val; [...s.children].forEach((c) => c.classList.toggle("on", c === btn)); refresh();
        } }, label);
        s.appendChild(btn);
      });
      return s;
    };
    const field = (label, control) => el("div", { style: "margin-top:14px" }, [el("div.dim", { style: "margin-bottom:6px", text: label }), control]);

    // Recovery area: loading → the tracker's recovery chip, or a manual
    // sleep+energy fallback. Works with any provider, and with none.
    const recoveryArea = el("div");
    const showLoading = () => recoveryArea.replaceChildren(field("Recovery", el("p.note", { style: "margin:0", text: "Checking recovery…" })));
    function showWhoop(pct, meta) {
      state.recovery = pct;
      const color = pct >= 67 ? "var(--accent)" : pct >= 34 ? "var(--amber)" : "var(--coral)";
      const lab = pct >= 67 ? "Green" : pct >= 34 ? "Yellow" : "Red";
      const src = (meta && meta.source) || "your tracker";
      // A score the app derived from HRV/RHR/sleep is a different claim from a
      // vendor's own score, and the difference matters here because this number
      // is about to change how much weight gets prescribed.
      const title = meta && meta.derived ? "Readiness (estimated)" : `Recovery (from ${src})`;
      recoveryArea.replaceChildren(field(title, el("div.row", { style: "align-items:center;gap:10px" }, [
        el("div.metric.sm", { style: "color:" + color, text: pct + "%" }),
        el("span.volchip." + (pct >= 67 ? "on" : "under"), { text: lab }),
        el("span.note", { text: meta && meta.derived ? (meta.basis || "from your own baseline") : "covers sleep & energy" }),
      ])));
      refresh();
    }
    function showManual() {
      state.recovery = null;
      recoveryArea.replaceChildren(
        field("Sleep", seg("sleep", [["Poor", 0], ["OK", 1], ["Good", 2]])),
        field("Energy", seg("energy", [["Low", 0], ["OK", 1], ["High", 2]])),
        el("p.note", { style: "margin:8px 2px 0", text: "No recovery reading — rate it yourself." }),
      );
      refresh();
    }
    showLoading();

    stage.appendChild(el("div", {}, [
      backBtn("Today", "#/"),
      el("div.label", { style: "margin-top:8px", text: "Readiness check" }),
      el("h1", { style: "margin:4px 0 0", text: "How are you today?" }),
      el("p.dim", { text: "The app eases the loads on a rough day. Skip if you like." }),
      recoveryArea,
      field("Soreness", seg("soreness", [["A lot", 0], ["Some", 1], ["None", 2]])),
      el("div.card.tight", { style: "margin-top:16px" }, [out]),
    ]));
    refresh();

    // auto-pull the tracker recovery on open (no button); manual on failure
    (async () => {
      try {
        const m = await recoveryToday();
        if (m && m.recoveryPct != null) showWhoop(m.recoveryPct, m); else showManual();
      } catch { showManual(); }
    })();

    const bar = addActionBar(
      el("button.btn.block", { onclick: () => { bar.remove(); res(null); } }, "Skip"),
      el("button.btn.primary.block", { onclick: () => {
        const b = band(); bar.remove();
        res({ ...b, inputs: { sleep: state.recovery == null ? state.sleep : null,
          energy: state.recovery == null ? state.energy : null, soreness: state.soreness, recovery: state.recovery } });
      } }, "Continue"),
    );
  });
}

// --- Substituted strength session -----------------------------------------
async function substitutedStrength(stage, program, day, weekday, iso, plannedLoc, actualLoc, readiness, adhocPlace) {
  // A one-off place is exactly the case this whole path exists for, so its kit
  // has to be in the equip the swap decisions are made from.
  const equip = withPlace(await equipmentForProgram(program), adhocPlace);
  const planned = day.exercises;

  // 1) engine target for each PLANNED lift (what the substitute must match)
  const deload = isDeloadWeek((program.weeks || []).find((w) => w.weekNumber === M.weekNumberFor(program, iso)));
  const origRecs = [];
  for (const e of planned) {
    const hist = await exerciseHistory(program.id, weekday, e.exerciseId, iso);
    let prev = hist.length ? hist[hist.length - 1] : null;
    let srcProgram = program;
    if (!prev) {   // new-block seed: carry loads across the block handover
      prev = (await exerciseHistoryAcross(weekday, e.exerciseId, iso)).pop() || null;
      if (prev && prev.programId) srcProgram = (await getAllPrograms()).find((p) => p.id === prev.programId) || program;
    }
    const prevRange = prev ? prescribedRangeAt(srcProgram, prev.weekNumber, weekday, e.exerciseId) : null;
    origRecs.push(recommend({ curRx: e, prevEx: prev ? prev.exercise : null, prevRange,
      implement: program.exercises[e.exerciseId].implement, location: plannedLoc, equip, exerciseId: e.exerciseId, deload }));
  }

  // 2) plan: swap only where the kit is missing here
  const plan = planned.map((e, i) => {
    const impl = program.exercises[e.exerciseId].implement;
    const rec = origRecs[i];
    if (!needsSub(impl, actualLoc, equip)) return { kept: true, baseRx: e, originalId: e.exerciseId, rec };
    return { kept: false, baseRx: e, originalId: e.exerciseId, originalImpl: impl, rec,
      subId: primarySubstitute(e.exerciseId) || e.exerciseId, approximate: isApprox(e.exerciseId),
      plannedLoad: rec.load != null ? rec.load : anchorLoad(program, e.exerciseId),  // fall back to the load anchor (first time)
      plannedReps: rec.reps || repLo(e.repRange) };
  });

  // 3) preview + let the user swap any substitute
  await subPreview(stage, plan, program, actualLoc);

  // 4) run the (mixed) workout through the logger with matched targets
  const augProgram = { ...program, exercises: { ...program.exercises, ...SUB_EXERCISES } };
  const subExercises = plan.map((p) => {
    const id = p.kept ? p.originalId : p.subId;
    return { exerciseId: id, role: p.baseRx.role, restSeconds: p.baseRx.restSeconds,
      prescribedSets: p.baseRx.prescribedSets, repRange: p.baseRx.repRange };
  });
  const recsOverride = plan.map((p) => {
    if (p.kept) {  // re-round the recommendation to the equipment that's actually here
      const impl = program.exercises[p.originalId].implement;
      const load = p.rec.load != null ? roundLoad(p.rec.load, impl, actualLoc, equip) : p.rec.load;
      return { ...p.rec, load };
    }
    const subImpl = metaFor(augProgram, p.subId).implement;
    const seed = seedSubLoad(p.originalId, p.subId, p.plannedLoad, subImpl, actualLoc, equip);
    p.subTargetLoad = seed;
    const origName = metaFor(program, p.originalId).name;
    const tgt = p.plannedLoad != null ? `${M.fmtWeight(p.plannedLoad)} × ${p.plannedReps}` : `${p.plannedReps} reps`;
    return { direction: "sub", load: seed || null, reps: p.plannedReps,
      reason: `Stands in for ${origName} (target ${tgt}). Match that effort — we'll convert it back.` };
  });
  const subResults = await new Promise((res) =>
    runStrength(stage, augProgram, { exercises: subExercises }, weekday, iso, actualLoc,
      { exercises: subExercises, recs: recsOverride, onComplete: res, readiness, adhocPlace }));

  // 5) back-calc swapped → planned lift; keep kept; assemble in planned order.
  //    Map by index (not id) so a swap can't cross-wire with a kept lift's id.
  const byIdx = {}; subResults.forEach((r) => { byIdx[r._i] = r; });
  const strengthResult = [], items = [];
  plan.forEach((p, idx) => {
    const r = byIdx[idx];
    if (!r || !r.sets.length) return;
    if (p.kept) {
      strengthResult.push({ exerciseId: r.exerciseId, implement: r.implement, sets: r.sets });
    } else if (isTimedSets(r)) {
      // timed/core substitute (e.g. bodyweight Pallof) → log straight to the
      // planned lift; there's no load to back-calculate.
      strengthResult.push({ exerciseId: p.originalId, implement: program.exercises[p.originalId].implement,
        sets: r.sets, substituted: true, via: p.subId });
      items.push({ originalId: p.originalId, subId: p.subId, approximate: p.approximate, sets: r.sets });
    } else {
      strengthResult.push(backCalcOriginal({ originalId: p.originalId, originalImplement: p.originalImpl,
        plannedLocation: plannedLoc, plannedLoad: p.plannedLoad, plannedReps: p.plannedReps,
        subId: p.subId, subTargetLoad: p.subTargetLoad, subSets: r.sets, equip, approximate: p.approximate }));
      items.push({ originalId: p.originalId, subId: p.subId, approximate: p.approximate, sets: r.sets });
    }
  });

  // 6) review & adjust the planned-exercise log
  const reviewed = await subReview(stage, strengthResult, program);
  return { strengthResult: reviewed, substitution: { plannedLocation: plannedLoc, actualLocation: actualLoc, items } };
}

// Preview the swaps; tap a substitute to choose a different match. Resolves on Start.
function subPreview(stage, plan, program, actualLoc) {
  return new Promise((res) => {
    clear(stage);
    const rows = plan.map((p) => {
      const origName = metaFor(program, p.originalId).name;
      if (p.kept) {
        return el("div.item", { style: "opacity:.8" }, [
          el("div.meta", {}, [el("div.t", { text: origName }), el("div.s", { text: `Stays — dumbbells available in ${actualLoc}` })]),
          el("span.badge", { text: "kept" }),
        ]);
      }
      const cands = candidatesFor(p.originalId);
      const sel = el("select.subsel", { onchange: (ev) => { p.subId = ev.target.value; } },
        cands.map((cid) => el("option", { value: cid, selected: cid === p.subId ? true : null }, metaFor(program, cid).name)));
      return el("div.item", { style: "align-items:flex-start;flex-direction:column;gap:8px" }, [
        el("div.meta", {}, [
          el("div.t", {}, [origName, p.approximate ? el("span.faint", { text: " · approx" }) : null]),
          el("div.s", { text: "↳ substitute:" }),
        ]),
        sel,
      ]);
    });
    stage.appendChild(el("div", {}, [
      backBtn("Today", "#/"),
      el("div.label", { style: "margin-top:8px", text: "Substitute plan" }),
      el("h1", { style: "margin:4px 0 0", text: `Adjusted for ${actualLoc}` }),
      el("p.dim", { text: "Each missing-kit lift is swapped for the closest match. Change any below." }),
      el("div.list", { style: "margin-top:14px" }, rows),
    ]));
    const bar = addActionBar(el("button.btn.primary.big.block", { onclick: () => { bar.remove(); res(); } }, "Start workout"));
  });
}

// Show the back-calculated PLANNED-exercise log; let the user adjust converted lifts.
function subReview(stage, strengthResult, program) {
  return new Promise((res) => {
    clear(stage);
    const edits = [];
    const rows = strengthResult.map((ex) => {
      const name = metaFor(program, ex.exerciseId).name;
      const topW = Math.max(0, ...ex.sets.map((s) => Number(s.weightKg) || 0));
      const reps = (ex.sets[0] && ex.sets[0].reps) || 0;
      if (!ex.substituted || isTimedSets(ex)) {  // kept lifts & timed core: read-only summary
        return el("div.item", {}, [
          el("div.meta", {}, [el("div.t", { text: name }),
            el("div.s", { text: ex.sets.map((s) => M.setDisplay(ex.implement, s)).join("  ") })]),
          el("span.badge", { text: ex.substituted ? "core" : "logged" }),
        ]);
      }
      const wIn = el("input", { type: "number", inputmode: "decimal", value: String(weightValue(topW)), style: revInStyle() });
      wIn.dataset.shown = wIn.value;      // untouched = keep the back-calculated kg exactly (see readEdit)
      const rIn = el("input", { type: "number", inputmode: "numeric", value: String(reps), style: revInStyle() });
      edits.push({ ex, wIn, rIn, topW });
      return el("div.card.tight", {}, [
        el("div.row", {}, [
          el("div", { style: "flex:1;min-width:0" }, [
            el("div", { style: "font-weight:700", text: name }),
            el("div.note", {}, [`converted from ${metaFor(program, ex.via).name}`,
              ex.approximate ? el("span", { style: "color:var(--amber)", text: " · approximate" }) : null]),
          ]),
        ]),
        el("div.row", { style: "gap:10px;margin-top:8px;align-items:center" }, [
          wIn, el("span.dim", { text: weightLabel() }), rIn, el("span.dim", { text: "reps" }),
          el("span.faint", { style: "font-size:.78rem", text: `× ${ex.sets.length} sets` }),
        ]),
      ]);
    });
    stage.appendChild(el("div", {}, [
      el("div.label", { text: "Logged to your plan" }),
      el("h1", { style: "margin:4px 0 0", text: "Review & adjust" }),
      el("p.dim", { text: "This is what's saved against the planned lifts (so next week progresses right). Tweak the converted ones if they feel off." }),
      el("div.list", { style: "margin-top:14px" }, rows),
    ]));
    const bar = addActionBar(el("button.btn.primary.big.block", { onclick: () => {
      for (const e of edits) {
        const w = readEdit(e.wIn, e.topW, (v) => weightToKg(Number(v) || 0));
        const r = Math.max(0, Math.round(Number(e.rIn.value) || 0));
        e.ex.sets = e.ex.sets.map((s, i) => ({ setNumber: i + 1, weightKg: w, reps: r, ...(s.rir != null ? { rir: s.rir } : {}) }));
      }
      bar.remove();
      res(strengthResult);
    } }, "Save to plan & continue"));
  });
  function revInStyle() {
    return "width:84px;text-align:center;font-size:1.1rem;font-weight:700;padding:9px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:10px;color:var(--text)";
  }
}
