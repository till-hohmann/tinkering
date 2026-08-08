// records.js — all-time personal bests across EVERY block (cross-program): best
// estimated-1RM per lift, the heaviest set behind it, cardio bests, and lifetime
// totals. Unlike Progress (scoped to the active program), this spans all blocks.

import { getAllSessions, getAllPrograms } from "../store.js";
import * as M from "../model.js";
import { el, mount, go, backBtn } from "../ui.js";
import { illustration } from "../illustrations.js";
import { e1rm } from "../progression.js";

const workSets = (ex) => (ex.sets || []).filter((s) => s.reps != null);
const bestE1 = (ex) => { const w = workSets(ex); return w.length ? Math.max(...w.map((s) => e1rm(s.weightKg, s.reps))) : 0; };
const topSet = (ex) => {
  const w = workSets(ex); if (!w.length) return null;
  return w.reduce((b, s) => (s.weightKg > b.weightKg || (s.weightKg === b.weightKg && s.reps > b.reps)) ? s : b);
};
const prettyId = (id) => id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
function prettyShort(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
const stat = (v, l) => el("div", {}, [el("div.metric.sm", { text: v }), el("div.label", { style: "margin-top:5px", text: l })]);

export async function renderRecords() {
  const [sessions, programs] = await Promise.all([getAllSessions(), getAllPrograms()]);
  const logged = sessions.filter((s) => (s.strengthResult && s.strengthResult.length) || s.cardioResult);
  // resolve an exercise name from ANY block that defined it (cross-program)
  const nameOf = (id) => { for (const p of programs) if (p.exercises && p.exercises[id]) return p.exercises[id].name; return prettyId(id); };

  const children = [
    backBtn("Progress", "#/progress"),
    el("h1", { style: "margin-top:6px", text: "Records" }),
    el("p.dim", { style: "margin-top:-2px", text: "All-time bests across every block." }),
  ];

  if (!logged.length) {
    children.push(el("div.card", { style: "margin-top:14px" }, [el("p.dim", { style: "margin:0", text: "No sessions logged yet — your bests will appear here." })]));
    return mount(children);
  }

  const strengthS = logged.filter((s) => s.type === "strength");
  const cardioS = logged.filter((s) => s.type === "cardio" && s.cardioResult);

  // ===== lifetime totals =====
  const totalVol = Math.round(strengthS.reduce((a, s) => a + M.sessionVolume(s), 0));
  const totalKm = cardioS.reduce((a, s) => a + (s.cardioResult.distanceKm || 0), 0);
  children.push(el("div.card", {}, [
    el("div.label", { text: "Lifetime" }),
    el("div.statgrid.three", { style: "margin-top:14px" }, [
      stat(String(logged.length), "Sessions"),
      stat(totalVol.toLocaleString("en-GB"), "kg lifted"),
      stat(totalKm.toFixed(totalKm >= 100 ? 0 : 1), "km run"),
    ]),
  ]));

  // ===== strength PRs: best estimated-1RM per lift, across all blocks =====
  const byEx = new Map();
  for (const s of strengthS) for (const ex of s.strengthResult || []) {
    const e1 = bestE1(ex); if (!e1) continue;
    const cur = byEx.get(ex.exerciseId);
    if (!cur || e1 > cur.e1) byEx.set(ex.exerciseId, { e1, top: topSet(ex), implement: ex.implement, date: s.date });
  }
  const prs = [...byEx.entries()].map(([id, r]) => ({ id, ...r })).sort((a, b) => b.e1 - a.e1);
  if (prs.length) {
    children.push(el("h2", { style: "margin-top:8px", text: "Strength" }));
    children.push(el("div.list", {}, prs.map((p) => el("div.item", {}, [
      el("div.ico", {}, [illustration(p.id)]),
      el("div.meta", {}, [
        el("div.t", { text: nameOf(p.id) }),
        el("div.s", { text: `best set ${p.top ? M.setDisplay(p.implement, p.top) : "—"} · ${prettyShort(p.date)}` }),
      ]),
      el("div", { style: "text-align:right;flex:none" }, [
        el("div", { style: "font-weight:800;font-variant-numeric:tabular-nums", text: Math.round(p.e1) + " kg" }),
        el("div.faint", { style: "font-size:.68rem;letter-spacing:.04em", text: "EST. 1RM" }),
      ]),
    ]))));
  }

  // ===== cardio bests =====
  if (cardioS.length) {
    const longest = cardioS.reduce((b, s) => (s.cardioResult.distanceKm || 0) > (b.cardioResult.distanceKm || 0) ? s : b);
    const paced = cardioS.map((s) => ({ s, pace: M.paceSecPerKm(s.cardioResult) })).filter((x) => x.pace != null);
    const fastest = paced.length ? paced.reduce((b, x) => (x.pace < b.pace ? x : b)) : null;
    const longestRun = cardioS.reduce((b, s) => ((s.cardioResult.timeSeconds || 0) > (b.cardioResult.timeSeconds || 0) ? s : b));
    const rec = (label, value, sub) => el("div.card.tight", {}, [
      el("div.row", { style: "align-items:baseline" }, [
        el("div.label", { text: label }), el("span.spacer"),
        el("div", { style: "font-weight:800", text: value }),
      ]),
      sub ? el("div.note", { style: "margin-top:4px", text: sub }) : null,
    ]);
    children.push(el("h2", { style: "margin-top:8px", text: "Cardio" }));
    const cardioCards = [rec("Longest distance", (longest.cardioResult.distanceKm || 0).toFixed(2) + " km", prettyShort(longest.date))];
    if (fastest) cardioCards.push(rec("Fastest pace", M.fmtPace(fastest.pace), `${(fastest.s.cardioResult.distanceKm || 0).toFixed(2)} km · ${prettyShort(fastest.s.date)}`));
    cardioCards.push(rec("Longest run", M.fmtDuration(longestRun.cardioResult.timeSeconds || 0), prettyShort(longestRun.date)));
    children.push(el("div.list", {}, cardioCards));
  }

  // ===== biggest single session =====
  if (strengthS.length) {
    const big = strengthS.reduce((b, s) => (M.sessionVolume(s) > M.sessionVolume(b) ? s : b));
    children.push(el("div.card.tight", { style: "margin-top:6px" }, [
      el("div.row", { style: "align-items:baseline" }, [
        el("div.label", { text: "Biggest session" }), el("span.spacer"),
        el("div", { style: "font-weight:800", text: M.fmtWeight(Math.round(M.sessionVolume(big))) }),
      ]),
      el("div.note", { style: "margin-top:4px", text: `${(big.strengthResult || []).length} exercises · ${prettyShort(big.date)}` }),
    ]));
  }

  mount(children);
}
