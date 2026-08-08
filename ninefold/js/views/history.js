// history.js — all completed sessions, grouped by calendar week (Mon-first),
// newest week first. Each week gets a summary line (sessions · volume · km) and
// each session row carries its own poster figure (first logged lift, or the
// run figure for cardio) so the list reads at a glance. Tap → summary.
// Reached from Progress ("All sessions →"), so it's a drill-down with a back button.

import { getActiveProgram, getAllSessions } from "../store.js";
import { sessionVolume, fmtDuration, fmtWeight } from "../model.js";
import { el, mount, go, locationBadge, backBtn } from "../ui.js";
import { illustration } from "../illustrations.js";

function prettyShort(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
function prettyDayMonth(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
// Monday of the week containing `iso` — the grouping key.
function mondayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));   // Mon=0 … Sun=6
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

// The figure that best represents a session: the first logged lift for strength
// (real variety row to row), the run figure for cardio.
function sessionFigureId(s) {
  if (s.type === "cardio") return "run";
  const first = (s.strengthResult || [])[0];
  return (first && first.exerciseId) || "barbell";
}

export async function renderHistory() {
  const program = await getActiveProgram();
  const all = (await getAllSessions())
    .filter((s) => (s.strengthResult && s.strengthResult.length) || s.cardioResult)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  // group the newest-first sessions into calendar weeks (insertion order kept)
  const weeks = new Map();
  for (const s of all) {
    const key = mondayOf(s.date);
    if (!weeks.has(key)) weeks.set(key, []);
    weeks.get(key).push(s);
  }

  const children = [
    backBtn("Progress", "#/progress"),
    el("h1", { text: "All sessions" }),
    el("div.dim", { style: "margin-top:2px", text: `${all.length} logged · ${program ? program.name : ""}` }),
  ];

  for (const [monday, sessions] of weeks) {
    const vol = sessions.filter((s) => s.type === "strength").reduce((a, s) => a + sessionVolume(s), 0);
    const km = sessions.filter((s) => s.type === "cardio" && s.cardioResult && s.cardioResult.distanceKm)
      .reduce((a, s) => a + Number(s.cardioResult.distanceKm) || 0, 0);
    const bits = [`${sessions.length} session${sessions.length === 1 ? "" : "s"}`];
    if (vol) bits.push(fmtWeight(Math.round(vol)));
    if (km) bits.push(`${Math.round(km * 10) / 10} km`);
    children.push(el("div.card-head", { style: "margin-top:18px" }, [
      el("div.label", { text: `Week of ${prettyDayMonth(monday)}` }),
      el("span.note", { text: bits.join(" · ") }),
    ]));
    children.push(el("div.list", {}, sessions.map((s) => {
      const sub = s.type === "cardio" && s.cardioResult
        ? `${s.cardioResult.distanceKm} km · ${fmtDuration(s.cardioResult.timeSeconds)} · HR ${s.cardioResult.avgHR}`
        : `${(s.strengthResult || []).length} exercises · ${fmtWeight(Math.round(sessionVolume(s)))}`;
      return el("button.item", { onclick: () => go(`#/summary/${s.id}`), style: "text-align:left" }, [
        el("div.ico", {}, [illustration(sessionFigureId(s))]),
        el("div.meta", {}, [
          el("div.t", {}, [`${prettyShort(s.date)} `, el("span.faint", { text: `· Wk${s.weekNumber}` })]),
          el("div.s", { text: sub }),
        ]),
        locationBadge(s.location),
      ]);
    })));
  }

  if (!all.length)
    children.push(el("div.card", { style: "margin-top:14px" }, [el("p.dim", { text: "No sessions logged yet." })]));

  mount(children);
}
