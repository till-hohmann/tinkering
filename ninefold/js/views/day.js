// day.js — read-only detail for one planned day (any week, any program). Shows
// exactly what the workout entails. Actions adapt to the date: start today,
// back-fill a past day, view a finished one, or just preview a future one.

import { getActiveProgram, getProgram, resolveDay, getSessionsForProgram } from "../store.js";
import { todayISO, WEEKDAYS, finisherRoundsFor, isReducedPhase } from "../model.js";
import { el, mount, go, locationBadge, backBtn, addActionBar } from "../ui.js";
import { illustration, workoutFigure } from "../illustrations.js";
import { icon } from "../icons.js";
import { runKindLabel } from "../cardio-intel.js";

function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const pad = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
const hasContent = (s) => (s && ((s.strengthResult && s.strengthResult.length) || s.cardioResult));

function prettyDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export async function renderDay(pid, n, wd) {
  const active = await getActiveProgram();
  const program = (pid && (await getProgram(pid))) || active;
  const isActive = program.id === active.id;
  const week = (program.weeks || []).find((w) => w.weekNumber === n);
  if (!week || !program.dayTemplates) return mount([backBtn("Plan", "#/week"), el("div.card", {}, [el("p", { text: "Day not found." })])]);

  const day = week.days[wd];
  const template = program.dayTemplates[wd];
  const i = WEEKDAYS.indexOf(wd);
  const dayIso = addDays(week.startDate, i);
  const today = todayISO();
  const sessions = await getSessionsForProgram(program.id);
  const done = sessions.find((s) => s.date === dayIso && s.weekday === wd && hasContent(s));
  const type = day ? day.type : "rest";
  const exName = (id) => (program.exercises[id] || {}).name || id;

  const tileCls = type === "cardio" ? ".cardio" : type === "rest" ? ".rest" : ".strength";
  const children = [
    backBtn(`Week ${n}`, `#/week/${program.id}/${n}`),
    el("div.row", { style: "gap:13px;margin-top:4px" }, [
      el("div.illotile", { style: "width:52px;height:52px;flex:none;padding:0" }, [illustration(workoutFigure(template, day))]),
      el("div", { style: "flex:1;min-width:0" }, [
        el("div.label", { text: prettyDate(dayIso) }),
        el("h1", { style: "margin:4px 0 0", text: type === "cardio" ? `Cardio (${runKindLabel(day.prescription || "")})` : template ? template.label : "Rest day" }),
      ]),
    ]),
    el("div.row.wrap", { style: "margin-top:10px" }, [
      template ? locationBadge(template.location) : null,
      el("span.badge.accent", { text: `Week ${n} · ${week.phaseName}` }),
      done ? el("span.badge", { text: "✓ Completed" }) : null,
    ]),
  ];

  if (type === "rest") {
    children.push(el("div.card.rest", { style: "margin-top:14px" }, [
      icon("rest", "line"),
      el("h2", { style: "margin-top:8px", text: "Rest day" }),
      el("p.dim", { style: "margin:0", text: "Recovery is part of the plan. Walk, stretch, sleep." }),
    ]));
    return mount(children);
  }

  // Week-level text, said as such — its facts describe the week, not this day.
  if (type === "strength" && week.focus) children.push(el("p.note", { style: "margin:14px 2px 2px", text: `This week: ${week.focus}` }));

  if (type === "strength") {
    children.push(el("h2", { text: "Exercises" }));
    children.push(el("div.list", {}, (day.exercises || []).map((e) =>
      el("div.item.tappable", {
        style: "align-items:flex-start",
        role: "button",
        "aria-label": `${exName(e.exerciseId)} — muscles worked`,
        onclick: () => go(`#/exercise/${e.exerciseId}`),
      }, [
        el("div.ico", {}, [illustration(e.exerciseId)]),
        el("div.meta", {}, [
          el("div.t", { text: exName(e.exerciseId) }),
          el("div.s", { text: `${e.prescribedSets} × ${e.repRange}${e.restSeconds ? ` · rest ${e.restSeconds}s` : ""}` }),
          (program.exercises[e.exerciseId] || {}).cue ? el("div.faint", { style: "font-size:.8rem;margin-top:2px", text: program.exercises[e.exerciseId].cue }) : null,
        ]),
        e.role === "compound" ? el("span.badge.accent", { text: "compound" })
          : e.role === "core" ? el("span.badge", { text: "core" }) : null,
      ]))));
    if (template && template.finisher) {
      children.push(el("div.card.tight", { style: "margin-top:10px;border-left:3px solid var(--cyan)" }, [
        el("div.row", { style: "gap:10px" }, [
          el("div.ico", { style: "width:40px;height:40px;flex:none" }, [illustration("bike")]),
          el("div", { style: "flex:1;min-width:0" }, [
            el("div.label", { text: "Finisher" }),
            el("p.note", { style: "margin:5px 0 0", text: template.finisher }),
            // The round count for THIS week, from the template's own numbers —
            // the same formula the session player runs.
            (() => {
              const r = isReducedPhase(week.phaseName) ? null : finisherRoundsFor(template, n);
              const f = template.finisherIntervals;
              return r && f ? el("p.note", { style: "margin:5px 0 0;color:var(--cyan)",
                text: `This week: ${r} × ${f.workSec} s / ${f.easySec} s` }) : null;
            })(),
          ]),
        ]),
      ]));
    }
  } else {
    children.push(el("div.card", { style: "margin-top:14px" }, [
      el("div.label", { text: "Prescription" }),
      el("p", { style: "margin:10px 0 0", text: day.prescription || "Cardio session" }),
    ]));
  }

  // Any programmed day can be started (past, future, or another block). Today's
  // own scheduled day starts normally; every other day is "do it now" and logs
  // under today (Till's choice) while still feeding that day's progression chain.
  const isToday = isActive && dayIso === today;
  if (!done && !isToday) children.push(el("p.note.center", { style: "margin-top:18px", text: "You can do this workout now — it's logged under today." }));

  mount(children);

  if (done) {
    addActionBar(el("button.btn.primary.block", { onclick: () => go(`#/summary/${done.id}`) }, "View summary"));
  } else if (isToday) {
    addActionBar(el("button.btn.primary.big.block", { onclick: () => go(`#/session/${dayIso}`) }, type === "cardio" ? "Start run" : "Start session"));
  } else {
    addActionBar(el("button.btn.primary.big.block", { onclick: () => go(`#/do/${program.id}/${n}/${wd}`) }, type === "cardio" ? "Do this run now" : "Do this workout now"));
  }
}
