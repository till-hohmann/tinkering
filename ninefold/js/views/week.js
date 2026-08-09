// week.js — the Plan tab. Browse the whole program week-by-week (‹ ›), switch
// between programs (chips), and open any day for a read-only detail. Past days
// open their summary; future days are previewable.

import { getActiveProgram, getAllPrograms, getProgram, resolveDay, getSessionsForProgram,
  mobilityDoneDates } from "../store.js";
import { todayISO, weekNumberFor, WEEKDAYS } from "../model.js";
import { el, mount, go, locationBadge } from "../ui.js";
import { workoutFigure, illustration } from "../illustrations.js";
import { ringStat } from "../components/charts.js";
import { planToggle } from "./calendar.js";
import { runKindLabel } from "../cardio-intel.js";
import { sessionFor as mobSessionFor, isMobilityDay } from "../mobility.js";

function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const pad = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
const hasContent = (s) => (s && ((s.strengthResult && s.strengthResult.length) || s.cardioResult));
function prettyDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
const WEEKDAY_FULL = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
  Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

// The zero-program state. Deliberately not an error: an app that ships empty
// starts here, and "you have no plan" is a thing to fix, not a failure.
function emptyPlan() {
  return el("div", {}, [
    el("h1", { text: "Plan" }),
    el("div.card", { style: "margin-top:16px" }, [
      el("h3", { style: "margin:0 0 6px", text: "No training block yet" }),
      el("p.note", { style: "margin-top:0", text:
        "Build one and the app takes over from there: it prescribes each session, adjusts the loads from what you actually lift, and swaps exercises when you're training somewhere without the kit." }),
      el("button.btn.primary.block", { style: "margin-top:16px", onclick: () => go("#/build") }, "Build a block"),
      el("p.note", { style: "margin-top:14px;font-size:.75rem", text:
        "Already have a plan as JSON? Profile → Import / restore." }),
    ]),
  ]);
}

export async function renderWeek(pid, n) {
  const active = await getActiveProgram();
  // all blocks in chronological order (Block 1 → 2 → 3 …) — drives the block
  // selector AND the continuous week flip that carries across block boundaries.
  const programs = (await getAllPrograms()).slice().sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const program = (pid && (await getProgram(pid))) || active;
  // No program at all: the normal state on a fresh install, and previously a
  // crash (`program.id` on null). This is also the main way back into the
  // builder once you've dismissed the first-run redirect.
  if (!program) return mount([emptyPlan()]);
  const isActive = active && program.id === active.id;
  const today = todayISO();
  const curWeek = isActive ? weekNumberFor(program, today) : 1;
  let weekNumber = Math.min(Math.max(Number(n) || curWeek, 1), program.lengthWeeks);
  const week = (program.weeks || []).find((w) => w.weekNumber === weekNumber) || (program.weeks || [])[0] || {};
  const sessions = await getSessionsForProgram(program.id);

  const children = [planToggle("weeks")];

  // --- block selector: a compact dropdown (the chip row crowded the top). Opening
  //     the Plan tab (#/week, no pid) always resolves to the active block, so it
  //     auto-follows into a new block by date; the dropdown is just manual browse. ---
  if (programs.length > 1) {
    const sel = el("select.progselect", { "aria-label": "Training block",
      onchange: (e) => { const p = programs.find((x) => x.id === e.target.value);
        const target = p && p.id === active.id ? weekNumberFor(p, today) : 1;
        go(`#/week/${e.target.value}/${target}`); } },
      programs.map((p) => el("option", { value: p.id, selected: p.id === program.id ? true : null },
        p.name + (p.id === active.id ? " · current" : p.draft ? " · draft" : ""))));
    children.push(el("div.selectwrap", {}, [sel]));
  } else {
    children.push(el("div.label", { text: program.name }));
  }

  // Building is not a one-off. The Plan tab is where you come to look at the
  // block, so it is also where you ask for the next one — this used to exist
  // only in the zero-program empty state, which made the builder unreachable
  // the moment you had a plan.
  children.push(el("button.btn.block", { style: "margin-top:10px", onclick: () => go("#/build") },
    "+ Build a new block"));

  // --- week stepper (flips CONTINUOUSLY across blocks: last week of one block →
  //     week 1 of the next, and back) ---
  const pi = programs.findIndex((p) => p.id === program.id);
  const prevProg = pi > 0 ? programs[pi - 1] : null;
  const nextProg = pi >= 0 && pi < programs.length - 1 ? programs[pi + 1] : null;
  const prevHref = weekNumber > 1 ? `#/week/${program.id}/${weekNumber - 1}`
    : prevProg ? `#/week/${prevProg.id}/${prevProg.lengthWeeks}` : null;
  const nextHref = weekNumber < program.lengthWeeks ? `#/week/${program.id}/${weekNumber + 1}`
    : nextProg ? `#/week/${nextProg.id}/1` : null;
  children.push(el("div.stepper", {}, [
    el("button.sbtn", { disabled: prevHref ? null : true,
      onclick: prevHref ? () => go(prevHref) : null, "aria-label": "Previous week" }, "‹"),
    el("div.smid", {}, [
      el("h1", { style: "margin:0", text: `Week ${weekNumber}` }),
      el("div.dim", { style: "font-size:.9rem", text: `${week.phaseName || program.name} · of ${program.lengthWeeks}` }),
    ]),
    el("button.sbtn", { disabled: nextHref ? null : true,
      onclick: nextHref ? () => go(nextHref) : null, "aria-label": "Next week" }, "›"),
  ]));

  // --- draft "shell" block: no daily plan yet (designed at the handoff) ---
  if (program.draft) {
    children.push(el("div.card", { style: "margin-top:6px" }, [
      el("div.row.wrap", { style: "gap:8px;margin-bottom:8px" }, [
        el("span.badge.accent", { text: week.phaseName || "Upcoming" }),
        el("span.badge", { text: `Starts ${prettyDate(program.startDate)}` }),
      ]),
      el("h2", { style: "margin:2px 0 6px", text: "To be programmed" }),
      program.phaseBrief ? el("p", { style: "margin:0;font-size:.92rem;line-height:1.5", text: program.phaseBrief }) : null,
      program.designNote ? el("p.note", { style: "margin:10px 0 0", text: program.designNote }) : null,
    ]));
    return mount(children);
  }

  // --- completion + scheme ---
  let planned = 0, completed = 0;
  const mobDone = await mobilityDoneDates();
  const rows = WEEKDAYS.flatMap((wd, i) => {
    const dayIso = addDays(week.startDate, i);
    const { day, template } = resolveDay(program, dayIso);
    const isToday = isActive && dayIso === today;
    const doneSession = sessions.find((s) => s.date === dayIso && s.weekday === wd);
    const isDone = hasContent(doneSession) || !!doneSession;
    const type = day ? day.type : "rest";
    const label = type === "cardio" ? `Cardio (${runKindLabel(day.prescription || "")})`
      : template ? template.label : "Rest";
    const opt = template && template.optional;
    if (type !== "rest") { planned++; if (isDone) completed++; }

    const tile = el("div.ico.illotile", { style: "padding:0" }, [illustration(workoutFigure(template, day))]);
    const meta = el("div.meta", {}, [
      el("div.t", {}, [WEEKDAY_FULL[wd], opt ? el("span.faint", { text: " · optional" }) : null]),
      el("div.s", { text: label }),
    ]);
    const right = isDone ? el("span.badge.accent", { text: "✓ Done" })
      : isToday ? el("span.badge.accent", { text: "Today" })
      : type !== "rest" ? locationBadge(template.location)
      : el("span.badge", { text: "Rest" });

    const dayRow = type === "rest"
      ? el("div.item", { style: "opacity:.7" }, [tile, meta, right])
      : el("button.item", {
          style: "text-align:left" + (isToday ? ";border-color:var(--accent)" : ""),
          onclick: () => go(doneSession ? `#/summary/${doneSession.id}` : `#/day/${program.id}/${weekNumber}/${wd}`),
        }, [tile, meta, right]);

    // supplemental mobility & stability session on its scheduled days — tappable
    // any day (past, today or ahead), so it can be run late or previewed early.
    if (!isMobilityDay(wd)) return [dayRow];
    const ms = mobSessionFor(wd);
    const msDone = mobDone.has(dayIso);
    const msTile = el("div.ico.illotile", { style: "padding:0;overflow:hidden" }, [illustration(ms.items[0].id)]);
    const msRow = el("button.item.mobrow", {
      style: "text-align:left",
      onclick: () => go(msDone ? `#/msummary/${dayIso}` : `#/mobility/${wd}`),
    }, [
      msTile,
      el("div.meta", {}, [
        el("div.t", {}, [`${WEEKDAY_FULL[wd]} M&S`]),
        el("div.s", { text: `${ms.title} — ${ms.focus} · ~10 min` }),
      ]),
      msDone ? el("span.badge.accent", { text: "✓ Done" }) : locationBadge(ms.location),
    ]);
    return [dayRow, msRow];
  });

  const ring = ringStat({ pct: planned ? completed / planned : 0, value: `${completed}/${planned}`,
    sub: "done", size: 92, stroke: 9, color: "accent" });
  children.push(el("div.card", {}, [
    el("div.row", { style: "gap:18px" }, [
      ring,
      el("div", { style: "flex:1" }, [
        el("div.label", { text: isActive && weekNumber === curWeek ? "This week" : "Week plan" }),
        el("p", { style: "margin:7px 0 0;font-size:.92rem;line-height:1.45", text: week.scheme }),
      ]),
    ]),
  ]));

  children.push(el("div.list", { style: "margin-top:6px" }, rows));
  if (isActive)
    children.push(el("button.btn.block", { style: "margin-top:14px", onclick: () => go(`#/weeksummary/${weekNumber}`) },
      `Week ${weekNumber} summary →`));

  mount(children);
}
