// views/yoga.js — the Yoga tab: choose a practice, see what was composed, run it.
//
// YOU PICK A PURPOSE AND A LENGTH. The style is derived and NAMED, never asked
// for. See yoga/intents.js for why: the practices people finish are titled by
// intent and duration, and requiring someone to choose between Vinyasa and Hatha
// before they can practise asks them to know the answer to get the question.
// The chosen style is one tap away from being overridden.
//
// ⚠ NO SWAP / LATER / ADD IN HERE. The v167 workout controls let you reorder a
// session mid-flight, which is right for a workout and wrong for a sequence: the
// arc is a dependency graph, so a control that moves a pose can move a
// counter-pose in front of the thing it counters, or strand a peak with its
// preparation behind it. Regenerate replaces the WHOLE sequence, which keeps the
// graph intact. That is the deliberate difference between the two tabs.

import { el, mount, go, addActionBar, backBtn, setChildren } from "../ui.js";
import { getProfile } from "../profile.js";
import { getYogaPrefs, setYogaPrefs, addYogaDone, getYogaLog, yogaOn } from "../store.js";
import { todayISO } from "../model.js";
import { illustration } from "../illustrations.js";
import { INTENTS, intentById } from "../yoga/intents.js";
import { STYLES, styleById, BREATH_SECONDS_DEFAULT, BREATH_SECONDS_RANGE } from "../yoga/styles.js";
import { LIMITATIONS, LIMITATION_KEYS, byId as asanaById } from "../yoga/asanas.js";
import { LEVELS, LEVEL_KEYS, normaliseLevel } from "../yoga/levels.js";
import { generateFlow, toRoutineDef } from "../yoga/generate.js";
import { seedFrom } from "../yoga/compose.js";
import { auditFlow, verdict } from "../yoga/quality.js";
import { entryScript, exitScript, salutationScript } from "../yoga/script.js";
import { runRoutine } from "./routine.js";

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const mins = (s) => `${Math.round(s / 60)} min`;

// The flow currently on the review screen. Held in module scope so Regenerate
// and Start operate on the same object without a round-trip through storage.
let current = null;

function toast(msg) {
  const t = el("div.toast", { text: msg });
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 3600);
}

// --- the picker --------------------------------------------------------------
export async function renderYoga() {
  const profile = await getProfile();
  // Reachable with the feature off — a bookmark, a back button, a shared link.
  // Say so and offer the switch rather than bouncing to a screen that doesn't
  // explain why the thing you asked for vanished.
  if (profile && profile.features && profile.features.yoga === false) {
    mount([el("h1", { text: "Yoga" }), el("div.card", {}, [
      el("h2", { text: "Yoga is switched off" }),
      el("p.note", { text: "You turned this off in Profile → what you track. Turning it back on brings the tab with it." }),
      el("button.btn.primary.block", { style: "margin-top:12px", onclick: async () => {
        const { saveProfile } = await import("../profile.js");
        await saveProfile({ ...profile, features: { ...profile.features, yoga: true } });
        const { applyTabVisibility } = await import("../app.js");
        await applyTabVisibility();
        go("#/yoga");
        renderYoga();
      } }, "Turn yoga back on"),
    ])]);
    return;
  }
  const prefs = await getYogaPrefs();
  const log = await getYogaLog();
  const limits = (profile && profile.limitations) || [];

  const chosen = intentById(prefs.lastIntent) || INTENTS[0];
  let intent = chosen;
  let minutes = prefs.lastMinutes && intent.minutes.includes(prefs.lastMinutes)
    ? prefs.lastMinutes : intent.defaultMinutes;
  let level = normaliseLevel(prefs.level);
  // What today's practice stands in for. `undefined` means "haven't chosen" and
  // falls back to the intent's own default; null means "nothing, it's an extra".
  let replaces = prefs.replaces === undefined ? intent.substitutes : prefs.replaces;
  // What the day actually has to offer as a replacement, so the card can't
  // suggest standing in for a session that isn't scheduled.
  const today = await todaysSessions();

  const body = el("div");

  const paint = () => {
    setChildren(body);

    // --- what for ---
    body.appendChild(el("div.card", {}, [
      el("h2", { text: "What do you want from it?" }),
      el("div.chipgrid", {}, INTENTS.map((i) =>
        el("button.chip" + (i.id === intent.id ? ".on" : ""), {
          onclick: () => {
            intent = i;
            minutes = i.defaultMinutes;
            paint();
          },
        }, [
          el("span.chiptitle", { text: i.label }),
          el("span.chipsub", { text: styleById(i.style).name }),
        ]))),
      el("p.note", { text: intent.blurb }),
    ]));

    // --- how long ---
    if (!intent.fixedLength) {
      body.appendChild(el("div.card", {}, [
        el("h2", { text: "How long?" }),
        el("div.btn-row.wrap", {}, intent.minutes.map((m) =>
          el("button.btn" + (m === minutes ? ".primary" : ""), {
            onclick: () => { minutes = m; paint(); },
          }, `${m} min`))),
      ]));
    } else {
      body.appendChild(el("div.card", {}, [
        el("h2", { text: "How long?" }),
        el("p.note", { text: "The Primary Series is a fixed sequence, so its length is a consequence of the postures and your breath rate rather than something to choose. At your current pace it runs about " + estimateAshtangaMinutes(prefs) + " minutes." }),
      ]));
    }

    // --- how experienced ---
    // Drives which poses are eligible AND how the teacher talks. Remembered as
    // the default, because it is a fact about you rather than a per-session mood.
    body.appendChild(el("div.card", {}, [
      el("h2", { text: "How experienced are you?" }),
      el("div.chipgrid.lim", {}, LEVEL_KEYS.map((k) =>
        el("button.chip" + (k === level ? ".on" : ""), {
          onclick: () => { level = k; setYogaPrefs({ level: k }); paint(); },
        }, [
          el("span.chiptitle", { text: LEVELS[k].label }),
          el("span.chipsub", { text: LEVELS[k].blurb }),
        ]))),
    ]));

    // --- what it counts as, and what it can stand in for ---
    // The accounting follows the CHOICE, not the intent's default — otherwise
    // this card claims "a standalone extra" while the card directly below it
    // says the practice is replacing today's session.
    body.appendChild(replacesCard(intent, replaces, (v) => { replaces = v; paint(); }));
    body.appendChild(accountingCard(replaces));

    // --- what you're protecting ---
    body.appendChild(limitationsCard(profile, limits, paint));

    // --- history ---
    if (log.length) {
      const last = log[log.length - 1];
      body.appendChild(el("div.card", {}, [
        el("h2", { text: "Recent practice" }),
        el("p.note", { text: `${log.length} practice${log.length === 1 ? "" : "s"} logged. Last: ${intentById(last.intent) ? intentById(last.intent).label : last.intent}, ${last.minutes} min on ${last.date}.` }),
      ]));
    }

    addActionBar(el("button.btn.primary.big.block", {
      onclick: () => {
        setYogaPrefs({ lastIntent: intent.id, lastMinutes: minutes, level, replaces });
        go(`#/yoga/build/${intent.id}/${minutes}`);
      },
    }, "Compose a practice"));
  };

  // MOUNT FIRST, THEN PAINT. mount() clears the previous screen's sticky CTA —
  // it has to, or every screen inherits the last one's button — so calling it
  // AFTER paint() destroyed the action bar paint() had just created. The picker
  // therefore had no primary button at all until you happened to tap an intent
  // chip, which re-ran paint() and put it back. That is the bug that made the
  // start button impossible to find, and the tab-bar overlap merely made the
  // button you eventually summoned unreachable as well.
  mount([el("h1", { text: "Yoga" }), body]);
  paint();
}

function estimateAshtangaMinutes(prefs) {
  const bs = prefs.breathSeconds || BREATH_SECONDS_DEFAULT;
  // 65 min at 5 s/breath, scaling with the breath rate.
  return Math.round(65 * (bs / 5));
}

function accountingCard(substitutes) {
  const rows = {
    strength: {
      title: "Stands in for a lifting day",
      note: "A real session — conditioning, positional strength, skill — but not an equivalent one. Yoga is isometric work, and isometric training transfers to isometric strength and not to dynamic strength. It will not maintain a squat or a bench, and the week's Progress will say so.",
    },
    mobility: {
      title: "Stands in for a mobility & stability session",
      note: "Cleanly equivalent: same job, same intensity band, same progression logic.",
    },
    null: {
      title: "A standalone extra",
      note: "Low fatigue cost, complements everything. Counts for adherence, adds nothing to the training load.",
    },
  };
  const r = rows[String(substitutes)] || rows.null;
  return el("div.card", {}, [
    el("h2", { text: r.title }),
    el("p.note", { text: r.note }),
    el("p.note.dim", { text: "No yoga practice, at any length or vigour, substitutes a cardio session. A full session averages about 3.3 METs against 8-9 for a Zone 2 run." }),
  ]);
}

/**
 * What today's practice STANDS IN FOR.
 *
 * The intent carries a default — a strong flow substitutes a lifting day, a
 * wind-down substitutes the mobility work — but the decision belongs to the day,
 * not to the taxonomy. If today's plan has an M&S session and you'd rather do
 * yin, that is a replacement, and Today should say so instead of showing an
 * unticked session and a separate unrelated practice.
 *
 * Only offers what the day actually has. Standing in for a session that was
 * never scheduled is not a thing you can do.
 */
function replacesCard(intent, replaces, onChange) {
  const opts = [
    { v: null, label: "Nothing — it's extra", sub: "On top of whatever else today holds." },
  ];
  if (todaysAvailable.mobility) opts.push({ v: "mobility",
    label: "Today's mobility & stability", sub: "Cleanly equivalent — same job, same intensity band." });
  if (todaysAvailable.strength) opts.push({ v: "strength",
    label: `Today's ${todaysAvailable.strengthLabel || "session"}`,
    sub: "Counts as a session, but adds no hard sets. Progress will show the gap." });
  return el("div.card", {}, [
    el("h2", { text: "Standing in for anything?" }),
    el("div.chipgrid.lim", {}, opts.map((o) =>
      el("button.chip" + (o.v === replaces ? ".on" : ""), { onclick: () => onChange(o.v) }, [
        el("span.chiptitle", { text: o.label }),
        el("span.chipsub", { text: o.sub }),
      ]))),
    opts.length === 1
      ? el("p.note", { text: "Nothing scheduled today for this to replace." })
      : null,
  ]);
}

// Populated by todaysSessions() before the picker paints.
let todaysAvailable = { mobility: false, strength: false, strengthLabel: null };

/** What today's plan actually offers as a replacement target. */
async function todaysSessions() {
  const iso = todayISO();
  const out = { mobility: false, strength: false, strengthLabel: null };
  try {
    const { isMobilityDay } = await import("../mobility.js");
    const { weekdayOf } = await import("../model.js");
    const p = await getProfile();
    if ((!p || p.features.mobility !== false) && isMobilityDay(weekdayOf(iso))) out.mobility = true;
  } catch {}
  try {
    const { getActiveProgram, resolveDay } = await import("../store.js");
    const prog = await getActiveProgram();
    if (prog) {
      const { day, template } = resolveDay(prog, iso) || {};
      if (day && day.type && day.type !== "rest" && day.type !== "cardio") {
        out.strength = true;
        out.strengthLabel = (template && template.label) || "strength session";
      }
    }
  } catch {}
  todaysAvailable = out;
  return out;
}

/**
 * THIS IS A SET-ONCE ANSWER, so it stops taking a screen and a half once it has
 * been given — and it opens as a plain yes/no rather than as seven explanatory
 * chips. Most practices protect nothing; asking those people to read seven
 * paragraphs about knees to say "no" is the wrong default.
 */
function limitationsCard(profile, limits, repaint) {
  // null = not answered yet, true = protecting something, false = nothing.
  let answered = limits.length > 0 ? true : null;
  let open = limits.length > 0;
  const card = el("div.card");

  const chips = () => LIMITATION_KEYS.map((k) =>
    el("button.chip" + (limits.includes(k) ? ".on" : ""), {
      onclick: async () => {
        const next = limits.includes(k) ? limits.filter((x) => x !== k) : [...limits, k];
        limits.length = 0; limits.push(...next);
        const p = await getProfile();
        const { saveProfile } = await import("../profile.js");
        await saveProfile({ ...p, limitations: next });
        open = true;
        paint();
      },
    }, [
      el("span.chiptitle", { text: LIMITATIONS[k].label }),
      el("span.chipsub", { text: LIMITATIONS[k].note }),
    ]));

  const clearAll = async () => {
    limits.length = 0;
    const p = await getProfile();
    const { saveProfile } = await import("../profile.js");
    await saveProfile({ ...p, limitations: [] });
  };

  function paint() {
    // 1. Unanswered: a plain yes/no. The list only exists after a "yes".
    if (answered === null) {
      setChildren(card,
        el("h2", { text: "Anything you're protecting?" }),
        el("p.note", { text: "A knee, a low back, a shoulder. If so, it becomes an input to the sequence rather than something filtered out afterwards." }),
        el("div.btn-row", { style: "margin-top:12px" }, [
          el("button.btn", { onclick: () => { answered = true; open = true; paint(); } }, "Yes"),
          el("button.btn.primary", { onclick: async () => { answered = false; open = false; await clearAll(); paint(); } }, "No"),
        ]));
      return;
    }
    // 2. Answered "no": one quiet line with a way back.
    if (answered === false) {
      setChildren(card,
        el("div.row", {}, [
          el("div", { style: "flex:1;min-width:0" }, [
            el("div.label", { text: "Protecting" }),
            el("div.note", { style: "margin-top:3px", text: "Nothing" }),
          ]),
          el("button.btn", { style: "padding:8px 14px",
            onclick: () => { answered = true; open = true; paint(); } }, "Change"),
        ]));
      return;
    }
    // 3. Answered "yes" and collapsed: the sites, named.
    if (!open) {
      setChildren(card,
        el("div.row", {}, [
          el("div", { style: "flex:1;min-width:0" }, [
            el("div.label", { text: "Protecting" }),
            el("div.note", { style: "margin-top:3px",
              text: limits.length ? limits.map((k) => LIMITATIONS[k].label).join(", ") : "Nothing" }),
          ]),
          el("button.btn", { style: "padding:8px 14px", onclick: () => { open = true; paint(); } }, "Change"),
        ]));
      return;
    }
    setChildren(card,
      el("h2", { text: "Anything you're protecting?" }),
      el("p.note", { text: "Yoga's two documented injury sites are the knee — deep flexion with rotation, which is lotus and full pigeon — and the sacroiliac joint, which is the asymmetric open-hip shapes. Whatever you tick here is an input to the sequence, not a filter afterwards." }),
      el("div.chipgrid.lim", {}, chips()),
      el("button.btn.block", { style: "margin-top:10px", onclick: async () => {
        if (!limits.length) { answered = false; await clearAll(); }
        open = false;
        paint();
      } }, limits.length ? "Done" : "Nothing, actually"),
    );
  }
  paint();
  return card;
}

// --- the review screen -------------------------------------------------------
export async function renderYogaBuild(intentId, minutesStr, seedStr) {
  const intent = intentById(intentId);
  if (!intent) { go("#/yoga"); return; }
  const profile = await getProfile();
  const prefs = await getYogaPrefs();
  const limits = (profile && profile.limitations) || [];
  const minutes = Number(minutesStr) || intent.defaultMinutes;
  const seed = Number(seedStr) || seedFrom(todayISO() + intentId + minutes);

  let flow;
  try {
    flow = generateFlow({
      intent: intentId, minutes, limits,
      level: normaliseLevel(prefs.level),
      breathSeconds: prefs.breathSeconds || BREATH_SECONDS_DEFAULT,
      style: prefs.styleOverride && prefs.styleOverrideFor === intentId ? prefs.styleOverride : null,
      seed,
    });
  } catch (err) {
    mount([backBtn("Yoga", "#/yoga"), el("div.card", {}, [
      el("h2", { text: "Couldn't compose that" }), el("p.note", { text: String(err.message || err) })])]);
    return;
  }
  current = flow;
  const audit = auditFlow(flow);

  const head = el("div.card", {}, [
    el("h2", { text: `${intent.label} · ${flow.styleName}` }),
    el("p.big", { text: mmss(flow.totalSeconds) }),
    el("p.note", { text: `${flow.items.length} poses${flow.peakName ? ` · peak: ${flow.peakName}` : ""} · savasana ${mmss(flow.savasanaSeconds)}` }),
    intent.note ? el("p.note.dim", { text: intent.note }) : null,
  ]);

  // The QC verdict, shown rather than hidden. Errors are red and block; warnings
  // are named and do not — an explicit choice is never overridden.
  const qc = el("div.card" + (audit.errors.length ? ".bad" : ""), {}, [
    el("h2", { text: audit.errors.length ? "This sequence has a problem" : "Sequence check" }),
    ...(audit.errors.length ? audit.errors : audit.warnings).map((c) =>
      el("p.note" + (c.severity === "error" ? ".bad" : ""), { text: c.message })),
    !audit.errors.length && !audit.warnings.length ? el("p.note", { text: verdict(audit) }) : null,
  ]);

  // What the limitations cost, named rather than silently omitted.
  const excluded = (flow.excluded || []).slice(0, 8);
  const exCard = excluded.length ? el("div.card", {}, [
    el("h2", { text: "Left out for you" }),
    el("p.note", { text: excluded.map((e) => e.name).join(", ") + (flow.excluded.length > 8 ? ` and ${flow.excluded.length - 8} more` : "") }),
    el("p.note.dim", { text: "Each one has a substitute in the sequence where the shape mattered." }),
  ]) : null;

  const subCard = (flow.substituted && flow.substituted.length) ? el("div.card", {}, [
    el("h2", { text: "Postures changed for you" }),
    el("p.note", { text: flow.substituted.slice(0, 8).map((s) => `${s.fromName} → ${s.toName}`).join(" · ") }),
    el("p.note.dim", { text: "The order of the series is untouched. Only the postures your limitations rule out have been swapped in place." }),
  ]) : null;

  // THE SEQUENCE IS SUMMARISED, NOT DUMPED.
  //
  // A 45-minute flow is 75 rows and five and a half screens of scrolling, which
  // is not a preview — it is a wall you swipe past to reach the button. What
  // someone actually wants before starting is the SHAPE: how long each part of
  // the arc takes, and what the peak is. The poses are one tap away for anyone
  // who wants to read them, and the tap is remembered.
  const list = el("div.card", {}, [
    el("h2", { text: "The sequence" }),
    ...phaseSummary(flow, prefs.expandSequence),
  ]);

  // mount() BEFORE addActionBar() — mount clears the previous screen's sticky
  // CTA, so building the bar first means building it and then deleting it. See
  // the note in renderYoga().
  mount([backBtn("Yoga", "#/yoga"), head, qc, exCard, subCard, list].filter(Boolean));

  addActionBar(
    el("button.btn.block", {
      onclick: () => go(`#/yoga/build/${intentId}/${minutes}/${(seed + 1013) >>> 0}`),
    }, "Regenerate"),
    el("button.btn.primary.block", {
      disabled: audit.errors.length > 0,
      onclick: () => go(`#/yoga/do/${intentId}/${minutes}/${seed}`),
    }, "Start"),
  );
}

const PHASE_LABEL = {
  centering: "Settle", warmup: "Warm up", build: "Build", peak: "Peak",
  counter: "Counter", cool: "Cool down", savasana: "Savasana",
};

/**
 * The arc as one row per phase — duration, pose count, and the peak named — with
 * a disclosure that swaps in the full pose list. Collapsed is the default because
 * the shape is what you check before starting; the poses are what you read if you
 * are curious, and curiosity is the rarer case.
 */
function phaseSummary(flow, expanded) {
  const order = ["centering", "warmup", "build", "peak", "counter", "cool", "savasana"];
  const rows = [];
  for (const p of order) {
    const items = (flow.items || []).filter((it) => it.phase === p);
    if (!items.length) continue;
    const secs = items.reduce((s, it) => s + (it.durationSeconds + it.transitionSeconds) * (it.bilateral ? 2 : 1), 0);
    // Linked salutation steps are movements inside a round, not poses to count.
    const posesN = items.filter((it) => !it.linked).length;
    const detail = p === "peak" ? items[0].name
      : p === "savasana" ? "Rest"
      : `${posesN} pose${posesN === 1 ? "" : "s"}`;
    rows.push(el("div.phaserow" + (p === "peak" ? ".ispeak" : ""), {}, [
      el("div.phasename", { text: PHASE_LABEL[p] || p }),
      el("div.phasedetail", { text: detail }),
      el("div.phasetime", { text: mmss(secs) }),
    ]));
  }
  const body = el("div", {}, expanded ? phaseSections(flow) : rows);
  const toggle = el("button.btn.block", { style: "margin-top:12px", onclick: async () => {
    await setYogaPrefs({ expandSequence: !expanded });
    body.replaceChildren(...(!expanded ? phaseSections(flow) : rows));
    toggle.textContent = !expanded ? "Hide the poses" : `Show all ${flow.items.filter((i) => !i.linked).length} poses`;
    expanded = !expanded;
  } }, expanded ? "Hide the poses" : `Show all ${flow.items.filter((i) => !i.linked).length} poses`);
  return [body, toggle];
}

function phaseSections(flow) {
  const out = [];
  const order = ["centering", "warmup", "build", "peak", "counter", "cool", "savasana"];
  for (const p of order) {
    const items = (flow.items || []).filter((it) => it.phase === p);
    if (!items.length) continue;
    out.push(el("h3.phasehead", { text: PHASE_LABEL[p] || p }));
    // Collapse a repeated linked salutation round into one line — listing thirty
    // rows of "Plank, Chaturanga, Upward dog" is a wall, not a preview.
    let i = 0;
    while (i < items.length) {
      const it = items[i];
      if (it.round) {
        const same = items.filter((x) => x.salutation === it.salutation);
        const rounds = new Set(same.map((x) => x.round)).size;
        out.push(poseRow({ ...it, name: `Sun salutation ${it.salutation}`, sanskrit: `Surya Namaskara ${it.salutation}` },
          `${rounds} round${rounds === 1 ? "" : "s"}`));
        i += same.length;
        continue;
      }
      out.push(poseRow(it, holdLabel(it, flow)));
      i++;
    }
  }
  return out;
}

function holdLabel(it, flow) {
  if (it.phase === "savasana") return mmss(it.durationSeconds);
  const sides = it.bilateral ? " · both sides" : "";
  if (it.holdBreaths && flow.breathSeconds && !it.dynamic)
    return `${it.holdBreaths} breath${it.holdBreaths === 1 ? "" : "s"}${sides}`;
  return `${it.durationSeconds}s${sides}`;
}

function poseRow(it, right) {
  return el("div.poserow", {}, [
    el("div.posefig", {}, [illustration(it.art || it.asanaId)]),
    el("div.posemeta", {}, [
      el("div.posename", { text: it.name }),
      it.sanskrit ? el("div.posesans", { text: it.sanskrit }) : null,
    ].filter(Boolean)),
    el("div.posehold", { text: right }),
  ]);
}

// --- running it --------------------------------------------------------------
export async function renderYogaSession(intentId, minutesStr, seedStr) {
  const intent = intentById(intentId);
  if (!intent) { go("#/yoga"); return; }
  const profile = await getProfile();
  const prefs = await getYogaPrefs();
  const limits = (profile && profile.limitations) || [];
  const minutes = Number(minutesStr) || intent.defaultMinutes;
  const seed = Number(seedStr) || seedFrom(todayISO() + intentId + minutes);

  const flow = (current && current.intent === intentId && current.seed === seed) ? current
    : generateFlow({
        intent: intentId, minutes, limits,
        level: normaliseLevel(prefs.level),
        breathSeconds: prefs.breathSeconds || BREATH_SECONDS_DEFAULT,
        seed,
      });

  // `.yogaplayer` scopes the tighter sizing that keeps the practice screen on one
  // screen — see the note in styles.css.
  const stage = el("div.yogaplayer");
  mount([stage]);
  // THE TEACHER. Entry narration on arriving in a pose, the "one more breath"
  // call as the last breath begins. The player owns the timing; the script layer
  // owns the words; neither knows about the other's internals.
  const levelId = normaliseLevel(prefs.level);
  const scriptFor = (step, i) => {
    const it = step.item;
    if (!it || !it.id) return null;
    if (it.salutation && it.moves) {
      return salutationScript(it.salutation, it.round || 1, it.rounds || 1, levelId).parts;
    }
    return entryScript({
      asanaId: it.id, side: step.side, holdBreaths: it.holdBreaths,
      durationSeconds: it.durationSeconds, dynamic: it.dynamic,
    }, levelId, i).parts;
  };

  runRoutine(stage, toRoutineDef(flow), null, {
    title: intent.label,
    narrate: {
      level: levelId,
      entryFor: scriptFor,
      exitFor: (step, i) => exitScript({ asanaId: step.item && step.item.id }, levelId, i).parts,
    },
    onComplete: async ({ completed }) => {
      if (completed) {
        // WHAT IT REPLACED IS THE PRACTITIONER'S CHOICE, not the intent's
        // default. The intent has an opinion — a strong flow suits a lifting
        // day — but the day is the thing that knows, and it was chosen on the
        // picker before starting.
        const sub = prefs.replaces === undefined ? flow.accounting.substitutes : prefs.replaces;
        await addYogaDone(todayISO(), {
          intent: flow.intent,
          style: flow.style,
          level: flow.level,
          minutes: Math.round(flow.totalSeconds / 60),
          seconds: flow.totalSeconds,
          peak: flow.peak,
          peakName: flow.peakName,
          substitutes: sub,
          poses: flow.items.filter((i) => !i.linked).length,
          breathSeconds: flow.breathSeconds,
        });
        toast(sub === "strength"
          ? "Logged, and today's session marked replaced. The week's hard sets are unchanged."
          : sub === "mobility" ? "Logged — that's today's mobility & stability done."
          : "Logged.");
      }
      go("#/yoga");
    },
  });
}
