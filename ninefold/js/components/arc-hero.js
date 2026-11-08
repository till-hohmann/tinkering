// arc-hero.js — the arc's view on Today: a night sky, the days left, and the
// goals that decide whether the arc lands.
//
// The curve runs from the arc's first day to its last, with a glowing marker for
// today. Under it, one gauge per goal and the adherence line, because turning up
// is what the other four depend on. Built synchronously from what is on the
// device, then refreshed once the tracker has answered (recovery history).

import { getWeightLog, getVO2maxLog, getNutritionLog, getProteinPerKg, getBodyweight, getAllPrograms,
  getAllSessions, resolveDay, getDexaBooked, setBodyweight, getRecoveryCache, setRecoveryCache } from "../store.js";
import { recoveryHistory, has, CAP } from "../health/index.js";
import { arcWindow, arcMonths, weightStatus, vo2Status, recoveryStatus, proteinStatus, arcAdherence } from "../arc.js";
import { addDaysISO, daysBetweenISO } from "../dates.js";
import { weightValue, weightLabel, weightToKg } from "../units.js";
import * as M from "../model.js";
import { el, setChildren } from "../ui.js";

const NS = "http://www.w3.org/2000/svg";
const S = (tag, attrs = {}, kids = []) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const c of kids) if (c) n.appendChild(c);
  return n;
};
const T = (txt, attrs) => { const t = S("text", attrs); t.textContent = txt; return t; };

// The curve: an arc of a circle centred below the card, so it reads as a horizon.
const CX = 170, CY = 236, R = 196;
const A0 = Math.atan2(130 - CY, 5 - CX);          // left end, ~-147°
const A1 = Math.atan2(130 - CY, 335 - CX);        // right end, ~-33°
const at = (pct, r = R) => { const a = A0 + (A1 - A0) * pct; return [CX + r * Math.cos(a), CY + r * Math.sin(a)]; };
const arcPath = (p0, p1, r = R) => { const [x0, y0] = at(p0, r), [x1, y1] = at(p1, r); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };

const shortDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase();

// Fixed sky: a seeded scatter, so the stars don't jump on every render.
function stars() {
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const g = S("g", { class: "arc-stars" });
  for (let i = 0; i < 46; i++) {
    const x = rnd() * 340, y = rnd() * 150, r = rnd() < 0.15 ? 1.15 : 0.55 + rnd() * 0.4;
    const c = S("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: r.toFixed(2), class: rnd() < 0.35 ? "tw" : null });
    if (c.getAttribute("class")) c.style.animationDelay = (rnd() * 6).toFixed(2) + "s";
    g.appendChild(c);
  }
  return g;
}

function curve(arc, win, dexaISO) {
  const svg = S("svg", { viewBox: "0 0 340 150", class: "arc-svg", role: "img",
    "aria-label": `${win.left} days left of ${arc.name || "the arc"}` });
  svg.appendChild(S("defs", {}, [
    S("linearGradient", { id: "arcGrad", x1: "0", y1: "0", x2: "1", y2: "0" }, [
      S("stop", { offset: "0", "stop-color": "#7c93e8" }), S("stop", { offset: "1", "stop-color": "#bfeaff" })]),
    S("filter", { id: "arcGlow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, [S("feGaussianBlur", { stdDeviation: "3.2" })]),
  ]));
  svg.appendChild(stars());
  svg.appendChild(S("path", { d: arcPath(0, 1), class: "arc-track" }));
  if (win.pct > 0) {
    svg.appendChild(S("path", { d: arcPath(0, win.pct), class: "arc-done-glow", filter: "url(#arcGlow)" }));
    svg.appendChild(S("path", { d: arcPath(0, win.pct), class: "arc-done" }));
  }
  for (const m of arcMonths(arc)) {
    const [x0, y0] = at(m.pct, R - 5), [x1, y1] = at(m.pct, R + 5), [lx, ly] = at(m.pct, R - 15);
    svg.appendChild(S("line", { x1: x0, y1: y0, x2: x1, y2: y1, class: "arc-tick" }));
    svg.appendChild(T(new Date(m.iso + "T12:00:00").toLocaleDateString("en-GB", { month: "short" }).toUpperCase(),
      { x: lx.toFixed(1), y: (ly + 3).toFixed(1), class: "arc-month" }));
  }
  if (dexaISO && dexaISO > arc.startDate && dexaISO <= arc.endDate) {
    const p = daysBetweenISO(arc.startDate, dexaISO) / win.total;
    const [x, y] = at(p), [lx, ly] = at(p, R + 12);
    svg.appendChild(S("circle", { cx: x, cy: y, r: 3.2, class: "arc-dexa" }));
    svg.appendChild(T("DEXA", { x: lx.toFixed(1), y: (ly - 2).toFixed(1), class: "arc-mark" }));
  }
  // the end: a star on the last day
  const [ex, ey] = at(1);
  svg.appendChild(T("✦", { x: ex.toFixed(1), y: (ey + 4).toFixed(1), class: "arc-end" }));
  // today
  const [tx, ty] = at(win.pct);
  svg.appendChild(S("circle", { cx: tx, cy: ty, r: 11, class: "arc-now-halo" }));
  svg.appendChild(S("circle", { cx: tx, cy: ty, r: 4.6, class: "arc-now" }));
  // the count, inside the curve
  if (win.final) {
    svg.appendChild(T("TODAY", { x: 170, y: 104, class: "arc-count small" }));
  } else {
    svg.appendChild(T(String(win.left), { x: 170, y: 108, class: "arc-count" }));
    svg.appendChild(T(win.left === 1 ? "DAY LEFT" : "DAYS LEFT", { x: 170, y: 126, class: "arc-countk" }));
  }
  svg.appendChild(T(shortDate(arc.startDate), { x: 4, y: 147, class: "arc-endl", "text-anchor": "start" }));
  svg.appendChild(T(shortDate(arc.endDate), { x: 336, y: 147, class: "arc-endl", "text-anchor": "end" }));
  return svg;
}

const gauge = (label, value, unit, target, pct, status, tone, onclick) =>
  el(onclick ? "button.arc-g" : "div.arc-g", { onclick: onclick || null, "aria-label": onclick ? `${label}: tap to weigh in` : null }, [
    el("div.arc-gk", { text: label }),
    el("div.arc-gv", {}, [value, unit ? el("span", { text: unit }) : null].filter(Boolean)),
    el("div.arc-gt", { text: target }),
    el("div.arc-gbar", {}, [el("i", { style: `width:${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%` })]),
    el("div.arc-gs" + (tone ? "." + tone : ""), { text: status }),
  ]);

export function arcHero(arc, iso) {
  const host = el("section.arccard", { "aria-label": arc.name || "Arc" });
  const state = { weighing: false, history: null };

  async function fill() {
    const win = arcWindow(arc, iso);
    if (!win) return;
    const [weights, vo2, nut, perKg, bw, programs, sessions, dexa, cache] = await Promise.all([
      getWeightLog(), getVO2maxLog(), getNutritionLog(), getProteinPerKg(), getBodyweight(),
      getAllPrograms(), getAllSessions(), getDexaBooked().catch(() => null), getRecoveryCache()]);
    const hist = state.history || Object.entries(cache).map(([date, pct]) => ({ date, pct }));
    const w = weightStatus(arc, weights, iso);
    const v = vo2Status(arc, vo2);
    const r = recoveryStatus(arc, hist, iso);
    const p = proteinStatus(arc, nut, weights, perKg, iso, bw);
    const ad = arcAdherence(arc, programs, sessions, iso, resolveDay);
    const dexaISO = typeof dexa === "string" ? dexa : dexa && dexa.date;

    const gauges = [];
    if (w) {
      const behind = w.delta != null && w.delta > 0.3;
      gauges.push(gauge("Weight", w.current != null ? String(weightValue(w.current)) : "–", "",
        `→ ${weightValue(w.goal)} ${weightLabel()}`, w.pct,
        w.current == null || w.stale ? "weigh in" : w.delta == null ? `${weightValue(w.toGo)} to go`
          : behind ? `+${weightValue(w.delta)} vs line` : "on pace",
        w.current == null || w.stale || behind ? "amber" : "good",
        () => { state.weighing = !state.weighing; fill(); }));
    }
    if (v) gauges.push(gauge("VO₂max", v.current != null ? String(v.current) : "–", "", `→ ${v.goal}`, v.pct,
      v.current == null ? "log it" : v.toGo > 0 ? `${v.toGo} to go` : "reached ✓", v.toGo > 0 ? "" : "good"));
    if (r) gauges.push(gauge("Recovery", r.avg != null ? String(r.avg) : "–", r.avg != null ? "%" : "", `avg → ${r.goal}%`, r.pct,
      r.avg == null ? "no data yet" : r.last7 != null ? `last 7d ${r.last7}%` : `${r.days} days`,
      r.avg == null ? "" : r.avg >= r.goal ? "good" : "amber"));
    if (p) gauges.push(gauge("Protein", p.avgPerKg != null ? p.avgPerKg.toFixed(1) : "–", "", `→ ${p.perKg.toFixed(1)} g/kg`, p.pct,
      p.logged ? `${p.hit}/${p.logged} days` : "log food", !p.logged ? "" : p.hit === p.logged ? "good" : "amber"));

    let weigh = null;
    if (w && state.weighing) {
      const input = el("input", { type: "text", inputmode: "decimal", placeholder: weightLabel(), "aria-label": "Today's weight",
        class: "arc-in", value: "" });
      const save = async () => {
        const kg = weightToKg(M.parseNum(input.value));
        if (!(kg > 30 && kg < 250)) { input.focus(); return; }
        await setBodyweight(kg);
        state.weighing = false; fill();
      };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
      weigh = el("div.arc-weigh", {}, [
        el("span", { text: w.stale && w.sinceChangeDays >= 7 ? `Same ${weightValue(w.current)} since ${shortDate(addDaysISO(iso, -w.sinceChangeDays)).toLowerCase()}. Weigh in:` : "Weigh in:" }),
        input, el("button.btn", { onclick: save }, "Save"),
      ]);
      setTimeout(() => input.focus(), 50);
    }

    const adh = ad && ad.planned + ad.thisWeek.planned > 0 ? el("div.arc-adh", {}, [
      el("div.row", { style: "align-items:baseline" }, [
        el("div.arc-gk", { text: "Turning up" }), el("span.spacer"),
        el("span.arc-adhv", { text: ad.planned ? `${ad.done}/${ad.planned}` : "–" }),
        el("span.arc-adhk", { text: ad.planned ? ` planned · ${Math.round(ad.pct * 100)}%` : " nothing due yet" }),
      ]),
      el("div.arc-gbar", { style: "margin-top:7px" }, [el("i", { style: `width:${Math.round((ad.pct || 0) * 100)}%` })]),
      el("div.row", { style: "margin-top:7px" }, [
        el("span.arc-adhk", { text: `This week ${ad.thisWeek.done}/${ad.thisWeek.planned}` }), el("span.spacer"),
        el("span.arc-adhk" + (ad.weekStreak ? ".hot" : ""), { text: ad.weekStreak
          ? `${ad.weekStreak} full week${ad.weekStreak === 1 ? "" : "s"} in a row`
          : "Every session, every week" }),
      ]),
    ]) : null;

    setChildren(host,
      el("div.arc-aurora", { "aria-hidden": "true" }),
      // Goals first, in one straight row, then the sky: the curve and the count
      // read as the payoff underneath the numbers that decide it.
      gauges.length ? el("div.arc-gauges", {}, gauges) : null,
      weigh,
      curve(arc, win, dexaISO),
      el("div.arc-title", { text: (arc.name || "Arc").toUpperCase() }),
      el("div.arc-sub", { text: win.final ? "The day it was all for."
        : `Day ${win.day} of ${win.total + 1} · until ${new Date(arc.endDate + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long" })}` }),
      adh,
    );
  }

  fill();
  // Then ask the tracker for recovery since the arc began (only the days the
  // cache doesn't have, plus the last two, which a late sync can still change).
  (async () => {
    try {
      if (!(arc.goals && arc.goals.recoveryPct) || !(await has(CAP.recovery))) return;
      const cache = await getRecoveryCache();
      const known = Object.keys(cache).filter((d) => d >= arc.startDate).sort();
      const from = known.length ? addDaysISO(known[known.length - 1], -2) : arc.startDate;
      const got = await recoveryHistory(from < arc.startDate ? arc.startDate : from);
      if (!got.length) return;
      const next = { ...cache };
      for (const r of got) next[r.date] = r.pct;
      // keep the cache to the arc and a little before it
      for (const d of Object.keys(next)) if (d < addDaysISO(arc.startDate, -30)) delete next[d];
      await setRecoveryCache(next);
      state.history = Object.entries(next).map(([date, pct]) => ({ date, pct }));
      if (host.isConnected && !state.weighing) fill();
    } catch (_) { /* offline: the cached average stands */ }
  })();
  return host;
}
