// strength.js — strength logging (requirements §8). One exercise at a time:
// implement-aware weight entry (plate calc / dumbbell scroller / cable stepper),
// pre-filled sets, ghosted previous values, per-set tap-to-adjust, live volume,
// dismissible rest timer. Calls onComplete(strengthResult[]) when all exercises done.

import { el, clear, haptic, go, registerCleanup } from "../ui.js";
import { interruptSheet } from "../components/interrupt.js";
import { illustration } from "../illustrations.js";
import { photoURL, loadPhotoManifest } from "../exercise-photo.js";
import { exerciseHistory, exerciseHistoryAcross, getAllPrograms, getAllSessions, equipmentForProgram } from "../store.js";
import { getProfile } from "../profile.js";
import { PlateCalc } from "../components/plate-calc.js";
import { WeightStepper } from "../components/db-scroller.js";
import { Ticker } from "../components/timer.js";
import { cueItemEnd, cueTick } from "../components/sound.js";
import { celebrate } from "../components/confetti.js";
import { recommend, detectStall, roundLoad, isDeloadWeek, e1rm, warmupPlan, replanSets, loadCeiling } from "../progression.js";
import { MUSCLE_MAP } from "../volume.js";

import { muscleBody } from "../anatomy.js";
import * as M from "../model.js";

// Full-screen demonstration, opened from the exercise head mid-session.
//
// Deliberately NOT a route: navigating away from a running session and back is
// how you lose your place in a set. This is an overlay over the live screen —
// tap anywhere, press Escape, or hit the close button and the workout is exactly
// where it was. The image is the same render the exercise card shows, muscle
// panel included, because at full width both halves are legible.
function showDemo(url, name) {
  const img = el("img.exdemo-img", { src: url, alt: `${name} — demonstration and muscles worked`, decoding: "async" });
  const sheet = el("div.exdemo-sheet", { role: "dialog", "aria-modal": "true", "aria-label": name }, [
    el("div.exdemo-inner", {}, [
      el("div.row", { style: "align-items:center;gap:10px;margin-bottom:10px" }, [
        el("h2", { style: "margin:0;font-size:1.05rem", text: name }),
        el("span.spacer"),
        el("button.btn.ghost", { style: "padding:6px 12px", "aria-label": "Close demonstration" }, "✕"),
      ]),
      img,
    ]),
  ]);
  const close = () => { sheet.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  sheet.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(sheet);
}

// "Muscles worked" anatomy panel for an exercise — primary (1.0) lit coral,
// secondary (<1.0) lit amber, on the front+back body. null if the lift isn't
// mapped. `compact` = the small side-panel next to the session-target box.
function muscleTargets(exId, compact = false) {
  const map = MUSCLE_MAP[exId] || {};
  if (!Object.keys(map).length) return null;
  const colorOf = (m) => { const w = map[m]; return w ? (w >= 1 ? "#fb7185" : "#fbbf24") : null; };
  if (compact) return el("div.ex-targets.compact", {}, [
    el("div.label", { style: "text-align:center;margin-bottom:5px", text: "Muscles" }),
    muscleBody(colorOf, { corners: true }),
  ]);
  const dot = (c, t) => el("span", { style: "display:inline-flex;align-items:center;gap:6px;font-size:.72rem;color:var(--text-dim)" }, [
    el("span", { style: `width:9px;height:9px;border-radius:50%;background:${c}` }), el("span", { text: t })]);
  return el("div.ex-targets", {}, [
    el("div.label", { style: "text-align:center;margin-bottom:8px", text: "Muscles worked" }),
    muscleBody(colorOf),
    el("div.row", { style: "gap:18px;justify-content:center;margin-top:9px" }, [dot("#fb7185", "Primary"), dot("#fbbf24", "Secondary")]),
  ]);
}

const isTimed = (rx) => !!rx.timed || /s$/i.test(rx.repRange || "");
function repTop(range) {
  const nums = (range || "").match(/\d+/g);
  return nums ? Number(nums[nums.length - 1]) : 10;
}
function anchorWeight(program, exId) {
  const a = program.loadAnchors && program.loadAnchors[exId];
  const n = a && a.match(/\d+(\.\d+)?/);
  return n ? Number(n[0]) : null;
}
// The rep range prescribed for an exercise on a given week (to detect range changes).
function prescribedRangeAt(program, weekNumber, weekday, exerciseId) {
  const wk = (program.weeks || []).find((w) => w.weekNumber === weekNumber);
  const d = wk && wk.days && wk.days[weekday];
  const ex = d && (d.exercises || []).find((e) => e.exerciseId === exerciseId);
  return ex ? ex.repRange : null;
}
const DIR_CHIP = {
  up:   ["↑", "Go heavier"],
  hold: ["=", "Hold load"],
  down: ["↓", "Back off"],
  new:  ["★", "New lift"],
  timed:["◷", "Timed"],
  sub:  ["⇄", "Substitute"],
  deload:["▽", "Deload"],
  cap:  ["⤒", "At DB max"],
};

// brief, self-dismissing confirmation toast
function toast(msg) {
  const t = el("div.toast", { text: msg });
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 1900);
}

// Bottom-sheet picker over the program's whole exercise library. Resolves the
// chosen exerciseId, or null if cancelled.
function pickExercise(program, excludeId) {
  return new Promise((res) => {
    const lib = program.exercises || {};
    const ids = Object.keys(lib).filter((id) => id !== excludeId);
    const listWrap = el("div.sheet-list");
    const search = el("input.sheet-search", { type: "text", inputmode: "search", placeholder: "Search exercises…" });
    const draw = (q) => {
      clear(listWrap);
      const ql = (q || "").toLowerCase();
      const matches = ids.filter((id) => !ql || (lib[id].name || id).toLowerCase().includes(ql))
        .sort((a, b) => (lib[a].name || a).localeCompare(lib[b].name || b));
      if (!matches.length) { listWrap.appendChild(el("p.dim", { style: "padding:14px;text-align:center", text: "No match" })); return; }
      for (const id of matches) listWrap.appendChild(el("button.item", { style: "text-align:left", onclick: () => close(id) }, [
        el("div.ico", {}, [illustration(id)]),
        el("div.meta", {}, [el("div.t", { text: lib[id].name || id }), el("div.s", { text: (lib[id].implement || "").replace(/_/g, " ") })]),
      ]));
    };
    const ov = el("div.sheet");
    ov.appendChild(el("div.sheet-card", {}, [
      el("div.sheet-grip"),
      el("div.row", { style: "margin-bottom:8px" }, [el("div.label", { text: "Choose exercise" }), el("span.spacer"),
        el("button.btn.ghost", { style: "padding:4px 12px", onclick: () => close(null) }, "Cancel")]),
      search, listWrap,
    ]));
    ov.addEventListener("click", (e) => { if (e.target === ov) close(null); });   // tap backdrop to dismiss
    function close(val) { ov.remove(); res(val); }
    search.addEventListener("input", () => draw(search.value));
    draw("");
    document.body.appendChild(ov);
  });
}

export async function runStrength(container, program, day, weekday, iso, location, opts = {}) {
  const onComplete = opts.onComplete;
  const equip = await equipmentForProgram(program);
  const profile = await getProfile();   // display units for the weight widgets
  await loadPhotoManifest();            // so photoURL() can answer while rendering each exercise
  // opts.exercises overrides the planned list (e.g. a substitute workout);
  // opts.recs supplies pre-built recommendations (substitute targets) so we skip
  // the engine. Otherwise compute the autoregulated recommendation + stall flag.
  // clone so on-the-fly swap/add never mutates the program's planned day
  let exercises = (opts.exercises || day.exercises).slice();
  let prevs, recs, stalls;
  if (opts.recs) {
    recs = opts.recs;
    prevs = opts.prevs || exercises.map(() => null);
    stalls = opts.stalls || exercises.map(() => null);
  } else {
    const histories = await Promise.all(
      exercises.map((e) => exerciseHistory(program.id, weekday, e.exerciseId, iso))
    );
    // NEW-BLOCK SEED: history is program-scoped by design (fair comparisons/PRs),
    // so the first session of a block would see nothing and ask to "pick a load"
    // from scratch. Fall back to the last occurrence in any earlier block; the
    // SOURCE program's plan supplies its rep range so the engine's range bridges
    // re-base the load correctly. Stall detection stays block-scoped (fresh trend).
    const seeded = await Promise.all(histories.map(async (h, i) =>
      h.length ? null : (await exerciseHistoryAcross(weekday, exercises[i].exerciseId, iso)).pop() || null));
    const progMap = seeded.some(Boolean)
      ? Object.fromEntries((await getAllPrograms()).map((p) => [p.id, p])) : null;
    prevs = histories.map((h, i) => (h.length ? h[h.length - 1] : seeded[i]));
    const deload = isDeloadWeek((program.weeks || []).find((w) => w.weekNumber === M.weekNumberFor(program, iso)));
    recs = exercises.map((e, i) => {
      const prev = prevs[i];
      const srcProgram = prev && prev.programId && progMap ? progMap[prev.programId] || program : program;
      const prevRange = prev ? prescribedRangeAt(srcProgram, prev.weekNumber, weekday, e.exerciseId) : null;
      return recommend({
        curRx: e, prevEx: prev ? prev.exercise : null, prevRange,
        implement: program.exercises[e.exerciseId].implement,
        location, equip, exerciseId: e.exerciseId, deload,
      });
    });
    stalls = histories.map((h, i) => detectStall(h.map((o) => o.exercise),
      loadCeiling(program.exercises[exercises[i].exerciseId].implement, location, equip)));
  }

  // readiness autoregulation: ease loads ~10% and/or trim a set on a rough day
  const rd = opts.readiness;
  if (rd && (rd.mult !== 1 || rd.dropSet)) {
    if (rd.mult && rd.mult !== 1) {
      recs = recs.map((r, i) => {
        if (!r || r.load == null) return r;
        const impl = (program.exercises[exercises[i].exerciseId] || {}).implement;
        return { ...r, load: roundLoad(r.load * rd.mult, impl, location, equip), eased: true };
      });
    }
    if (rd.dropSet) exercises = exercises.map((e) => ({ ...e, prescribedSets: Math.max(2, (e.prescribedSets || 3) - 1) }));
  }

  // opts.seed / opts.startIndex resume an interrupted session: pre-loaded results
  // and the next exercise to log (so already-logged exercises aren't redone).
  const results = Array.isArray(opts.seed) ? opts.seed.slice() : [];
  let exIndex = Math.min(opts.startIndex || 0, exercises.length);
  // per-slot status (parallel to `exercises`, spliced alongside on reorder/add) so
  // the app knows which lifts are logged vs skipped vs not-yet-done — this drives
  // the jump navigator and the end-of-session "before you finish" review.
  const flags = exercises.map(() => ({ logged: false, visited: false }));
  exercises.forEach((e, i) => { if (results.some((r) => r.exerciseId === e.exerciseId)) flags[i] = { logged: true, visited: true }; });
  let commitCurrent = () => {};   // set by renderExercise — flushes the current lift's done sets

  const restTicker = new Ticker();
  let restPill = null, restTotal = 0;
  registerCleanup(() => { restTicker.stop(); if (restPill) { restPill.remove(); restPill = null; } });

  // All-time best estimated-1RM per exercise, from every PRIOR session — so a
  // logged set that beats it celebrates on the spot (in-the-moment PR, not a
  // post-hoc summary read). First-ever lifts have no entry → no false PR.
  const bestE1 = {};
  try {
    for (const s of await getAllSessions()) {
      if (!s.strengthResult || (s.date && s.date >= iso)) continue;
      for (const ex of s.strengthResult) for (const st of ex.sets || []) {
        if (st.reps == null || !st.weightKg) continue;
        const e = e1rm(st.weightKg, st.reps);
        if (e > (bestE1[ex.exerciseId] || 0)) bestE1[ex.exerciseId] = e;
      }
    }
  } catch { /* no history is fine */ }

  function priorVolume() {
    return results.reduce((s, r) => s + M.exerciseVolume(r), 0);
  }

  // --- on-the-fly swap / add an exercise (gym reality: a machine's taken, you
  // want a finisher) — disabled in the substitute flow where back-calc owns the list.
  const canEdit = !opts.recs;
  async function makeEntry(exId, baseRx) {
    const lib = program.exercises[exId] || {};
    const rx = { exerciseId: exId, prescribedSets: baseRx.prescribedSets || 3,
      repRange: baseRx.repRange || "8-12", restSeconds: baseRx.restSeconds || 90, role: baseRx.role };
    let hist = await exerciseHistory(program.id, weekday, exId, iso);
    let srcProgram = program;
    let prev = hist.length ? hist[hist.length - 1] : null;
    if (!prev) {   // new-block seed (see runStrength)
      prev = (await exerciseHistoryAcross(weekday, exId, iso)).pop() || null;
      if (prev && prev.programId) srcProgram = (await getAllPrograms()).find((p) => p.id === prev.programId) || program;
    }
    const prevRange = prev ? prescribedRangeAt(srcProgram, prev.weekNumber, weekday, exId) : null;
    const deload = isDeloadWeek((program.weeks || []).find((w) => w.weekNumber === M.weekNumberFor(program, iso)));
    const rec = recommend({ curRx: rx, prevEx: prev ? prev.exercise : null, prevRange,
      implement: lib.implement, location, equip, exerciseId: exId, deload });
    return { rx, prev, rec, stall: detectStall(hist.map((o) => o.exercise), loadCeiling(lib.implement, location, equip)) };
  }
  async function swapExercise() {
    const exId = await pickExercise(program, exercises[exIndex].exerciseId);
    if (!exId) return;
    const e = await makeEntry(exId, exercises[exIndex]);   // keep the current sets/range/rest
    exercises[exIndex] = e.rx; prevs[exIndex] = e.prev; recs[exIndex] = e.rec; stalls[exIndex] = e.stall;
    flags[exIndex] = { logged: false, visited: false };   // a new lift in this slot starts fresh
    renderExercise();
  }
  async function addExercise() {
    const exId = await pickExercise(program, null);
    if (!exId) return;
    const e = await makeEntry(exId, { prescribedSets: 3, repRange: "8-12", restSeconds: 90 });
    const at = exIndex + 1;   // log it right after the current one
    exercises.splice(at, 0, e.rx); prevs.splice(at, 0, e.prev); recs.splice(at, 0, e.rec); stalls.splice(at, 0, e.stall);
    flags.splice(at, 0, { logged: false, visited: false });
    // update chrome IN PLACE (re-rendering would reset the current exercise's
    // half-entered sets) — the added lift comes up next when this one finishes.
    const badge = container.querySelector(".routine-head .navbadge");
    if (badge) badge.textContent = `≡  ${exIndex + 1}/${exercises.length}`;
    const skip = container.querySelector("button.btn.ghost.block");
    if (skip) skip.textContent = exIndex < exercises.length - 1 ? "Skip to next exercise ›" : "Finish logging ›";
    toast(`Added ${(program.exercises[exId] || {}).name || exId} — up next`);
  }
  // defer the current exercise to the end of the queue (rack busy → come back) —
  // moves it past every remaining lift; the next one comes up now.
  function doLater() {
    if (exIndex >= exercises.length - 1) return;   // already last, nothing to defer past
    const i = exIndex;
    exercises.push(exercises.splice(i, 1)[0]);
    prevs.push(prevs.splice(i, 1)[0]);
    recs.push(recs.splice(i, 1)[0]);
    stalls.push(stalls.splice(i, 1)[0]);
    flags.push(flags.splice(i, 1)[0]);
    renderExercise();   // exIndex unchanged → now shows what was next
  }

  // jump straight to any exercise — free reorder, or return to a skipped lift.
  // Commits the current lift's done sets first so nothing is lost.
  function goToExercise(i) {
    if (i < 0 || i >= exercises.length) return;
    if (i !== exIndex) commitCurrent();
    exIndex = i;
    renderExercise();
  }
  function exStatus(i) {
    if (i === exIndex) return "current";
    if (flags[i].logged) return "logged";
    if (flags[i].visited) return "skipped";
    return "pending";
  }
  // Bottom-sheet list of every exercise with its status — tap to jump to any of
  // them (rack busy → rearrange; or go back to one you skipped).
  function openNav() {
    const ov = el("div.sheet");
    const rows = exercises.map((e, i) => {
      const lib = program.exercises[e.exerciseId] || {};
      const st = exStatus(i);
      const tag = st === "logged" ? el("span.badge.accent", { text: "✓ done" })
        : st === "current" ? el("span.badge", { style: "color:var(--accent);border-color:var(--accent)", text: "now" })
        : st === "skipped" ? el("span.badge", { style: "color:var(--amber);border-color:rgba(251,191,36,.4)", text: "skipped" })
        : el("span.badge", { text: "to do" });
      return el("button.item", { style: "text-align:left", onclick: () => { ov.remove(); goToExercise(i); } }, [
        el("div.ico", {}, [illustration(e.exerciseId)]),
        el("div.meta", {}, [el("div.t", { text: lib.name || e.exerciseId }), el("div.s", { text: `${e.prescribedSets} × ${e.repRange}` })]),
        tag,
      ]);
    });
    ov.appendChild(el("div.sheet-card", {}, [
      el("div.sheet-grip"),
      el("div.row", { style: "margin-bottom:8px" }, [el("div.label", { text: "Exercises · tap to jump" }), el("span.spacer"),
        el("button.btn.ghost", { style: "padding:4px 12px", onclick: () => ov.remove() }, "Close")]),
      el("div.sheet-list", {}, rows),
    ]));
    ov.addEventListener("click", (ev) => { if (ev.target === ov) ov.remove(); });
    document.body.appendChild(ov);
  }
  // End-of-session gate: any skipped / unfinished lifts get a last chance before
  // the workout closes out.
  function renderReview(remaining) {
    clearRest(); clear(container);
    const finish = () => { restTicker.stop(); onComplete && onComplete(results); };
    container.appendChild(el("div.routine-head", {}, [
      el("button.btn.ghost", { style: "padding:0", "aria-label": "Finish workout", onclick: finish }, "✕"),
      el("span.spacer"),
      el("span.badge", { text: "Before you finish" }),
    ]));
    container.appendChild(el("div.ex-head", {}, [
      el("h2", { style: "margin:0", text: `${remaining.length} exercise${remaining.length === 1 ? "" : "s"} left` }),
      el("div.cue", { text: "You skipped or didn't finish these. Tap one to do it now, or finish the workout." }),
    ]));
    container.appendChild(el("div.list", { style: "margin-top:14px" }, remaining.map((i) => {
      const e = exercises[i]; const lib = program.exercises[e.exerciseId] || {};
      return el("button.item", { style: "text-align:left", onclick: () => goToExercise(i) }, [
        el("div.ico", {}, [illustration(e.exerciseId)]),
        el("div.meta", {}, [el("div.t", { text: lib.name || e.exerciseId }),
          el("div.s", { text: exStatus(i) === "skipped" ? "skipped" : "not started" })]),
        el("span.badge", { style: "color:var(--accent)", text: "Do it ›" }),
      ]);
    })));
    container.appendChild(el("button.btn.primary.big.block", { style: "margin-top:18px", onclick: finish }, "Finish workout"));
  }

  function initSets(rx, prevEx, implement, rec) {
    const timed = isTimed(rx);
    const top = repTop(rx.repRange);
    const aw = anchorWeight(program, rx.exerciseId);
    const recW = rec && rec.load != null ? rec.load : null;       // engine prescription
    const recReps = rec && rec.reps != null ? rec.reps : null;
    const baseW = implement === "barbell" ? equip.barWeightKg : implement === "ez_bar" ? equip.ezBarWeightKg : 0;
    // A single UNIFORM fill for strength sets — the prescription is "N sets at the
    // same load", so every set prefills identically. When the engine has no load,
    // fall back to last session's TOP set (one representative value), NOT last
    // session's per-set actuals: prefilling those made set 1 & the extra 4th set
    // differ from 2/3 (last week was a shorter deload) and read like a bad plan.
    const prevSets = prevEx && prevEx.sets && prevEx.sets.length ? prevEx.sets : null;
    const prevW = prevSets ? Math.max(...prevSets.map((s) => Number(s.weightKg) || 0)) : null;
    const prevReps = prevSets ? ((prevSets.find((s) => (Number(s.weightKg) || 0) === prevW) || prevSets[0]).reps ?? top) : null;
    const fillW = recW != null ? recW : prevW != null ? prevW : aw != null ? aw : baseW;
    const fillReps = recReps != null ? recReps : prevReps != null ? prevReps : top;
    const sets = [];
    for (let i = 0; i < rx.prescribedSets; i++) {
      const ps = prevSets ? prevSets[i] : null;
      // timed (core): keep last hold; strength: uniform recommended/representative load.
      const weight = timed ? (ps ? ps.weightKg : 0) : fillW;
      const reps = timed ? (ps ? ps.seconds ?? top : top) : fillReps;
      sets.push({ weightKg: weight, reps: timed ? null : reps, seconds: timed ? reps : undefined, rir: null, done: false, edited: false });
    }
    return { timed, sets };
  }

  function renderExercise() {
    clearRest();
    clear(container);
    const rx = exercises[exIndex];
    const lib = program.exercises[rx.exerciseId];
    const implement = lib.implement;
    const prevEx = prevs[exIndex] ? prevs[exIndex].exercise : null;
    const rec = recs[exIndex];
    const stall = stalls[exIndex];
    const state = initSets(rx, prevEx, implement, rec);
    let active = 0;

    // --- header ---
    container.appendChild(el("div.routine-head", {}, [
      el("button.btn.ghost", { style: "padding:0", "aria-label": "Exit logging", onclick: () => maybeExit() }, "✕"),
      el("span.spacer"),
      el("button.badge.navbadge", { "aria-label": "Jump to another exercise", onclick: () => openNav() }, `≡  ${exIndex + 1}/${exercises.length}`),
    ]));
    container.appendChild(el("div.progress", {}, [el("div.progress-fill", { style: `width:${(exIndex / exercises.length) * 100}%` })]));

    // The 74px tile stays the hand-drawn figure — a photo shrunk to thumbnail is
    // mush, and this one has to read at a glance mid-set. But when a render
    // exists, the tile becomes a BUTTON that opens it full-screen: previously the
    // demo was only reachable from the exercise card, which means leaving the
    // session, which nobody does mid-workout. That made the renders invisible
    // exactly when someone unsure of the movement needs them.
    const demoURL = photoURL(rx.exerciseId);
    const figure = el("div", { style: "width:74px;height:74px;color:var(--accent);flex:none" }, [illustration(rx.exerciseId)]);
    const figureNode = demoURL
      ? el("button.exdemo", { "aria-label": `Show ${lib.name} demonstration`, onclick: () => showDemo(demoURL, lib.name) }, [figure])
      : figure;
    container.appendChild(el("div.ex-head", {}, [
      el("div.row", {}, [
        figureNode,
        el("h2", { style: "margin:0", text: lib.name }),
      ]),
      el("div.cue", { text: lib.cue || "" }),
      el("div.rx", { text: `${rx.prescribedSets} × ${rx.repRange} · rest ${rx.restSeconds}s${rx.role === "core" ? " · core" : ""}` }),
      prevEx ? el("div.rx", { text: "Last time: " + prevEx.sets.map((s) => M.setDisplay(implement, s)).join("  ") })
        : anchorWeight(program, rx.exerciseId) != null ? el("div.rx", { text: "Week-1 anchor: " + program.loadAnchors[rx.exerciseId] }) : null,
    ]));

    // on-the-fly: swap this lift, defer it, or add one (gym reality)
    if (canEdit) container.appendChild(el("div.btn-row", { style: "margin-top:8px" }, [
      el("button.btn.ghost", { style: "flex:1;min-height:38px;font-size:.8rem", "aria-label": "Swap this exercise", onclick: () => swapExercise() }, "⇄ Swap"),
      exIndex < exercises.length - 1
        ? el("button.btn.ghost", { style: "flex:1;min-height:38px;font-size:.8rem", "aria-label": "Do this exercise later", onclick: () => doLater() }, "↓ Later")
        : null,
      el("button.btn.ghost", { style: "flex:1;min-height:38px;font-size:.8rem", "aria-label": "Add an exercise", onclick: () => addExercise() }, "+ Add"),
    ]));

    // --- the coach's call + muscles worked, side by side: the session-target
    //     box on the left, a compact front+back muscle body on the right ---
    let banner = null;
    if (rec && rec.direction !== "timed" && !isTimed(rx)) {
      const [glyph, label] = DIR_CHIP[rec.direction] || DIR_CHIP.hold;
      const targetTxt = rec.load != null
        ? "Target  " + M.setDisplay(implement, { weightKg: rec.load, reps: rec.reps })
        : rec.reps ? `Pick a load · aim ${rec.reps} reps` : "Pick a load";
      banner = el("div.rxbanner." + rec.direction, {}, [
        el("div", { style: "display:flex;flex-wrap:wrap;gap:6px 9px;align-items:center" }, [
          el("span.rxchip." + rec.direction, { text: glyph + " " + label }),
          el("span.rxtarget", { text: targetTxt }),
        ]),
        el("div.rxwhy", { text: rec.reason + (rec.eased ? " · eased for today's readiness" : "") }),
        stall ? el("div.rxstall", { text: "⚠ " + stall.message }) : null,
      ]);
    }
    const targetsPanel = muscleTargets(rx.exerciseId, true);
    if (banner || targetsPanel) container.appendChild(el("div.rxrow", {},
      [banner, targetsPanel].filter(Boolean)));

    // --- warm-up ramp to the working weight (computed off today's target) ---
    if (!state.timed) {
      const wu = warmupPlan({ load: state.sets[0] && state.sets[0].weightKg, implement, location, equip,
        role: rx.role, timed: false });
      if (wu) container.appendChild(el("div.warmup", {}, [
        el("span.label", { text: "Warm-up" }),
        el("span.wu-sets", { text: wu.map((s) => `${M.setDisplay(implement, { weightKg: s.weightKg, reps: s.reps })}`).join("   ") }),
      ]));
    }

    // --- weight entry widget (implement-aware) ---
    const weightZone = el("div", { style: "margin-top:8px" });
    let widget = null;
    function buildWidget() {
      clear(weightZone);
      const w = state.sets[active].weightKg;
      if (implement === "bodyweight") {
        widget = null;
        weightZone.appendChild(el("p.note.center", { text: "Bodyweight — log reps/time only" }));
      } else if (implement === "barbell" || implement === "ez_bar") {
        widget = PlateCalc(implement, equip, w, (total) => { state.sets[active].weightKg = total; state.sets[active].edited = true; }, profile);
        weightZone.appendChild(widget.node);
      } else {
        widget = WeightStepper(implement, equip, location, w, (val) => { state.sets[active].weightKg = val; state.sets[active].edited = true; }, profile);
        weightZone.appendChild(widget.node);
      }
    }
    function syncWidget() {
      const w = state.sets[active].weightKg;
      if (!widget) return;
      if (widget.setTotal) widget.setTotal(w);
      else if (widget.setValue) widget.setValue(w);
    }
    buildWidget();

    // --- reps / seconds stepper ---
    const repsLabel = state.timed ? "sec" : "reps";
    const repsVal = el("input", { type: "number", inputmode: "numeric", value: String(curRep()) });
    function curRep() { return state.timed ? state.sets[active].seconds : state.sets[active].reps; }
    function setRep(v) {
      v = Math.max(0, Math.round(v));
      if (state.timed) state.sets[active].seconds = v; else state.sets[active].reps = v;
      state.sets[active].edited = true;
      repsVal.value = String(v);
    }
    repsVal.addEventListener("change", () => setRep(Number(repsVal.value) || 0));
    const repsRow = el("div.reps-row", {}, [
      el("div.dim", { text: repsLabel }),
      el("div.numfield", {}, [
        el("button.stepbtn", { style: "width:46px;height:46px;font-size:1.3rem", "aria-label": state.timed ? "Less time" : "Fewer reps", onclick: () => setRep(curRep() - (state.timed ? 5 : 1)) }, "−"),
        repsVal,
        el("button.stepbtn", { style: "width:46px;height:46px;font-size:1.3rem", "aria-label": state.timed ? "More time" : "More reps", onclick: () => setRep(curRep() + (state.timed ? 5 : 1)) }, "+"),
      ]),
    ]);

    // --- optional per-set RIR (reps in reserve) — never required; captured for
    //     the progression engine and to spot grinding (RIR 0) on a topped-out set ---
    let rirRow = null;
    if (!state.timed) {
      const opts = [["–", "null"], ["3+", "3"], ["2", "2"], ["1", "1"], ["0", "0"]];
      const chips = el("div.rirchips", {}, opts.map(([lab, val]) =>
        el("button.rirchip", { dataset: { rir: val }, onclick: () => {
          state.sets[active].rir = val === "null" ? null : Number(val);
          state.sets[active].edited = true; syncRir();
        } }, lab)));
      rirRow = el("div.rirrow", {}, [el("span.dim", { text: "RIR" }), chips]);
    }
    function syncRir() {
      if (!rirRow) return;
      const cur = state.sets[active].rir;
      rirRow.querySelectorAll(".rirchip").forEach((c) => {
        const v = c.dataset.rir === "null" ? null : Number(c.dataset.rir);
        c.classList.toggle("on", v === cur);
      });
    }

    // --- set list — each row is the input surface (weight + reps cells); the
    //     ACTIVE row expands inline to hold the implement-aware editor (accordion),
    //     so logging happens in place with no eye-travel to a separate panel. ---
    const setlist = el("div.setlist");
    let editor = null;   // the inline editor panel, mounted under the active row by drawSets
    // weight / reps cell text for a set, using `src` for the displayed numbers
    // (the set itself when active/done, the previous set when pending = a ghost).
    function cells(src) {
      const reps = state.timed ? (src.seconds ?? 0) + "s" : "× " + (src.reps ?? "");
      let wt;
      if (state.timed) wt = null;
      else if (implement === "bodyweight" || ((Number(src.weightKg) || 0) === 0 && implement !== "cable")) wt = "BW";
      else if (implement === "dumbbell_pair") wt = "2×" + M.fmtWeight(src.weightKg);
      else wt = M.fmtWeight(src.weightKg);
      return [wt, reps];
    }
    function drawSets() {
      clear(setlist);
      state.sets.forEach((s, i) => {
        const isActive = i === active && !s.done;
        const ghost = !s.done && !isActive;                   // pending → dimmed, but show the REAL target
        // Always show the set's own (uniform) prescription — never last session's per-set
        // actuals, which made pending rows read like a jagged plan (e.g. 55/57.5/60 kg
        // under a flat 67.5 kg target). Last time stays visible in the exercise header.
        const [wt, reps] = cells(s);
        const cls = s.done ? ".done" : isActive ? ".active" : "";
        const tick = s.done
          ? el("span.tick" + (s.pr ? ".pr" : ""), { html: s.pr ? "🏆" : "✓" })
          : isActive
          ? el("button.tick.commit", { "aria-label": "Complete set", onclick: (e) => { e.stopPropagation(); logSet(); } }, "✓")
          : el("span.tick.pending", {});
        const row = el("div.setrow" + cls, { onclick: () => { if (!isActive) setActive(i); } }, [
          el("span.n", { text: "S" + (i + 1) }),
          el("div.cells" + (ghost ? ".ghost" : ""), {}, [
            wt != null ? el("span.cell.w", { text: wt }) : el("span.cell.w.faint", { text: "—" }),
            el("span.cell.r", { text: reps }),
          ]),
          tick,
        ]);
        setlist.appendChild(row);
        if (isActive && editor) setlist.appendChild(editor);   // accordion: editor under the active row
      });
    }

    function setActive(i) {
      active = i;
      state.sets[i].done = false; // reopen for editing
      buildWidget();
      repsVal.value = String(curRep());
      syncRir();
      drawSets();
      updateLogBtn();
    }

    // --- log button + volume ---
    const volEl = el("span.tnum");
    const logBtn = el("button.btn.primary.big.block");
    function liveVolume() {
      const logged = { implement, sets: state.sets.filter((s) => s.done) };
      return priorVolume() + M.exerciseVolume(logged);
    }
    function updateLogBtn() {
      const remaining = state.sets.filter((s) => !s.done).length;
      logBtn.textContent = remaining > 0 ? `Log set ${active + 1}` : "All sets done";
      volEl.textContent = M.fmtWeight(Math.round(liveVolume()));
    }

    let replannedUp = false;   // bump the remaining sets at most once per lift
    function logSet() {
      const s = state.sets[active];
      s.done = true;
      // first set auto-fills later un-edited sets (§8)
      if (active === 0) {
        for (let i = 1; i < state.sets.length; i++) {
          if (!state.sets[i].done && !state.sets[i].edited) {
            state.sets[i].weightKg = s.weightKg;
            if (state.timed) state.sets[i].seconds = s.seconds; else state.sets[i].reps = s.reps;
          }
        }
      }
      // in-session replanning: a hard miss (or an easy overshoot with reps in
      // reserve) re-prescribes the REMAINING sets right now, not next week
      if (!state.timed && state.sets.some((x) => !x.done)) {
        const plan = replanSets({ set: s, rx, implement, location, equip,
          allowUp: !replannedUp && (!rec || rec.direction !== "deload") });
        if (plan) {
          if (plan.direction === "up") replannedUp = true;
          for (const x of state.sets) if (!x.done && !x.edited) { x.weightKg = plan.load; x.reps = plan.reps; }
          toast((plan.direction === "down" ? "↓ " : "↑ ") + plan.reason);
        }
      }
      // in-the-moment PR: a logged set that beats the all-time best e1RM
      let prHit = false;
      if (!state.timed && s.reps) {
        const e = e1rm(s.weightKg, s.reps), prevBest = bestE1[rx.exerciseId];
        if (prevBest !== undefined && e > prevBest + 0.05) { s.pr = true; bestE1[rx.exerciseId] = e; prHit = true; }
        else if (prevBest === undefined || e > prevBest) bestE1[rx.exerciseId] = e;
      }
      if (prHit) { haptic(25); celebrate(1400); toast("🏆 New best · " + lib.name); }
      else haptic(15);
      const next = state.sets.findIndex((x) => !x.done);
      if (next >= 0) {
        startRest(exercises[exIndex].restSeconds);
        active = next;
        buildWidget();
        repsVal.value = String(curRep());
        syncRir();
      }
      drawSets();
      updateLogBtn();
      if (next < 0) finishExercise();
    }
    logBtn.onclick = logSet;

    // the editor panel that expands under the active set row (weight widget +
    // reps stepper + optional RIR + the commit button)
    editor = el("div.set-editor", {}, [weightZone, repsRow, rirRow, logBtn].filter(Boolean));
    container.appendChild(el("div.row", { style: "margin:10px 2px 6px" }, [
      el("span.dim", { text: "Session volume" }), el("span.spacer"), volEl,
    ]));
    container.appendChild(setlist);
    container.appendChild(el("button.btn.ghost.block", { style: "margin-top:10px", onclick: () => finishExercise() },
      exIndex < exercises.length - 1 ? "Skip to next exercise ›" : "Finish logging ›"));

    drawSets();
    updateLogBtn();
    syncRir();

    // flush the current lift's DONE sets into results (idempotent per lift in the
    // editable flow, so jumping back and re-logging replaces rather than duplicates).
    function commit() {
      const doneSets = state.sets.filter((s) => s.done).map((s, i) => ({
        setNumber: i + 1, weightKg: s.weightKg,
        reps: state.timed ? null : s.reps, ...(state.timed ? { seconds: s.seconds } : {}),
        ...(s.rir != null ? { rir: s.rir } : {}),
      }));
      flags[exIndex].visited = true;
      if (doneSets.length) {
        flags[exIndex].logged = true;
        if (canEdit) for (let k = results.length - 1; k >= 0; k--) if (results[k].exerciseId === rx.exerciseId) results.splice(k, 1);
        results.push({ exerciseId: rx.exerciseId, implement, sets: doneSets, _i: exIndex });
      }
      if (opts.onProgress) opts.onProgress(results.slice(), Math.min(exIndex + 1, exercises.length));   // resumable draft
    }
    commitCurrent = commit;

    function finishExercise() {
      clearRest();
      commit();
      // advance to the next UNLOGGED lift; if none ahead, review any skipped /
      // unfinished ones before closing the session out.
      let n = -1;
      for (let i = exIndex + 1; i < exercises.length; i++) if (!flags[i].logged) { n = i; break; }
      if (n >= 0) { exIndex = n; renderExercise(); return; }
      const remaining = exercises.map((_, i) => i).filter((i) => !flags[i].logged);
      if (remaining.length) { renderReview(remaining); return; }
      restTicker.stop(); onComplete && onComplete(results);
    }

    // X button = leave the whole workout. Offer save-for-later / complete-now /
    // discard (advancing between exercises is the "Skip to next ›" button's job).
    async function maybeExit() {
      if (!opts.onExit) {   // stand-alone (e.g. substitute flow): just move on
        if (confirm("Move on from this exercise? Logged sets are kept; un-logged ones are skipped (you can come back to them).")) finishExercise();
        return;
      }
      const hasLogged = results.length > 0 || state.sets.some((s) => s.done);
      const kind = await interruptSheet({ canComplete: hasLogged });
      if (kind === "continue") return;
      clearRest();
      if (kind !== "discard") commit();   // capture the current lift's logged sets
      opts.onExit(kind, kind === "discard" ? null : results.slice());
    }
  }

  // --- rest timer pill (§8: dismissible) ---
  function startRest(seconds) {
    clearRest();
    if (!seconds) return;
    restTotal = seconds;
    const ring = el("span.rest-ring");
    const t = el("span.t");
    const drawRing = (rem) => {
      const p = restTotal ? Math.max(0, Math.min(1, rem / restTotal)) : 0;
      ring.style.background = `conic-gradient(var(--accent) ${p * 360}deg, var(--bg-elev3) 0)`;
    };
    restPill = el("div.resttimer", {}, [
      ring, el("span.lab", { text: "Rest" }), t, el("span.spacer"),
      el("button.rbtn", { "aria-label": "Subtract 15 seconds", onclick: () => restTicker.addSeconds(-15) }, "−15"),
      el("button.rbtn", { "aria-label": "Add 15 seconds", onclick: () => { restTotal += 15; restTicker.addSeconds(15); } }, "+15"),
      el("button.btn", { style: "min-height:36px;padding:0 14px", onclick: () => clearRest() }, "Skip"),
    ]);
    document.body.appendChild(restPill);
    restTicker.onTick = (rem) => {
      t.textContent = M.fmtDuration(rem); drawRing(rem);
      if (rem <= 3 && rem > 0) { cueTick(); haptic(15); }   // 3-2-1 count into the next set
    };
    restTicker.onDone = () => { cueItemEnd(); haptic(25); clearRest(); };
    restTicker.start(seconds);
  }
  function clearRest() {
    restTicker.stop();
    if (restPill) { restPill.remove(); restPill = null; }
  }

  if (exIndex >= exercises.length) { onComplete && onComplete(results); return; }   // resumed past the end
  renderExercise();
}
