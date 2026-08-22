// views/builder.js — the program builder wizard.
//
// This is what makes the app usable by someone who isn't already their own
// coach. The app has always been an executor: programs were authored offline and
// imported as JSON, which works fine when the author and the user are the same
// person and not at all otherwise.
//
// The flow follows Galpin's ten-step design process, but only asks the questions
// a person can actually answer. Steps 5-9 (exercise selection, exercise order,
// intensity, volume, rest intervals) are DERIVED — the generator does them, and
// the review screen shows the result rather than interrogating the user about
// set counts they have no basis to choose.
//
//   1  Goal            -> asked (name + what "done" looks like)
//   2  Defender        -> asked (where the 10 points of your life actually go)
//   3  Timeline        -> asked (block length)
//   4  Frequency       -> asked (which days, how many)
//   5  Exercise choice -> derived from your places' equipment
//   6  Exercise order  -> derived (most neural first)
//   7  Intensity       -> derived (~3%/week, as a tightening rep range)
//   8  Volume          -> derived (~5%/week, capped at 10%)
//   9  Rest            -> derived per adaptation
//   10 Chaos           -> asked (what usually derails you) -> written into notes
//
// Plus the step that comes before all of them in Part 1: rank the nine
// adaptations, because "what are you actually training for" is the question the
// rest of the plan hangs off.

import { el, mount, go, backBtn, addActionBar, clear, setChildren } from "../ui.js";
import { ADAPTATIONS, byId as adaptationById, analysePriorities, compatibility,
  BLOCK_SHAPES, isCardio, isStrength } from "../builder/adaptations.js";
import { generateProgram } from "../builder/generate.js";
import { auditBlock } from "../builder/quality.js";
import { getProfile, patchProfile } from "../profile.js";
import { defaultEquipmentFor, weightValue, weightToKg, weightLabel, distanceValue, distanceLabel } from "../units.js";
import { FULL_GYM } from "../equipment.js";
import { placeEditor, blankPlace, tidyPlace } from "../components/place-editor.js";
import { importProgram, getAllPrograms } from "../store.js";
import { todayISO } from "../model.js";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Wizard state lives in module scope so Back doesn't lose answers. Reset on entry.
let S = null;
function freshState(profile) {
  return {
    step: 0,
    name: "",
    goalText: "",
    priorities: [],
    defender: { work: 3, people: 3, fitness: 2, recovery: 2 },
    lengthWeeks: 6,
    blockShapeId: "classic",
    mandatoryDays: 3,
    scheduleTouched: false,
    optionalDays: 1,
    cardioPerWeek: 1,
    mobility: false,
    // ⚠ ASKED, NEVER ASSUMED. A superset is a training choice and a social one:
    // it halves your rest and doubles what you are holding in a shared gym. The
    // default is NO, so someone who never answers the question never finds
    // themselves camped on two stations. See supersets.js.
    supersets: false,
    places: null,
    startDate: nextMonday(),
    startMode: "after",          // resolved in renderBuilder once the blocks are known
    afterLastBlock: null,
    profile,
    result: null,
    audit: null,
  };
}

function nextMonday() {
  const d = new Date(todayISO() + "T00:00:00");
  const delta = (8 - d.getDay()) % 7 || 7;      // always a FUTURE Monday
  d.setDate(d.getDate() + delta);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function renderBuilder() {
  const profile = await getProfile();
  if (!S || S.profile !== profile) S = freshState(profile);
  // The day after everything already planned. A new block is normally the NEXT
  // block, not one that starts tomorrow on top of the one you're mid-way through.
  try {
    const programs = await getAllPrograms();
    const ends = programs.map((p) => addDaysISO(p.startDate, (p.lengthWeeks || 0) * 7)).filter(Boolean);
    S.afterLastBlock = ends.length ? ends.sort().pop() : null;
    if (S.startMode === "after") S.startDate = S.afterLastBlock || nextMonday();
  } catch (_) { S.startMode = "next"; S.startDate = nextMonday(); }
  draw();
}

function addDaysISO(iso, n) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

const STEPS = [
  { key: "goal", title: "What are you training for?" },
  { key: "priorities", title: "Which adaptations?" },
  { key: "defender", title: "What does life actually allow?" },
  { key: "equipment", title: "What do you train with?" },
  { key: "schedule", title: "How much can you train?" },
  { key: "shape", title: "How long, and what shape?" },
  { key: "review", title: "Your block" },
];

function draw() {
  const stage = el("div.stage");
  mount([stage]);
  const step = STEPS[S.step];
  const progress = el("div", { style: "display:flex;gap:5px;margin:14px 0 18px" },
    STEPS.map((_, i) => el("div", { style:
      `flex:1;height:3px;border-radius:2px;background:${i <= S.step ? "var(--accent)" : "var(--bg-elev3)"}` })));

  stage.appendChild(el("div", {}, [
    backBtn(S.step === 0 ? "Plan" : "Back", "#"),
    progress,
    el("div.label", { text: `Step ${S.step + 1} of ${STEPS.length}` }),
    el("h1", { style: "margin:4px 0 0", text: step.title }),
  ]));
  // The back button needs to move BETWEEN steps, not leave the wizard, except
  // on the first screen where leaving is the only sensible "back". backBtn builds
  // its aria-label as "Back to <label>", so the label has to name the
  // DESTINATION — passing "Back" produced the nonsense "Back to Back".
  const bb = stage.querySelector(".backbtn");
  if (bb) {
    bb.onclick = () => { if (S.step === 0) go("#/week"); else { S.step--; draw(); } };
    bb.setAttribute("aria-label", S.step === 0 ? "Back to Plan" : `Back to step ${S.step}: ${STEPS[S.step - 1].title}`);
  }

  const body = el("div", { style: "margin-top:18px" });
  stage.appendChild(body);
  ({ goal: stepGoal, priorities: stepPriorities, defender: stepDefender,
     equipment: stepEquipment, schedule: stepSchedule, shape: stepShape, review: stepReview })[step.key](body);
}

const next = () => { S.step = Math.min(STEPS.length - 1, S.step + 1); draw(); };

function bar(label, onClick, { disabled = false, secondary = null } = {}) {
  const b = el("button.btn.primary.big.block", { onclick: onClick }, label);
  if (disabled) { b.disabled = true; b.style.opacity = ".5"; }
  return addActionBar(...(secondary ? [secondary, b] : [b]));
}

// --- 1. goal -----------------------------------------------------------------
function stepGoal(body) {
  const nameIn = input("Block name", "e.g. Autumn strength", S.name);
  const goalIn = textarea("What does success look like?",
    `Specific and measurable beats vague. "Squat ${weightValue(100)} ${weightLabel()} for 5" or "run ${Math.round(distanceValue(10))} ${distanceLabel()} without walking" — not "get fitter".`, S.goalText);
  body.append(
    el("p.dim", { text: "A goal you can measure is one you can program for. The more precisely you can name it, the faster you'll get there." }),
    nameIn.wrap, goalIn.wrap,
  );
  bar("Continue", () => {
    S.name = nameIn.el.value.trim() || "My training block";
    S.goalText = goalIn.el.value.trim();
    next();
  });
}

// --- 2. priorities -----------------------------------------------------------
function stepPriorities(body) {
  const warn = el("div", { style: "margin-top:14px" });
  const list = el("div.list", { style: "margin-top:14px" });

  function render() {
    setChildren(list, ...ADAPTATIONS.map((a) => {
      const rank = S.priorities.indexOf(a.id);
      const picked = rank >= 0;
      const row = el("button.item" + (picked ? ".on" : ""), {
        style: "text-align:left" + (picked ? ";border-color:var(--accent)" : ""),
        onclick: () => {
          if (picked) S.priorities.splice(rank, 1);
          else S.priorities.push(a.id);
          render();
        },
      }, [
        el("div.meta", {}, [
          el("div.t", { text: a.name }),
          el("div.s", { text: a.blurb }),
        ]),
        picked ? el("span.badge.accent", { text: "#" + (rank + 1) }) : el("span.badge", { text: "+" }),
      ]);
      return row;
    }));

    const analysis = analysePriorities(S.priorities);
    const notes = [];

    // WHICH PICK ACTUALLY SHAPES THE LIFTING, said out loud.
    //
    // Only the FIRST strength-family choice (skill / speed / power / strength)
    // sets the reps, the rest and the effort; any later one is discarded
    // outright. That was invisible, and it cost a real user a whole block: she
    // picked Skill & technique and then Strength, got a block built entirely to
    // skill's parameters — 40-70% of max, 4-6 reps in reserve — and this screen
    // congratulated her with "these work well together". They didn't work
    // together. The second one did nothing.
    //
    // So the governing pick is named, with the numbers it implies, before she
    // leaves the screen. The numbers are the point: "3-5 reps, 60-120 s rest,
    // 40-70% of max" is recognisably not a strength prescription, where the
    // name "Skill & technique" alone is easy to read as a warm-up flavour.
    const strengthPicks = S.priorities.filter(isStrength);
    const governing = strengthPicks[0] ? adaptationById(strengthPicks[0]) : null;
    if (governing) {
      const bits = [];
      if (governing.reps) bits.push(`${governing.reps[0]}-${governing.reps[1]} reps`);
      if (governing.restSec) bits.push(`${governing.restSec[0]}-${governing.restSec[1]}s rest`);
      if (governing.intensityPct) bits.push(`${governing.intensityPct[0]}-${governing.intensityPct[1]}% of max`);
      notes.push(el("div.card.tight", { style: "margin-top:0" }, [
        el("div.label", { text: "Your lifting will be built as" }),
        el("div", { style: "font-weight:700;margin-top:5px", text: governing.name }),
        el("div.s", { style: "margin-top:3px", text: bits.join(" · ") }),
      ]));
    }

    // A second strength-family pick is not a blend — it is ignored. Say so, and
    // make it one tap to fix rather than something to work out and re-do.
    if (strengthPicks.length > 1) {
      const ignored = strengthPicks.slice(1);
      notes.push(el("p.note.warn", { style: "margin-top:10px", text:
        `${ignored.map((id) => adaptationById(id).short).join(" and ")} `
        + `${ignored.length === 1 ? "is" : "are"} picked but won't change the plan — only ${governing.short} shapes the sets, reps and rest.` }));
      for (const id of ignored) {
        notes.push(el("button.btn.block", { style: "margin-top:8px", onclick: () => {
          // Promote: move it to the front of the strength family, keeping
          // everything else in the order it was picked.
          S.priorities = [id, ...S.priorities.filter((x) => x !== id)];
          render();
        } }, `Make ${adaptationById(id).short} the main one instead`));
      }
    }

    if (S.priorities.length === 0) {
      notes.push(el("p.note", { text: "Pick at least one. Two is the sweet spot — one thing you're chasing and one you're protecting." }));
    }
    if (analysis.tooMany) {
      notes.push(el("p.note.warn", { text: "More than three means everything gets a smaller dose. Consider training two hard and maintaining the rest." }));
    }
    for (const c of analysis.conflicting) {
      notes.push(el("p.note.warn", { text:
        `${adaptationById(c.a).short} + ${adaptationById(c.b).short}: ${c.advice}` }));
    }
    // Only claim two picks work together when they BOTH do something. Two
    // strength-family picks sit closest of all on the spectrum and score as the
    // most compatible pair there is, which is exactly how this message came to
    // reassure someone about a choice that was being thrown away.
    if (S.priorities.length >= 2 && strengthPicks.length <= 1 && !analysis.conflicting.length && !analysis.tooMany) {
      notes.push(el("p.note", { style: "color:var(--accent)", text: "These work well together — they sit close on the adaptation spectrum, so they won't fight each other." }));
    }
    warn.replaceChildren(...notes);
    // Rebuild the action bar so the disabled state tracks the selection.
    bar("Continue", next, { disabled: !S.priorities.length });
  }

  body.append(
    el("p.dim", { text: "Tap in priority order — what you pick first gets the most of your week. You can't train everything at once, and trying is how people spend a year getting slightly worse at nine things." }),
    list, warn,
  );
  render();
}

// --- 3. defender -------------------------------------------------------------
// Galpin's step 2: spend 10 points across the things competing for you. It's a
// forcing device — you cannot give everything a 10, so the number you land on
// for fitness is a far better predictor of adherence than what you'd like to do.
function stepDefender(body) {
  const KEYS = [
    ["work", "Work", "Hours, travel, cognitive load"],
    ["people", "Relationships", "Family, friends, caring responsibilities"],
    ["fitness", "Training", "What you can genuinely give this"],
    ["recovery", "Sleep & recovery", "How protected your sleep actually is"],
  ];
  const total = () => KEYS.reduce((a, [k]) => a + S.defender[k], 0);
  const totalLine = el("div.note", { style: "margin-top:12px" });
  const rows = el("div");

  function render() {
    rows.replaceChildren(...KEYS.map(([k, label, hint]) => {
      const dec = el("button.btn", { style: "padding:6px 13px", onclick: () => { S.defender[k] = Math.max(0, S.defender[k] - 1); render(); } }, "−");
      const inc = el("button.btn", { style: "padding:6px 13px", onclick: () => { S.defender[k] = Math.min(10, S.defender[k] + 1); render(); } }, "+");
      return el("div.row", { style: "margin:12px 0;align-items:center;gap:10px" }, [
        el("div", { style: "flex:1" }, [el("div", { style: "font-weight:600", text: label }), el("div.faint", { style: "font-size:.76rem", text: hint })]),
        dec,
        el("div.metric.sm", { style: "min-width:30px;text-align:center", text: String(S.defender[k]) }),
        inc,
      ]);
    }));
    const t = total();
    totalLine.textContent = t === 10
      ? "10 of 10 allocated."
      : t > 10 ? `${t} allocated — that's ${t - 10} more than you have.` : `${t} of 10 allocated — ${10 - t} left.`;
    totalLine.style.color = t === 10 ? "var(--accent)" : t > 10 ? "var(--coral)" : "var(--text-dim)";

    // Translate the fitness score into a suggested weekly frequency. Someone who
    // can only give training 1 point should not be handed a 5-day split — that
    // plan doesn't fail on week 6, it fails on week 2.
    const suggested = Math.max(2, Math.min(6, 1 + S.defender.fitness));
    // Seeds the MANDATORY count on the next step, which the user can then move.
    // Only while untouched — once they've set it themselves, walking back and
    // forth through this step must not silently overwrite their answer.
    if (!S.scheduleTouched) S.mandatoryDays = suggested;
    bar(`Continue with ${suggested} day${suggested === 1 ? "" : "s"} a week`, next, { disabled: t > 10 });
  }

  body.append(
    el("p.dim", { text: "You have ten points. Spread them across everything competing for you right now — honestly, not aspirationally. This sets a training frequency you'll still be keeping in week six." }),
    rows, totalLine,
  );
  render();
}

// --- 4. equipment ------------------------------------------------------------
// Galpin's step 5 is exercise selection, and it is entirely determined by what
// you can actually load. Without this step every generated plan collapsed to
// bodyweight, because a fresh profile has no places — the plan was technically
// valid and practically useless.
//
// Answers are written back to the PROFILE, not just the wizard: places are a
// property of the person, not of one block, and every later block (plus the
// substitution engine) reads them.

function stepEquipment(body) {
  if (!S.places) {
    const existing = (S.profile && S.profile.places) || [];
    S.places = existing.length
      ? existing.map((p) => ({ ...p, implements: (p.implements || []).slice() }))
      // A fresh install starts from the commercial-gym preset because that is
      // the most common answer AND the most forgiving wrong one: over-stating
      // your kit gets corrected the first time you look for a machine, while
      // under-stating it silently narrows the plan forever.
      : [{ ...blankPlace(S.profile, "Gym"), implements: [...FULL_GYM] }];
  }
  const host = el("div");

  function render() {
    setChildren(host, ...S.places.map((place, idx) =>
      el("div.card", { style: "margin-top:12px" }, [
        el("div.row", { style: "align-items:center;margin-bottom:6px" }, [
          el("div.label", { text: "Place " + (idx + 1) }), el("span.spacer"),
          S.places.length > 1
            ? el("button.btn", { style: "padding:5px 11px", onclick: () => { S.places.splice(idx, 1); render(); } }, "Remove")
            : null,
        ].filter(Boolean)),
        placeEditor(place, S.profile, { onChange: () => {} }),
      ])));
    bar("Continue", () => {
      // Persist to the profile so later blocks and the substitution engine see them.
      S.places = S.places.map((p) => tidyPlace(p, S.profile));
      patchProfile({ places: S.places }).catch(() => {});
      next();
    });
  }

  body.append(
    el("p.dim", { text: "This decides which exercises the plan can pick. Add a second place if you regularly train somewhere else — the app swaps in matched movements when you're there and converts the results back." }),
    host,
    el("button.btn.block", { style: "margin-top:12px", onclick: () => {
      S.places.push(blankPlace(S.profile)); render();
    } }, "+ Add another place"),
  );
  render();
}

// --- 5. schedule -------------------------------------------------------------
function stepSchedule(body) {
  const summary = el("div.note", { style: "margin-top:16px" });

  // Counts, not a weekday grid. "Which days are free" sounds like the useful
  // question and isn't: it changes week to week, and the generator only ever
  // needed HOW MANY sessions to place. Asking for a count and spreading them
  // is both easier to answer and harder to answer wrongly.
  const chips = (value, max, onPick, from = 0) =>
    el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-top:9px" },
      Array.from({ length: max - from + 1 }, (_, i) => i + from).map((n) =>
        el("button.progchip" + (value === n ? ".on" : ""), { onclick: () => onPick(n) }, String(n))));

  function render() {
    const total = S.mandatoryDays + S.optionalDays;
    S.cardioPerWeek = Math.min(S.cardioPerWeek, total);
    const strength = total - S.cardioPerWeek;
    setChildren(summary, ...[
      el("div", { text: `${total} session${total === 1 ? "" : "s"} a week: `
        + `${strength} lifting, ${S.cardioPerWeek} cardio.` }),
      S.optionalDays
        ? el("div", { style: "margin-top:4px", text: `${S.optionalDays} of them marked optional — the week still counts as complete without ${S.optionalDays === 1 ? "it" : "them"}.` })
        : null,
      strength < 2
        ? el("div.note.warn", { style: "margin-top:6px", text: "Under two lifting sessions a week is below the muscle-retention floor." })
        : null,
      S.mobility
        ? el("div", { style: "margin-top:6px", text: "Mobility & stability runs alongside, on its own short schedule." })
        : null,
    ].filter(Boolean));
    body.replaceChildren(...content());
    bar("Build my block", next, { disabled: S.mandatoryDays < 1 });
  }

  const content = () => [
    el("p.dim", { text: "How much training does a normal week hold? Mandatory sessions are the plan; optional ones are there when the week is kind, and their absence never counts as a miss." }),

    el("div.label", { style: "margin-top:16px", text: "Mandatory sessions" }),
    chips(S.mandatoryDays, 6, (n) => { S.mandatoryDays = n; render(); }, 1),

    el("div.label", { style: "margin-top:18px", text: "Optional sessions" }),
    el("p.note", { style: "margin-top:4px", text: "Extra work when time allows. Skipping one doesn't break the week." }),
    chips(S.optionalDays, 3, (n) => { S.optionalDays = n; render(); }),

    el("div.label", { style: "margin-top:18px", text: "Cardio sessions a week" }),
    el("p.note", { style: "margin-top:4px", text: "Taken out of the total above — the rest become lifting days." }),
    chips(S.cardioPerWeek, Math.min(5, S.mandatoryDays + S.optionalDays), (n) => { S.cardioPerWeek = n; render(); }),

    el("div.label", { style: "margin-top:18px", text: "Supersets" }),
    el("p.note", { style: "margin-top:4px", text: "Two exercises alternated with the rest taken after the pair — shorter sessions, and for opposing movements a little more out of each. Needs two things free at once, which a busy gym may not allow." }),
    el("div", { style: "display:flex;gap:8px;margin-top:9px" }, [
      el("button.progchip" + (S.supersets ? ".on" : ""), { onclick: () => { S.supersets = true; render(); } }, "Yes, pair them up"),
      el("button.progchip" + (!S.supersets ? ".on" : ""), { onclick: () => { S.supersets = false; render(); } }, "No, straight sets"),
    ]),
    el("p.note", { style: "margin-top:6px", text: "Anything needing equipment is paired at most two deep, and matched on the same kit where it can be. Bodyweight core work can run as a longer circuit. A place can override this in Profile → Places." }),

    el("div.label", { style: "margin-top:18px", text: "Mobility & stability" }),
    el("p.note", { style: "margin-top:4px", text: "A short supplemental routine — hips, ankles, trunk control — on days it won't compete with training." }),
    el("div", { style: "display:flex;gap:8px;margin-top:9px" }, [
      el("button.progchip" + (S.mobility ? ".on" : ""), { onclick: () => { S.mobility = true; render(); } }, "Yes, add it"),
      el("button.progchip" + (!S.mobility ? ".on" : ""), { onclick: () => { S.mobility = false; render(); } }, "No thanks"),
    ]),

    summary,
  ];

  render();
}

// --- 6. shape ----------------------------------------------------------------
function stepShape(body) {
  const lenRow = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-top:10px" });
  const shapeList = el("div.list", { style: "margin-top:14px" });
  const startRow = el("div", { style: "margin-top:10px" });
  const startNote = el("p.note", { style: "margin-top:8px" });

  // "What usually derails you?" was removed: the answer was appended to the goal
  // text and read by nothing. A question that changes no output is a question
  // that shouldn't be asked.

  function render() {
    lenRow.replaceChildren(...[4, 6, 8, 10, 12].map((n) =>
      el("button.progchip" + (S.lengthWeeks === n ? ".on" : ""), {
        onclick: () => { S.lengthWeeks = n; render(); },
      }, n + " wk")));
    shapeList.replaceChildren(...BLOCK_SHAPES.map((sh) =>
      el("button.item" + (S.blockShapeId === sh.id ? ".on" : ""), {
        style: "text-align:left" + (S.blockShapeId === sh.id ? ";border-color:var(--accent)" : ""),
        onclick: () => { S.blockShapeId = sh.id; render(); },
      }, [
        el("div.meta", {}, [el("div.t", { text: sh.name }), el("div.s", { text: sh.blurb })]),
        S.blockShapeId === sh.id ? el("span.badge.accent", { text: "✓" }) : null,
      ].filter(Boolean))));

    // START DATE. Default is AFTER everything already planned, which is what a
    // new block almost always is — the previous default slotted it in starting
    // tomorrow, quietly overlapping and superseding a block that was still
    // running. Overlap remains available, it just has to be chosen.
    const afterAll = S.afterLastBlock;
    startRow.replaceChildren(
      el("div", { style: "display:flex;flex-wrap:wrap;gap:8px" }, [
        afterAll ? el("button.progchip" + (S.startMode === "after" ? ".on" : ""), {
          onclick: () => { S.startMode = "after"; S.startDate = afterAll; render(); } }, "After my last block") : null,
        el("button.progchip" + (S.startMode === "next" ? ".on" : ""), {
          onclick: () => { S.startMode = "next"; S.startDate = nextMonday(); render(); } }, "Next Monday"),
        el("button.progchip" + (S.startMode === "custom" ? ".on" : ""), {
          onclick: () => { S.startMode = "custom"; render(); } }, "Pick a date"),
      ].filter(Boolean)),
      S.startMode === "custom"
        ? el("input", { type: "date", value: S.startDate, style: FIELD + ";margin-top:10px",
            onchange: (e) => { if (e.target.value) { S.startDate = e.target.value; render(); } } })
        : null,
    );
    startNote.textContent = `Starts ${prettyDate(S.startDate)} and runs ${S.lengthWeeks} weeks.`
      + (afterAll && S.startDate < afterAll ? " That overlaps a block you already have — the app runs whichever block covers each date." : "");

    bar("Generate", () => buildAndReview());
  }

  body.append(
    el("div.label", { text: "Block length" }), lenRow,
    el("div.label", { style: "margin-top:20px", text: "Recovery cadence" }), shapeList,
    el("div.label", { style: "margin-top:20px", text: "When does it start?" }), startRow, startNote,
  );
  render();
}

function prettyDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

async function buildAndReview() {
  // The mobility answer is a PROFILE setting, not part of the block: the routine
  // runs on its own short schedule alongside whatever block is current, and the
  // "What you track" toggle is the same switch. Saying yes here turns it on.
  patchProfile({ features: { mobility: !!S.mobility } }).catch(() => {});
  // The wizard's own answers win: the profile copy may be a step behind, since
  // patchProfile is fire-and-forget.
  const places = S.places && S.places.length ? S.places : ((S.profile && S.profile.places) || []);
  // Blocks already run, oldest→newest. They bias exercise selection away from
  // what the last two blocks used and surface anything the sequence has been
  // quietly skipping — see summariseHistory. Best-effort: a block still
  // generates fine if this read fails.
  let previousBlocks = [];
  try {
    previousBlocks = (await getAllPrograms())
      .filter((p) => p.startDate && p.startDate < S.startDate)
      .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  } catch { /* first block, or storage unavailable */ }

  S.result = generateProgram({
    name: S.name, startDate: S.startDate, lengthWeeks: S.lengthWeeks,
    priorities: S.priorities,
    mandatoryDays: S.mandatoryDays, optionalDays: S.optionalDays, cardioPerWeek: S.cardioPerWeek,
    places,
    blockShapeId: S.blockShapeId,
    goalText: S.goalText,
    supersets: S.supersets,
    previousBlocks,
  });
  // Grade the finished block against the same landmarks the Progress tab uses.
  // Shown, not hidden: the generator can now be wrong in ways the user is better
  // placed to judge than it is (one cardio day is a choice; 27 quad sets is not).
  S.audit = auditBlock(S.result.program, { adaptation: S.priorities.find(isStrength) || "hypertrophy" });
  next();
}

// --- 7. review ---------------------------------------------------------------
function stepReview(body) {
  const r = S.result;
  if (!r) { body.append(el("p.note", { text: "Nothing generated yet." })); return; }
  const p = r.program, sum = r.summary;

  const dayCards = WEEKDAYS.map((d) => {
    const tpl = p.dayTemplates[d];
    if (!tpl || tpl.type === "rest") return null;
    const wk1 = p.weeks[0].days[d];
    const lines = tpl.type === "cardio"
      ? [el("div.s", { text: wk1.prescription })]
      : (wk1.exercises || []).map((e) => el("div.s", {
          text: `${p.exercises[e.exerciseId].name} — ${e.prescribedSets}×${e.repRange}` }));
    return el("div.card.tight", { style: "margin-top:10px" }, [
      el("div.row", { style: "align-items:baseline" }, [
        el("div.label", { text: d }), el("span.spacer"),
        el("span.badge" + (tpl.type === "cardio" ? "" : ".accent"), { text: tpl.label })]),
      el("div", { style: "margin-top:8px" }, lines),
    ]);
  }).filter(Boolean);

  const stat = (label, value) => el("div", {}, [
    el("div.metric.sm", { text: String(value) }),
    el("div.label", { style: "margin-top:5px", text: label }),
  ]);

  body.append(
    el("div.card", {}, [
      el("h3", { style: "margin:0 0 4px", text: p.name }),
      el("div.note", { text: `${p.lengthWeeks} weeks from ${p.startDate} · ${sum.priorities.map((id) => adaptationById(id).short).join(" + ")}` }),
      el("div.statgrid.three", { style: "margin-top:16px" }, [
        stat("Lifting", sum.strengthDays),
        stat("Cardio", sum.cardioDays),
        stat("Exercises", sum.exerciseCount),
      ]),
    ]),
  );

  if (r.warnings.length) {
    body.append(el("div.card", { style: "margin-top:12px;border-color:var(--amber)" }, [
      el("div.label", { style: "color:var(--amber)", text: "Worth knowing" }),
      ...r.warnings.map((w) => el("p.note", { style: "margin-top:8px", text: w })),
    ]));
  }
  if (r.floorGaps.length) {
    body.append(el("div.card", { style: "margin-top:12px" }, [
      el("div.label", { text: "Below the health floor" }),
      el("p.note", { style: "margin-top:4px", text: "Not wrong — just what this block gives up. You can train around it outside the plan." }),
      ...r.floorGaps.map((w) => el("p.note", { style: "margin-top:8px", text: "· " + w })),
    ]));
  }

  // --- what the plan checks say --------------------------------------------
  // The block is graded against the same volume landmarks the Progress tab
  // draws. Shown here rather than kept internal, because the failure this
  // prevents was invisible by construction: every stage of the generator was
  // individually sensible and the finished plan was not, and nobody could see
  // that without adding up the week by hand.
  const audit = S.audit;
  if (audit) {
    const rows = [];
    for (const c of audit.errors) rows.push(["var(--red)", "✕", c.message]);
    for (const c of audit.warnings) rows.push(["var(--amber)", "!", c.message]);
    if (!rows.length) {
      body.append(el("div.card", { style: "margin-top:12px;border-color:rgba(47,230,166,.35)" }, [
        el("div.row", { style: "align-items:center;gap:8px" }, [
          el("span.badge.accent", { text: "✓" }),
          el("div.label", { style: "color:var(--accent)", text: "Plan checks passed" })]),
        el("p.note", { style: "margin-top:8px", text:
          "Weekly volume per muscle sits inside the productive range, rep ranges suit their role, rest matches the loads, and nothing is left untrained." }),
      ]));
    } else {
      body.append(el("div.card", { style: "margin-top:12px" }, [
        el("div.label", { text: "Plan checks" }),
        el("p.note", { style: "margin-top:4px", text: audit.errors.length
          ? "Some of this is worth fixing before you start — go back and change an answer, or build again."
          : "Nothing wrong, but here is what this block trades away." }),
        ...rows.map(([colour, glyph, msg]) => el("div.row", { style: "align-items:flex-start;gap:8px;margin-top:9px" }, [
          el("span", { style: `color:${colour};font-weight:800;line-height:1.5`, text: glyph }),
          el("p.note", { style: "margin:0", text: msg }),
        ])),
      ]));
    }
  }

  // Anything the SEQUENCE of blocks has been skipping, as opposed to this one.
  if (r.history && r.history.neglected && r.history.neglected.length) {
    body.append(el("div.card", { style: "margin-top:12px;border-color:var(--amber)" }, [
      el("div.label", { style: "color:var(--amber)", text: "Across your blocks" }),
      el("p.note", { style: "margin-top:8px", text:
        `${r.history.neglected.join(", ")} ${r.history.neglected.length === 1 ? "has" : "have"} been getting very little across your last ${r.history.blocks} block${r.history.blocks === 1 ? "" : "s"}. `
        + "One block can't cover everything, but a year of them should." }),
    ]));
  }

  body.append(el("div.label", { style: "margin:22px 2px 0", text: "Week 1" }), ...dayCards);
  body.append(el("p.note", { style: "margin-top:18px", text:
    "Loads aren't set here — the app prescribes them from your first sessions and adjusts every week from what you actually lift." }));

  bar("Save and start", async () => {
    await importProgram(p, true);
    S = null;                                  // don't leave stale answers behind
    go("#/");
  }, { secondary: el("button.btn.big.block", { onclick: () => { S.step = 1; draw(); } }, "Change") });
}

// --- small form helpers ------------------------------------------------------
const FIELD = "width:100%;padding:11px 13px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:11px;color:var(--text);font-size:.95rem";
function input(label, placeholder, value) {
  const e = el("input", { type: "text", placeholder, value: value || "", style: FIELD });
  return { el: e, wrap: el("div", { style: "margin-top:16px" }, [el("div.label", { style: "margin-bottom:6px", text: label }), e]) };
}
function textarea(label, placeholder, value) {
  const e = el("textarea", { placeholder, style: FIELD + ";min-height:88px;resize:vertical;font-family:inherit" });
  e.value = value || "";
  return { el: e, wrap: el("div", { style: "margin-top:16px" }, [el("div.label", { style: "margin-bottom:6px", text: label }), e]) };
}
