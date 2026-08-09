// weeksummary.js — end-of-week wrap-up shown after the Saturday session.
// Highlights of the week just finished (vs the previous week), a volume-by-day
// chart, then a preview of how next week differs.

import { getActiveProgram, getAllSessions, previousExercise } from "../store.js";
import * as M from "../model.js";
import { el, mount, go, addActionBar, backBtn, countUp } from "../ui.js";
import { barChart } from "../components/charts.js";
import { celebrate } from "../components/confetti.js";
import { weightLabel, weightValue, distanceLabel, distanceValue } from "../units.js";

const exName = (program, id) => (program.exercises[id] || {}).name || id;

function weekSig(program, num) {
  const w = (program.weeks || []).find((x) => x.weekNumber === num);
  if (!w) return null;
  const tue = w.days.Tue.exercises || [];
  const pick = (role) => { const e = tue.find((x) => x.role === role); return e ? `${e.prescribedSets}×${e.repRange}` : "—"; };
  return { phase: w.phaseName, compound: pick("compound"), accessory: pick("accessory"),
    core: pick("core"), mon: w.days.Mon.prescription, fri: w.days.Fri.prescription };
}
function nextWeekChanges(a, b) {
  const out = [];
  if (a.compound !== b.compound) out.push(["Compounds", `${a.compound} → ${b.compound}`]);
  if (a.accessory !== b.accessory) out.push(["Accessories", `${a.accessory} → ${b.accessory}`]);
  if (a.core !== b.core) out.push(["Core", `${a.core} → ${b.core}`]);
  if (a.mon !== b.mon) out.push(["Monday", b.mon]);
  if (a.fri !== b.fri) out.push(["Friday", b.fri]);
  return out;
}

export async function renderWeekSummary(n) {
  n = Number(n);
  const program = await getActiveProgram();
  const all = (await getAllSessions()).filter((s) => s.programId === program.id);
  const week = (program.weeks || []).find((w) => w.weekNumber === n);
  if (!week) return mount([el("div.card", {}, [el("p", { text: "Week not found." }),
    el("button.btn.block", { onclick: () => go("#/") }, "Today")])]);

  const thisW = all.filter((s) => s.weekNumber === n);
  const prevW = all.filter((s) => s.weekNumber === n - 1);
  const strengthThis = thisW.filter((s) => s.type === "strength");
  const totalVol = strengthThis.reduce((sum, s) => sum + M.sessionVolume(s), 0);
  const prevVol = prevW.filter((s) => s.type === "strength").reduce((sum, s) => sum + M.sessionVolume(s), 0);

  // lifts that moved up vs their previous occurrence
  const moved = [];
  for (const s of strengthThis) {
    for (const ex of s.strengthResult || []) {
      const prev = await previousExercise(program.id, s.weekday, ex.exerciseId, s.date);
      if (!prev) continue;
      const top = M.topSetWeight(ex), topPrev = M.topSetWeight(prev.exercise);
      const vol = M.exerciseVolume(ex), volPrev = M.exerciseVolume(prev.exercise);
      if (top > topPrev) moved.push(`${exName(program, ex.exerciseId)}: ${M.fmtWeight(top)} top set (was ${M.fmtWeight(topPrev)})`);
      else if (vol > volPrev * 1.02) moved.push(`${exName(program, ex.exerciseId)}: more volume than last week`);
    }
  }

  // cardio vs last week
  const cardioBits = [];
  for (const wd of ["Mon", "Fri"]) {
    const cur = thisW.find((s) => s.weekday === wd && s.cardioResult);
    const prev = prevW.find((s) => s.weekday === wd && s.cardioResult);
    if (cur && prev) {
      const cmp = M.compareCardio(cur.cardioResult, prev.cardioResult);
      const parts = [];
      if (cmp.distanceDelta > 0.05) parts.push(`+${distanceValue(cmp.distanceDelta).toFixed(2)} ${distanceLabel()}`);
      if (cmp.paceDelta != null && cmp.paceDelta < -2) parts.push("faster");
      if (cmp.hrDelta < -2) parts.push(`HR −${Math.abs(Math.round(cmp.hrDelta))}`);
      cardioBits.push(`${wd === "Mon" ? "Zone-2 run" : "Intervals"}: ${parts.length ? parts.join(", ") : "steady"}`);
    }
  }

  const children = [
    backBtn("Today", "#/"),
    el("div.label", { text: `Week ${n} complete` }),
    el("h1", { style: "margin-top:7px", text: week.phaseName }),
  ];

  // headline volume + bar chart by day
  const volNum = el("div.metric", { text: "0" });
  countUp(volNum, Math.round(weightValue(totalVol)), { dur: 850, fmt: (v) => Math.round(v).toLocaleString("en-GB") });
  const byDay = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((wd) => {
    const s = strengthThis.find((x) => x.weekday === wd);
    return { wd, vol: s ? M.sessionVolume(s) : 0 };
  }).filter((d, i, arr) => arr.some((x) => x.vol > 0)); // keep all if any volume
  const volCard = [
    el("div.row", {}, [el("div.label", { text: "Strength volume" }), el("span.spacer"),
      prevVol ? el("span.delta." + (totalVol >= prevVol ? "up" : "down"), { text: `${totalVol >= prevVol ? "+" : "−"}${M.fmtWeight(Math.round(Math.abs(totalVol - prevVol)))}` }) : null]),
    el("div.row", { style: "align-items:baseline;gap:6px;margin-top:8px" }, [volNum, el("span.unit", { text: weightLabel() })]),
  ];
  if (byDay.length && byDay.some((d) => d.vol > 0))
    volCard.push(el("div", { style: "margin-top:16px" }, [barChart({ values: byDay.map((d) => d.vol), labels: byDay.map((d) => d.wd[0]), color: "accent", height: 110, highlightLast: false })]));
  volCard.push(el("div.note", { style: "margin-top:12px", text: `${thisW.length} sessions done${prevVol ? ` · ${totalVol >= prevVol ? "up" : "down"} vs Week ${n - 1}` : ""}` }));
  children.push(el("div.card.flush", {}, volCard));

  // lifts up
  children.push(el("div.card", {}, [
    el("div.label", { style: "margin-bottom:10px", text: "Lifts that moved up" }),
    moved.length
      ? el("div.list", {}, moved.slice(0, 8).map((m) => el("div.note", { style: "color:var(--text)", text: "• " + m })))
      : el("p.note", { style: "margin:0", text: prevW.length ? "Held steady this week — fine on a heavy or deload week." : "First week logged — next week we'll compare." }),
  ]));

  if (cardioBits.length) {
    children.push(el("div.card", {}, [
      el("div.label", { style: "margin-bottom:10px", text: "Cardio vs last week" }),
      el("div.list", {}, cardioBits.map((c) => el("div.note", { style: "color:var(--text)", text: "• " + c }))),
    ]));
  }

  // next week preview
  if (n < program.lengthWeeks) {
    const changes = nextWeekChanges(weekSig(program, n), weekSig(program, n + 1));
    const nextWeek = program.weeks.find((w) => w.weekNumber === n + 1);
    children.push(el("div.card", { style: "border-color:rgba(56,189,248,.35)" }, [
      el("div.label", { style: "color:var(--cyan)", text: `Next up · Week ${n + 1}` }),
      el("h3", { style: "margin:8px 0 2px", text: nextWeek.phaseName }),
      el("p.note", { style: "margin:0 0 8px", text: nextWeek.focus }),
      changes.length
        ? el("div", {}, changes.map(([label, txt]) =>
            el("div.row.top", { style: "margin-top:8px" }, [
              el("span.badge", { text: label, style: "flex:none" }),
              el("span.note", { style: "color:var(--text)", text: txt }),
            ])))
        : el("p.note", { text: "Same structure as this week — keep adding load where you can." }),
    ]));
  } else {
    children.push(el("div.card", { style: "border-color:rgba(47,230,166,.4);background:var(--accent-ghost)" }, [
      el("div.row", { style: "gap:8px;margin-bottom:4px" }, [el("span", { style: "font-size:1.3rem", text: "🎉" }), el("div.label", { style: "color:var(--accent)", text: "Program complete" })]),
      el("p.note", { style: "color:var(--text);margin:0", text: "Eight weeks done. Export your log and build the next block from it." }),
    ]));
  }

  mount(children);
  addActionBar(el("button.btn.primary.block", { onclick: () => go("#/") }, "Done"));
  // celebrate only a genuinely strong week (3+ lifts up) or finishing the block —
  // not every week, so it stays meaningful.
  if (moved.length >= 3 || n === program.lengthWeeks) setTimeout(() => celebrate(), 280);
}
