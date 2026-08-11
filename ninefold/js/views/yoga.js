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

import { el, mount, go, addActionBar, backBtn } from "../ui.js";
import { getProfile } from "../profile.js";
import { getYogaPrefs, setYogaPrefs, addYogaDone, getYogaLog, yogaOn } from "../store.js";
import { todayISO } from "../model.js";
import { illustration } from "../illustrations.js";
import { INTENTS, intentById } from "../yoga/intents.js";
import { STYLES, styleById, BREATH_SECONDS_DEFAULT, BREATH_SECONDS_RANGE } from "../yoga/styles.js";
import { LIMITATIONS, LIMITATION_KEYS, byId as asanaById } from "../yoga/asanas.js";
import { generateFlow, toRoutineDef } from "../yoga/generate.js";
import { seedFrom } from "../yoga/compose.js";
import { auditFlow, verdict } from "../yoga/quality.js";
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

  const body = el("div");

  const paint = () => {
    body.replaceChildren();

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

    // --- what it will and won't count as ---
    body.appendChild(accountingCard(intent));

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
        setYogaPrefs({ lastIntent: intent.id, lastMinutes: minutes });
        go(`#/yoga/build/${intent.id}/${minutes}`);
      },
    }, "Compose a practice"));
  };

  paint();
  mount([el("h1", { text: "Yoga" }), body]);
}

function estimateAshtangaMinutes(prefs) {
  const bs = prefs.breathSeconds || BREATH_SECONDS_DEFAULT;
  // 65 min at 5 s/breath, scaling with the breath rate.
  return Math.round(65 * (bs / 5));
}

function accountingCard(intent) {
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
  const r = rows[String(intent.substitutes)] || rows.null;
  return el("div.card", {}, [
    el("h2", { text: r.title }),
    el("p.note", { text: r.note }),
    el("p.note.dim", { text: "No yoga practice, at any length or vigour, substitutes a cardio session. A full session averages about 3.3 METs against 8-9 for a Zone 2 run." }),
  ]);
}

function limitationsCard(profile, limits, repaint) {
  const chips = LIMITATION_KEYS.map((k) =>
    el("button.chip" + (limits.includes(k) ? ".on" : ""), {
      onclick: async () => {
        const next = limits.includes(k) ? limits.filter((x) => x !== k) : [...limits, k];
        limits.length = 0; limits.push(...next);
        const p = await getProfile();
        const { saveProfile } = await import("../profile.js");
        await saveProfile({ ...p, limitations: next });
        repaint();
      },
    }, [
      el("span.chiptitle", { text: LIMITATIONS[k].label }),
      el("span.chipsub", { text: LIMITATIONS[k].note }),
    ]));
  return el("div.card", {}, [
    el("h2", { text: "Anything you're protecting?" }),
    el("p.note", { text: "Yoga's two documented injury sites are the knee — deep flexion with rotation, which is lotus and full pigeon — and the sacroiliac joint, which is the asymmetric open-hip shapes. Whatever you tick here is an input to the sequence, not a filter afterwards." }),
    el("div.chipgrid.lim", {}, chips),
  ]);
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
      level: prefs.level || 2,
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

  const list = el("div.card", {}, [
    el("h2", { text: "The sequence" }),
    ...phaseSections(flow),
  ]);

  addActionBar(
    el("button.btn.block", {
      onclick: () => go(`#/yoga/build/${intentId}/${minutes}/${(seed + 1013) >>> 0}`),
    }, "Regenerate"),
    el("button.btn.primary.block", {
      disabled: audit.errors.length > 0,
      onclick: () => go(`#/yoga/do/${intentId}/${minutes}/${seed}`),
    }, "Start"),
  );

  mount([backBtn("Yoga", "#/yoga"), head, qc, exCard, subCard, list].filter(Boolean));
}

const PHASE_LABEL = {
  centering: "Settle", warmup: "Warm up", build: "Build", peak: "Peak",
  counter: "Counter", cool: "Cool down", savasana: "Savasana",
};

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
        level: prefs.level || 2,
        breathSeconds: prefs.breathSeconds || BREATH_SECONDS_DEFAULT,
        seed,
      });

  const stage = el("div");
  mount([stage]);
  runRoutine(stage, toRoutineDef(flow), null, {
    title: intent.label,
    onComplete: async ({ completed }) => {
      if (completed) {
        await addYogaDone(todayISO(), {
          intent: flow.intent,
          style: flow.style,
          minutes: Math.round(flow.totalSeconds / 60),
          seconds: flow.totalSeconds,
          peak: flow.peak,
          substitutes: flow.accounting.substitutes,
          poses: flow.items.length,
        });
        const sub = flow.accounting.substitutes;
        toast(sub === "strength"
          ? "Logged. Counts as a session — the week's hard sets are unchanged."
          : sub === "mobility" ? "Logged as your mobility & stability work."
          : "Logged.");
      }
      go("#/yoga");
    },
  });
}
