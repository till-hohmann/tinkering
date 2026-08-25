// strength.js — strength logging (requirements §8). One exercise at a time:
// implement-aware weight entry (plate calc / dumbbell scroller / cable stepper),
// pre-filled sets, ghosted previous values, per-set tap-to-adjust, live volume,
// dismissible rest timer. Calls onComplete(strengthResult[]) when all exercises done.

import { el, clear, haptic, go, registerCleanup } from "../ui.js";
import { arrangeWithSupersets, supersetsAllowed,
  groupLabel, nextInGroup } from "../supersets.js";
import { interruptSheet } from "../components/interrupt.js";
import { illustration } from "../illustrations.js";
import { photoURL, loadPhotoManifest } from "../exercise-photo.js";
import { exerciseHistory, exerciseHistoryAcross, getAllPrograms, getAllSessions, equipmentForProgram } from "../store.js";
import { getProfile, withPlace } from "../profile.js";
import { PlateCalc } from "../components/plate-calc.js";
import { WeightStepper } from "../components/db-scroller.js";
import { Ticker } from "../components/timer.js";
import { cueItemStart, cueItemEnd, cueTick } from "../components/sound.js";
import { celebrate } from "../components/confetti.js";
import { recommend, detectStall, roundLoad, isDeloadWeek, e1rm, warmupPlan, replanSets, loadCeiling, rackAt } from "../progression.js";
import { availableAt } from "../exercise-library.js";
import { alternativesFor, metaFor, seedSubLoad, SUB_EXERCISES, implementAvailable } from "../substitution.js";
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

// Bottom-sheet exercise picker. Resolves the chosen exerciseId, or null if
// cancelled.
//
// THE WHOLE CATALOGUE, not just this block's lifts.
//
// This used to list `program.exercises` — the handful of movements the block
// happens to program. That is the wrong set for both callers. Swapping is for
// when you can't do the planned lift, and the alternative you need is very often
// one this block never programmed; adding is explicitly "give me the long list".
// So the source is the full library, filtered to what this place can load.
//
// Filtered, but not silently: `availableAt` gates on both the implement and the
// station, and a gym always has something the profile doesn't know about, so the
// filter is a default you can switch off rather than a wall.
//
// `matchFor` turns the sheet into a swap picker: equal alternatives are lifted
// into their own section at the top (see alternativesFor), full list below.
function pickExercise(program, { excludeId = null, matchFor = null, equip, location,
                                 title = "Choose exercise" } = {}) {
  return new Promise((res) => {
    const implementsHere = (equip && equip.locations && equip.locations[location]) || [];
    const pool = availableAt(implementsHere);
    const poolIds = new Set(pool.map((e) => e.id));
    // Substitute-only lifts aren't in the library but are exactly what the
    // curated matches point at, so admit them on their implement alone.
    const usable = new Set(poolIds);
    for (const [id, meta] of Object.entries(SUB_EXERCISES))
      if (implementAvailable(meta.implement, location, equip)) usable.add(id);

    const alts = matchFor ? alternativesFor(matchFor, { pool, available: usable }) : [];
    const altSet = new Set(alts);

    // Everything offerable, name-resolved once. Program lifts ride along even if
    // the library doesn't know them (an imported block may carry its own).
    const everything = new Set([...usable, ...Object.keys(program.exercises || {})]);
    const meta = (id) => metaFor(program, id);
    const restrictedOut = [...everything].filter((id) => !usable.has(id));

    let showAll = false;
    const listWrap = el("div.sheet-list");
    const search = el("input.sheet-search", { type: "text", inputmode: "search", placeholder: "Search all exercises…" });
    const allBtn = el("button.btn.ghost", { style: "padding:4px 12px;font-size:.78rem",
      onclick: () => { showAll = !showAll; allBtn.textContent = showAll ? "Only what's here" : "Show all"; draw(search.value); } },
      "Show all");

    function row(id, tag) {
      const m = meta(id);
      return el("button.item", { style: "text-align:left", onclick: () => close(id) }, [
        el("div.ico", {}, [illustration(id)]),
        el("div.meta", {}, [
          el("div.t", { text: m.name || id }),
          el("div.s", { text: (m.implement || "").replace(/_/g, " ") }),
        ]),
        tag || null,
      ].filter(Boolean));
    }
    function draw(q) {
      clear(listWrap);
      const ql = (q || "").toLowerCase();
      const hit = (id) => !ql || (meta(id).name || id).toLowerCase().includes(ql);
      const byName = (a, b) => (meta(a).name || a).localeCompare(meta(b).name || b);

      // matched alternatives keep their RANKED order — best match first is the
      // whole point of the section, so it must not be re-sorted alphabetically
      const shownAlts = alts.filter((id) => id !== excludeId && hit(id));
      if (shownAlts.length) {
        listWrap.appendChild(el("div.label", { style: "padding:10px 4px 4px", text: "Trains the same thing" }));
        for (const id of shownAlts)
          listWrap.appendChild(row(id, el("span.badge.accent", { text: "match" })));
        listWrap.appendChild(el("div.label", { style: "padding:14px 4px 4px", text: "Everything else" }));
      }
      const rest = [...everything]
        .filter((id) => id !== excludeId && !altSet.has(id) && hit(id) && (showAll || usable.has(id)))
        .sort(byName);
      if (!rest.length && !shownAlts.length) {
        listWrap.appendChild(el("p.dim", { style: "padding:14px;text-align:center",
          text: showAll || !restrictedOut.length ? "No match" : "No match here — try Show all." }));
        return;
      }
      for (const id of rest)
        listWrap.appendChild(row(id, usable.has(id) ? null : el("span.badge", { text: "not here" })));
    }

    const ov = el("div.sheet");
    ov.appendChild(el("div.sheet-card", {}, [
      el("div.sheet-grip"),
      el("div.row", { style: "margin-bottom:8px" }, [el("div.label", { text: title }), el("span.spacer"),
        allBtn,
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
  // opts.adhocPlace is a gym described for this session only and never saved to
  // the profile, so it has to be folded in here rather than looked up.
  const equip = withPlace(await equipmentForProgram(program), opts.adhocPlace);
  const profile = await getProfile();   // display units for the weight widgets
  await loadPhotoManifest();            // so photoURL() can answer while rendering each exercise
  // opts.exercises overrides the planned list (e.g. a substitute workout);
  // opts.recs supplies pre-built recommendations (substitute targets) so we skip
  // the engine. Otherwise compute the autoregulated recommendation + stall flag.
  // Clone the ENTRIES, not just the array. `.slice()` was enough while swap and
  // add only ever replaced whole entries, but changing a set count edits one in
  // place — and these objects are the program's own day template, still held in
  // memory, so an extra set today would silently rewrite the plan for every
  // future week. `_plannedSets` remembers what was asked of you before you
  // changed it, which is the baseline the end-of-session question compares to.
  let exercises = (opts.exercises || day.exercises).map((e) => ({ ...e, _plannedSets: e.prescribedSets }));

  // --- supersets and circuits -------------------------------------------------
  //
  // ⚠ THE PLAN HAS CARRIED A `supersets` FIELD SINCE THE FIRST BLOCK AND NOTHING
  // HAS EVER READ IT. Two of Till's blocks declare one — curls with pushdowns,
  // curls with overhead extensions — and both have been running as plain
  // straight sets for their whole life. Honoured here, at the one point every
  // caller passes through: the planned session and the substitute flow both
  // arrive in this function.
  //
  // A COMPOSITE IS EXPANDED WHATEVER THE ANSWER ABOUT SUPERSETS. "Core Circuit"
  // is one library row whose own name lists three movements; splitting it is not
  // a superset, it is the exercise finally being written down as what it is, and
  // it is what lets each hold be timed and ended early on its own.
  //
  // Pairings are NOT invented here. The generator decides them at build time,
  // where it can see the whole block and answer for it once; a session that
  // paired things up on the fly would hand you a different workout each time you
  // opened the same day.
  {
    const place = (profile.places || []).find((p) => p.id === location || p.name === location) || null;
    const allowSS = supersetsAllowed(program, opts.adhocPlace || place);
    exercises = arrangeWithSupersets(exercises, day.supersets, { allow: allowSS });
  }
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
        implement: metaFor(program, e.exerciseId).implement,
        location, equip, exerciseId: e.exerciseId, deload,
      });
    });
    stalls = histories.map((h, i) => detectStall(h.map((o) => o.exercise),
      loadCeiling(metaFor(program, exercises[i].exerciseId).implement, location, equip)));
  }

  // readiness autoregulation: ease loads ~10% and/or trim a set on a rough day
  const rd = opts.readiness;
  if (rd && (rd.mult !== 1 || rd.dropSet)) {
    if (rd.mult && rd.mult !== 1) {
      recs = recs.map((r, i) => {
        if (!r || r.load == null) return r;
        const impl = metaFor(program, exercises[i].exerciseId).implement;
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

  // WHAT YOU DID DIFFERENTLY TODAY, recorded as it happens rather than diffed
  // afterwards. A diff against the template can see that a session has four sets
  // of an exercise the plan gives three, but not whether you MEANT it — a
  // substituted session, a readiness-eased one and a deliberate extra set all
  // look identical after the fact. Captured live, each of these is an intent,
  // which is what makes the end-of-session question worth asking at all.
  const addedIds = [];          // exercises that weren't in today's plan
  const swapped = [];           // { fromId, toId }
  const setDeltas = new Map();  // exerciseId → net sets added (+) or dropped (−)

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
  // `seed` carries the load across a swap: a lift this block has never programmed
  // has no history, so the engine would honestly say "first time — pick a load"
  // and hand back the session's whole point. The planned lift's target converted
  // through the substitution ratios is a far better opening bid, and it is
  // explicitly a suggestion — the first logged set re-plans the rest anyway.
  async function makeEntry(exId, baseRx, seed = null) {
    // metaFor, NOT program.exercises: the picker now offers the whole library,
    // and most of it isn't in any one block. A missing entry meant `implement`
    // came back undefined, and the engine rounds, caps and prescribes off that.
    const lib = metaFor(program, exId);
    const rx = { exerciseId: exId, prescribedSets: baseRx.prescribedSets || 3,
      repRange: baseRx.repRange || "8-12", restSeconds: baseRx.restSeconds || 90, role: baseRx.role,
      // a swap inherits the slot's planned count; an added lift was never planned
      _plannedSets: baseRx._plannedSets != null ? baseRx._plannedSets : 0 };
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
    // Gated on "the engine produced no load", NOT on direction === "new".
    // A lift with no history returns "new" on a normal week and "deload" on a
    // deload week — both with load null — so keying off the direction silently
    // dropped the carried load for a whole week of every block.
    if (rec.load == null && seed && seed.load) {
      const load = seedSubLoad(seed.fromId, exId, seed.load, lib.implement, location, equip);
      if (load) {
        rec.load = load;
        rec.reps = seed.reps || rec.reps;
        rec.reason = `Matched to your ${metaFor(program, seed.fromId).name || seed.fromId} target — same effort, adjust on the first set.`;
      }
    }
    return { rx, prev, rec, stall: detectStall(hist.map((o) => o.exercise), loadCeiling(lib.implement, location, equip)) };
  }
  async function swapExercise() {
    const fromId = exercises[exIndex].exerciseId;
    const fromRec = recs[exIndex] || {};
    const exId = await pickExercise(program, { excludeId: fromId, matchFor: fromId, equip, location,
      title: "Swap for" });
    if (!exId) return;
    // keep the current sets/range/rest, and carry the target load across
    const e = await makeEntry(exId, exercises[exIndex],
      { fromId, load: fromRec.load, reps: fromRec.reps });
    exercises[exIndex] = e.rx; prevs[exIndex] = e.prev; recs[exIndex] = e.rec; stalls[exIndex] = e.stall;
    flags[exIndex] = { logged: false, visited: false };   // a new lift in this slot starts fresh
    swapped.push({ fromId, toId: exId });
    renderExercise();
  }
  async function addExercise() {
    const exId = await pickExercise(program, { equip, location, title: "Add an exercise" });
    if (!exId) return;
    const e = await makeEntry(exId, { prescribedSets: 3, repRange: "8-12", restSeconds: 90 });
    const at = exIndex + 1;   // log it right after the current one
    exercises.splice(at, 0, e.rx); prevs.splice(at, 0, e.prev); recs.splice(at, 0, e.rec); stalls.splice(at, 0, e.stall);
    flags.splice(at, 0, { logged: false, visited: false });
    addedIds.push(exId);
    // update chrome IN PLACE (re-rendering would reset the current exercise's
    // half-entered sets) — the added lift comes up next when this one finishes.
    const badge = container.querySelector(".routine-head .navbadge");
    if (badge) badge.textContent = `≡  ${exIndex + 1}/${exercises.length}`;
    const skip = container.querySelector("button.btn.ghost.block");
    if (skip) skip.textContent = exIndex < exercises.length - 1 ? "Skip to next exercise ›" : "Finish logging ›";
    toast(`Added ${metaFor(program, exId).name || exId} — up next`);
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

  // What actually changed, measured against the LOG rather than the intent.
  // Adding a set and then not doing it, or swapping to a lift and skipping it,
  // changed nothing about the session — asking about it would be asking the user
  // to ratify a plan change they didn't make.
  function deviationSummary() {
    const setsLogged = (id) => {
      const r = results.find((x) => x.exerciseId === id);
      return r && r.sets ? r.sets.length : 0;
    };
    const added = [];
    for (const id of addedIds) {
      const n = setsLogged(id);
      if (n > 0) added.push({ exerciseId: id, sets: n });
    }
    const setChanges = [];
    for (const id of setDeltas.keys()) {
      if (addedIds.includes(id)) continue;   // reported as an added exercise instead
      const rx = exercises.find((e) => e.exerciseId === id);
      const actual = setsLogged(id);
      if (!rx || !actual) continue;
      const planned = rx._plannedSets || 0;
      if (actual !== planned) setChanges.push({ exerciseId: id, planned, actual, delta: actual - planned });
    }
    return { added, setChanges, swapped: swapped.slice() };
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
      const lib = metaFor(program, e.exerciseId);
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
      const e = exercises[i]; const lib = metaFor(program, e.exerciseId);
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
    const rack = rackAt(equip, location);
    const baseW = implement === "barbell" ? rack.barWeightKg : implement === "ez_bar" ? rack.ezBarWeightKg : 0;
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
    // ⚠ RE-ENTERING A LIFT MUST NOT FORGET WHAT YOU LOGGED IN IT. The screen is
    // rebuilt from the plan every time it is opened, so leaving an exercise and
    // coming back — which the jump list openly invites, and which a superset now
    // does on every single set — showed zero sets done and then committed that
    // emptiness over the top of the real ones.
    const prior = results.find((r) => r.exerciseId === rx.exerciseId);
    if (prior) {
      for (let i = 0; i < prior.sets.length && i < sets.length; i++) {
        const ps = prior.sets[i];
        sets[i] = { ...sets[i], weightKg: ps.weightKg,
          reps: timed ? null : (ps.reps != null ? ps.reps : sets[i].reps),
          seconds: timed ? (ps.seconds != null ? ps.seconds : sets[i].seconds) : undefined,
          rir: ps.rir != null ? ps.rir : null, done: true };
      }
    }
    return { timed, sets };
  }

  function renderExercise() {
    clearRest();
    clear(container);
    const rx = exercises[exIndex];
    // metaFor, not program.exercises: swap and add now reach the whole library,
    // and a lift this block never programmed has no entry here — which used to
    // throw on `lib.implement` before the value could even be wrong.
    const lib = metaFor(program, rx.exerciseId);
    const implement = lib.implement;
    const prevEx = prevs[exIndex] ? prevs[exIndex].exercise : null;
    const rec = recs[exIndex];
    const stall = stalls[exIndex];
    const state = initSets(rx, prevEx, implement, rec);
    // Open on the first set still to do, not on set one — coming back into the
    // second half of a superset, set one is already behind you.
    let active = Math.max(0, state.sets.findIndex((x) => !x.done));
    // Held rather than inlined so adding or dropping a set can repaint it: the
    // header said "3 ×" over a four-row set list, which reads as a bug in the
    // logging rather than a change the user just made.
    const rxLine = el("div.rx");
    // WHICH HALF OF WHAT, in words. Being handed a different exercise after every
    // set is either a superset or a bug, and the only thing that tells them
    // apart is the screen saying so before it happens.
    const partnerNames = () => {
      if (rx.supersetId == null) return "";
      const others = exercises
        .filter((e) => e.supersetId === rx.supersetId && e.exerciseId !== rx.exerciseId)
        .map((e) => metaFor(program, e.exerciseId).name || e.exerciseId);
      if (!others.length) return "";
      const kind = groupLabel(new Array(rx.supersetSize));
      return ` · ${kind} ${rx.supersetIndex + 1}/${rx.supersetSize} with ${others.join(" + ")}`;
    };
    const paintRx = () => { rxLine.textContent =
      `${rx.prescribedSets} × ${rx.repRange} · rest ${rx.restSeconds}s${rx.role === "core" ? " · core" : ""}${partnerNames()}`; };
    paintRx();

    // --- header ---
    //
    // Swap / Later / Add sit UP HERE, alongside the jump navigator, rather than
    // in a row under the photograph. They belong together: all four change what
    // you are about to do rather than record what you just did, and the three
    // that were below the image were both easy to miss and a scroll away at the
    // moment you need them — standing at a machine someone else is using.
    //
    // Given their own chip style, not `.btn.ghost`, because a borderless button
    // reads as decoration next to a photograph.
    const headActions = canEdit ? [
      el("button.exact", { "aria-label": "Swap this exercise", onclick: () => swapExercise() }, "⇄ Swap"),
      exIndex < exercises.length - 1
        ? el("button.exact", { "aria-label": "Do this exercise later", onclick: () => doLater() }, "↓ Later")
        : null,
      el("button.exact", { "aria-label": "Add an exercise", onclick: () => addExercise() }, "+ Add"),
    ].filter(Boolean) : [];
    container.appendChild(el("div.routine-head", {}, [
      el("button.btn.ghost", { style: "padding:0", "aria-label": "Exit logging", onclick: () => maybeExit() }, "✕"),
      el("span.spacer"),
      ...headActions,
      el("button.badge.navbadge", { "aria-label": "Jump to another exercise", onclick: () => openNav() }, `≡  ${exIndex + 1}/${exercises.length}`),
    ]));
    container.appendChild(el("div.progress", {}, [el("div.progress-fill", { style: `width:${(exIndex / exercises.length) * 100}%` })]));

    // THE WHOLE IMAGE, not the demo crop. Lists get the cropped photograph
    // because a muscle panel is unreadable at 44px, but this is the screen you
    // stand in front of between sets — the activation half is the half that
    // answers "am I meant to feel this here?", and cropping it away was the
    // wrong trade at this size. Full width, whole composite, tap to enlarge.
    const demoURL = photoURL(rx.exerciseId);
    const heroNode = demoURL
      ? el("button.exhero-btn", { "aria-label": `Enlarge ${lib.name} demonstration`,
          onclick: () => showDemo(demoURL, lib.name) },
          [el("img.exhero-img", { src: demoURL, alt: `${lib.name} — demonstration and muscles worked`,
            decoding: "async" })])
      : el("div", { style: "width:74px;height:74px;color:var(--accent);flex:none" }, [illustration(rx.exerciseId)]);
    container.appendChild(el("div.ex-head", {}, [
      demoURL
        ? el("div", {}, [el("h2", { style: "margin:0 0 10px" }, lib.name), heroNode])
        : el("div.row", {}, [heroNode, el("h2", { style: "margin:0", text: lib.name })]),
      el("div.cue", { text: lib.cue || "" }),
      rxLine,
      prevEx ? el("div.rx", { text: "Last time: " + prevEx.sets.map((s) => M.setDisplay(implement, s)).join("  ") })
        : anchorWeight(program, rx.exerciseId) != null ? el("div.rx", { text: "Week-1 anchor: " + program.loadAnchors[rx.exerciseId] }) : null,
    ]));

    // (Swap / Later / Add moved into the header above, next to the navigator.)

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
    // Suppressed when the render is showing: its right-hand half IS an activation
    // map, and the app's SVG version directly beneath it says the same thing worse
    // — while costing vertical space on the one screen where the set list matters.
    const targetsPanel = demoURL ? null : muscleTargets(rx.exerciseId, true);
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
        // The plate picker must show the plates THIS gym has, not the first
        // place's — otherwise it offers denominations that aren't on the rack.
        widget = PlateCalc(implement, rackAt(equip, location), w, (total) => { state.sets[active].weightKg = total; state.sets[active].edited = true; }, profile);
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
      paintSetBar();   // "− Set" turns off once every set is logged
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
      // --- SUPERSET: GO TO THE PARTNER, AND REST AFTER THE PAIR, NOT INSIDE IT.
      // That ordering IS the superset. Resting between the two halves would make
      // it two exercises done in a row, which is what the app did for every
      // superset any block ever declared.
      const partner = supersetPartnerFor(state.sets.filter((x) => x.done).length);
      if (partner >= 0) {
        commit();
        exIndex = partner;
        renderExercise();
        return;
      }
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
    // --- TIMED HOLDS RUN ON A CLOCK, NOT ON A NUMBER PAD -----------------------
    //
    // A plank, a dead hang, a side plank: you start it, it counts down, and you
    // either make the target or you stop when you cannot hold any more. The app
    // asked you to type the seconds afterwards from memory, which is both a
    // worse measurement and the only place in the app where a hold behaved
    // differently from the identical hold in a warm-up. Same controls as the
    // routine engine, because it is the same act.
    let holdCtl = null;
    if (state.timed) {
      const bigTime = el("div.holdclock", { text: `${curRep()}s` });
      const startBtn = el("button.btn.primary.big.block", {}, "▶ Start hold");
      const endBtn = el("button.btn.block.endhold", { style: "display:none" },
        "✋ End hold — log my time");
      let ticker = null, target = 0, startedAt = 0;
      const stop = () => { if (ticker) { ticker.stop(); ticker = null; } };
      const finish = (heldSec) => {
        stop();
        setRep(Math.max(0, Math.round(heldSec)));
        bigTime.textContent = `${curRep()}s`;
        startBtn.style.display = "";
        startBtn.textContent = "▶ Start hold";
        endBtn.style.display = "none";
        try { cueItemEnd(); } catch (_) {}
        logSet();
      };
      startBtn.onclick = () => {
        target = Math.max(1, curRep());
        startedAt = performance.now();
        startBtn.style.display = "none";
        endBtn.style.display = "";
        try { cueItemStart(); } catch (_) {}
        ticker = new Ticker({
          onTick: (rem) => {
            bigTime.textContent = `${rem}s`;
            // The last three seconds get the same ticks the routine engine gives
            // them, so a hold sounds the same wherever you meet it.
            if (rem <= 3 && rem > 0) { try { cueTick(); } catch (_) {} }
          },
          onDone: () => finish(target),
        });
        ticker.start(target);
      };
      endBtn.onclick = () => finish((performance.now() - startedAt) / 1000);
      holdCtl = el("div.holdrun", {}, [bigTime, startBtn, endBtn]);
      // Leaving the screen mid-hold must not leave a ticker running behind it.
      registerCleanup(stop);
    }

    editor = el("div.set-editor", {},
      [weightZone, repsRow, rirRow, holdCtl, holdCtl ? null : logBtn].filter(Boolean));
    container.appendChild(el("div.row", { style: "margin:10px 2px 6px" }, [
      el("span.dim", { text: "Session volume" }), el("span.spacer"), volEl,
    ]));
    container.appendChild(setlist);

    // --- one more set / one fewer -------------------------------------------
    // Sets were fixed at the prescribed count, so "I've got one more in me" and
    // "that's enough today" both had to wait for the post-session summary editor
    // — i.e. you logged a workout you didn't do and corrected it afterwards.
    //
    // Removing only ever takes a set you have NOT logged. A logged set is a
    // record of something that happened; dropping it silently is data loss, and
    // the summary's edit mode is the place for genuine corrections.
    const setBar = el("div.btn-row", { style: "margin-top:10px" });
    function pendingCount() { return state.sets.filter((s) => !s.done).length; }
    function redrawAfterSetChange() {
      if (active >= state.sets.length) active = state.sets.length - 1;
      if (state.sets[active].done) {
        const next = state.sets.findIndex((s) => !s.done);
        active = next >= 0 ? next : state.sets.length - 1;
      }
      rx.prescribedSets = state.sets.length;
      setDeltas.set(rx.exerciseId, state.sets.length - (rx._plannedSets || 0));
      paintRx();
      buildWidget();
      repsVal.value = String(curRep());
      syncRir();
      drawSets();
      updateLogBtn();   // repaints the set bar too
    }
    function addSet() {
      // copy the last set's prescription rather than re-deriving it: by now the
      // in-session replanner may have moved the target, and the extra set should
      // continue what you are actually lifting, not what the plan opened with.
      const lastSet = state.sets[state.sets.length - 1] || {};
      state.sets.push({ weightKg: lastSet.weightKg, reps: state.timed ? null : lastSet.reps,
        seconds: state.timed ? lastSet.seconds : undefined, rir: null, done: false, edited: false });
      redrawAfterSetChange();
    }
    function removeSet() {
      const i = [...state.sets.keys()].reverse().find((k) => !state.sets[k].done);
      if (i == null || state.sets.length <= 1) return;
      state.sets.splice(i, 1);
      redrawAfterSetChange();
    }
    function paintSetBar() {
      const canRemove = state.sets.length > 1 && pendingCount() > 0;
      clear(setBar);
      setBar.append(
        el("button.btn.ghost", { style: "flex:1;min-height:38px;font-size:.8rem", disabled: !canRemove,
          "aria-label": "One fewer set", onclick: () => removeSet() }, "− Set"),
        el("button.btn.ghost", { style: "flex:1;min-height:38px;font-size:.8rem",
          "aria-label": "One more set", onclick: () => addSet() }, "+ Set"),
      );
    }
    paintSetBar();
    container.appendChild(setBar);

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

    /**
     * The next member of this superset still owing a set for the round just
     * completed, or -1 when the round is finished and it is time to rest.
     *
     * Counted from `results` rather than from any screen state, because the
     * partner's screen does not exist while you are standing in this one — its
     * sets live in the committed results and nowhere else.
     */
    const supersetPartnerFor = (round) => nextInGroup(exercises, exIndex, round, (j) => {
      const r = results.find((x) => x.exerciseId === exercises[j].exerciseId);
      return r ? r.sets.length : 0;
    });

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
      restTicker.stop(); onComplete && onComplete(results, deviationSummary());
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
