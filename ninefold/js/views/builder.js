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

import { el, mount, go, backBtn, addActionBar, clear } from "../ui.js";
import { ADAPTATIONS, byId as adaptationById, analysePriorities, compatibility,
  BLOCK_SHAPES, isCardio } from "../builder/adaptations.js";
import { generateProgram } from "../builder/generate.js";
import { getProfile, patchProfile } from "../profile.js";
import { defaultEquipmentFor, weightValue, weightToKg, weightLabel } from "../units.js";
import { importProgram } from "../store.js";
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
    availableDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    daysPerWeek: 3,
    chaos: "",
    places: null,
    startDate: nextMonday(),
    profile,
    result: null,
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
  draw();
}

const STEPS = [
  { key: "goal", title: "What are you training for?" },
  { key: "priorities", title: "Which adaptations?" },
  { key: "defender", title: "What does life actually allow?" },
  { key: "equipment", title: "What do you train with?" },
  { key: "schedule", title: "When can you train?" },
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
    "Specific and measurable beats vague. \"Squat 100 kg for 5\" or \"run 10 km without walking\" — not \"get fitter\".", S.goalText);
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
    list.replaceChildren(...ADAPTATIONS.map((a) => {
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
    if (S.priorities.length >= 2 && !analysis.conflicting.length && !analysis.tooMany) {
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
    S.daysPerWeek = suggested;
    bar(`Continue with ${suggested} days a week`, next, { disabled: t > 10 });
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
const IMPLEMENT_OPTIONS = [
  ["barbell", "Barbell & plates", "Squat rack, bench, olympic bar"],
  ["dumbbell_pair", "Dumbbells", "Fixed rack or adjustables"],
  ["cable", "Cable machine", "Pulldowns, pushdowns, face pulls"],
  ["ez_bar", "EZ bar", "Curls and extensions"],
  ["machine", "Machines", "Leg press, chest press, rows, leg curl/extension"],
];

function stepEquipment(body) {
  if (!S.places) {
    const existing = (S.profile && S.profile.places) || [];
    // Defaults follow the user's UNITS: an imperial gym is a 45 lb bar with
    // 45/25/10/5 plates, not metric numbers relabelled. Stored in kg like
    // everything else, so the engines never learn about units.
    const kit = defaultEquipmentFor(S.profile);
    S.places = existing.length
      ? existing.map((p) => ({ ...p, implements: (p.implements || []).slice() }))
      : [{ name: "Gym", implements: ["barbell", "dumbbell_pair", "cable", "ez_bar"],
           barWeightKg: kit.barWeightKg, ezBarWeightKg: kit.ezBarWeightKg,
           barbellPlatesKg: kit.barbellPlatesKg, ezBarPlatesKg: kit.ezBarPlatesKg,
           cable: kit.cable, dumbbells: { ...kit.dumbbells } }];
  }
  const host = el("div");

  function render() {
    host.replaceChildren(...S.places.map((place, idx) => {
      const nameEl = el("input", { type: "text", value: place.name, placeholder: "Gym, Home, Hotel…",
        style: FIELD, oninput: (e) => { place.name = e.target.value; } });
      const toggles = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-top:10px" },
        IMPLEMENT_OPTIONS.map(([id, label]) => {
          const on = place.implements.includes(id);
          return el("button.progchip" + (on ? ".on" : ""), {
            onclick: () => {
              place.implements = on ? place.implements.filter((x) => x !== id) : [...place.implements, id];
              // dumbbell_single rides along with the pair — one bell from a pair
              // rack is always available, and several lifts need exactly that.
              place.implements = place.implements.filter((x) => x !== "dumbbell_single");
              if (place.implements.includes("dumbbell_pair")) place.implements.push("dumbbell_single");
              render();
            },
          }, label);
        }));
      const heaviest = place.implements.includes("dumbbell_pair")
        ? el("div.row", { style: "margin-top:12px;align-items:center;gap:8px" }, [
            el("div", { style: "flex:1" }, [
              el("div", { text: "Heaviest dumbbell" }),
              el("div.faint", { style: "font-size:.76rem", text: "per hand — stops the app prescribing a weight you don't own" })]),
            el("input", { type: "text", inputmode: "decimal",
              value: String(weightValue((place.dumbbells && place.dumbbells.maxKg) || defaultEquipmentFor(S.profile).dumbbells.maxKg, S.profile)),
              style: "width:78px;text-align:center;padding:8px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:10px;color:var(--text)",
              oninput: (e) => {
                const kg = weightToKg(e.target.value, S.profile);
                const base = defaultEquipmentFor(S.profile).dumbbells;
                place.dumbbells = { minKg: base.minKg, stepKg: base.stepKg, maxKg: kg && kg > 0 ? kg : base.maxKg };
              } }),
            el("span.dim", { text: weightLabel(S.profile) }),
          ])
        : null;
      return el("div.card", { style: "margin-top:12px" }, [
        el("div.row", { style: "align-items:center" }, [
          el("div.label", { text: "Place " + (idx + 1) }), el("span.spacer"),
          S.places.length > 1
            ? el("button.btn", { style: "padding:5px 11px", onclick: () => { S.places.splice(idx, 1); render(); } }, "Remove")
            : null,
        ].filter(Boolean)),
        el("div", { style: "margin-top:8px" }, [nameEl]),
        toggles,
        heaviest,
        place.implements.filter((x) => x !== "dumbbell_single" && x !== "bodyweight").length
          ? null
          : el("p.note", { style: "margin-top:10px", text: "Bodyweight only — the plan will use holds and bodyweight movements here." }),
      ].filter(Boolean));
    }));
    bar("Continue", () => {
      // Persist to the profile so later blocks and the substitution engine see them.
      const kit2 = defaultEquipmentFor(S.profile);
      S.places = S.places.map((p) => ({
        barWeightKg: kit2.barWeightKg, ezBarWeightKg: kit2.ezBarWeightKg,
        barbellPlatesKg: kit2.barbellPlatesKg, ezBarPlatesKg: kit2.ezBarPlatesKg,
        cable: kit2.cable,
        ...p,
        name: (p.name || "").trim() || "Gym",
        implements: [...new Set([...p.implements, "bodyweight"])] }));
      patchProfile({ places: S.places }).catch(() => {});
      next();
    });
  }

  body.append(
    el("p.dim", { text: "This decides which exercises the plan can pick. Add a second place if you regularly train somewhere else — the app swaps in matched movements when you're there and converts the results back." }),
    host,
    el("button.btn.block", { style: "margin-top:12px", onclick: () => {
      S.places.push({ name: "", implements: ["bodyweight"] }); render();
    } }, "+ Add another place"),
  );
  render();
}

// --- 5. schedule -------------------------------------------------------------
function stepSchedule(body) {
  const dayRow = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-top:12px" });
  const countLine = el("div.note", { style: "margin-top:14px" });
  const freq = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-top:8px" });

  function render() {
    dayRow.replaceChildren(...WEEKDAYS.map((d) => {
      const on = S.availableDays.includes(d);
      return el("button.progchip" + (on ? ".on" : ""), {
        onclick: () => {
          S.availableDays = on ? S.availableDays.filter((x) => x !== d) : [...S.availableDays, d];
          render();
        },
      }, d);
    }));
    const max = S.availableDays.length;
    S.daysPerWeek = Math.min(S.daysPerWeek, Math.max(1, max));
    freq.replaceChildren(...Array.from({ length: Math.max(1, Math.min(6, max)) }, (_, i) => i + 1).map((n) =>
      el("button.progchip" + (S.daysPerWeek === n ? ".on" : ""), {
        onclick: () => { S.daysPerWeek = n; render(); },
      }, String(n))));
    countLine.textContent = max
      ? `${S.daysPerWeek} session${S.daysPerWeek > 1 ? "s" : ""} a week across ${max} available day${max > 1 ? "s" : ""}.`
      : "Pick at least one day you can train.";
    bar("Build my block", next, { disabled: !max });
  }

  body.append(
    el("p.dim", { text: "Which days are realistically free? The plan spreads your sessions across them so hard days don't stack." }),
    el("div.label", { style: "margin-top:6px", text: "Days available" }), dayRow,
    el("div.label", { style: "margin-top:18px", text: "Sessions per week" }), freq,
    countLine,
  );
  render();
}

// --- 6. shape ----------------------------------------------------------------
function stepShape(body) {
  const lenRow = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-top:10px" });
  const shapeList = el("div.list", { style: "margin-top:14px" });
  const chaosIn = textarea("What usually derails you?",
    "Travel weeks, deadlines, kids' holidays. Naming it now means the plan has an answer ready.", S.chaos);

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
    bar("Generate", () => { S.chaos = chaosIn.el.value.trim(); buildAndReview(); });
  }

  body.append(
    el("div.label", { text: "Block length" }), lenRow,
    el("div.label", { style: "margin-top:20px", text: "Recovery cadence" }), shapeList,
    el("div", { style: "margin-top:20px" }, [chaosIn.wrap]),
  );
  render();
}

function buildAndReview() {
  // The wizard's own answers win: the profile copy may be a step behind, since
  // patchProfile is fire-and-forget.
  const places = S.places && S.places.length ? S.places : ((S.profile && S.profile.places) || []);
  S.result = generateProgram({
    name: S.name, startDate: S.startDate, lengthWeeks: S.lengthWeeks,
    priorities: S.priorities, daysPerWeek: S.daysPerWeek,
    availableDays: S.availableDays, places,
    blockShapeId: S.blockShapeId,
    goalText: [S.goalText, S.chaos ? `When it goes sideways: ${S.chaos}` : ""].filter(Boolean).join("\n\n"),
  });
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
