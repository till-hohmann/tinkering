// progress.js — the analytics home. Aggregates logged sessions into trends:
// all-time volume, weekly volume bars, per-lift top-set progression, bodyweight
// and cardio pace trends, plus a recent-sessions feed.

import { getActiveProgram, getAllSessions, getVO2maxLog, getNutritionLog, getBodyweight, getMeasurementsLog, getDexaLog, getWeightLog, equipmentForProgram } from "../store.js";
import { strengthScore } from "../standards.js";
import { getProfile } from "../profile.js";
import { weightLabel, weightValue, lengthLabel, lengthValue, distanceLabel, distanceValue, paceLabel, paceValue } from "../units.js";
import * as M from "../model.js";
import { el, mount, go, countUp, locationBadge } from "../ui.js";
import { illustration } from "../illustrations.js";
import { barChart, sparkline, dualAreaChart } from "../components/charts.js";
import { e1rm, detectStall, loadCeiling } from "../progression.js";
import { MUSCLES, LANDMARKS, setsFromResults, plannedSetsByMuscle, landmarkStatus } from "../volume.js";
import { muscleBody } from "../anatomy.js";
import { isRunModality, CARDIO_MODALITIES } from "../cardio-intel.js";
import { burnByDate, loadSeries, provider, has, CAP } from "../health/index.js";

// Nutrition trend (calories in vs WHOOP burn, protein) — filled after mount.
// `cutoff` scopes it to the selected time range (null = all, capped to 21 days
// of bars for readability).
async function fillNutrition(card, cutoff) {
  try {
    const log = await getNutritionLog();
    const dates = Object.keys(log).filter((d) => !cutoff || d >= cutoff).sort();
    if (!dates.length) return;
    let burn = {};
    try { burn = await burnByDate(95); } catch {}
    const recent = dates.slice(-21);                 // the CHART is capped at 21 days for readability…
    const balances = recent.map((d) => (burn[d] != null && log[d].kcal != null) ? log[d].kcal - burn[d] : null);
    const haveBal = dates.map((d) => (burn[d] != null && log[d].kcal != null) ? log[d].kcal - burn[d] : null).filter((b) => b != null);
    const proteins = dates.map((d) => log[d].protein).filter((p) => p != null);
    const avgP = proteins.length ? Math.round(proteins.reduce((a, b) => a + b, 0) / proteins.length) : null;
    const inner = [el("div.card-head", {}, [el("div.label", { text: "Nutrition" }), null])];
    const paired = recent.filter((d) => log[d].kcal != null && burn[d] != null);
    // …but the headline average covers the WHOLE selected range, so it always
    // matches the Recomp scorecard's kcal/day figure (same days, same maths).
    const pairedAll = dates.filter((d) => log[d].kcal != null && burn[d] != null);
    const swatch = (c, t) => el("span", { style: "display:inline-flex;align-items:center;gap:5px" }, [
      el("span", { style: `width:11px;height:3px;border-radius:2px;background:${c};display:inline-block` }), el("span.dim", { text: t })]);
    if (paired.length >= 2) {
      const avg = Math.round(pairedAll.reduce((s, d) => s + (log[d].kcal - burn[d]), 0) / pairedAll.length);
      inner.push(el("div.row", { style: "align-items:baseline;gap:6px;padding:0 2px 4px" }, [
        el("div.metric.sm", { style: "color:" + (avg <= 0 ? "var(--accent)" : "var(--coral)"), text: (avg > 0 ? "+" : "") + avg }), el("span.unit", { text: "kcal avg balance" })]));
      inner.push(dualAreaChart({ a: paired.map((d) => log[d].kcal), b: paired.map((d) => burn[d]), height: 96,
        gridIdx: weekBoundaries(paired), hStep: 500,
        tipText: (i) => { const d = paired[i]; return `${d.slice(5)}: in ${log[d].kcal} / out ${burn[d]}`; } }));
      inner.push(el("div.row", { style: "gap:14px;margin-top:8px;font-size:.74rem;flex-wrap:wrap" }, [
        swatch("var(--amber)", "Intake"), swatch("var(--cyan)", "Burned"),
        el("span.spacer"), el("span.dim", { text: "green deficit · coral surplus" }),
      ]));
    } else if (haveBal.length) {
      const avg = Math.round(haveBal.reduce((a, b) => a + b, 0) / haveBal.length);
      inner.push(el("div.row", { style: "align-items:baseline;gap:6px;padding:0 2px 6px" }, [
        el("div.metric.sm", { style: "color:" + (avg <= 0 ? "var(--accent)" : "var(--coral)"), text: (avg > 0 ? "+" : "") + avg }), el("span.unit", { text: "kcal avg balance" })]));
      inner.push(sparkline({ values: balances.map((b) => (b == null ? 0 : b)), color: "violet", height: 60, dots: false,
        gridIdx: weekBoundaries(recent), hStep: 500,
        tipText: (i) => `${recent[i].slice(5)}: ${balances[i] == null ? "–" : (balances[i] > 0 ? "+" : "") + Math.round(balances[i])}` }));
    } else {
      const intake = recent.map((d) => log[d].kcal || 0);
      const avgIn = Math.round(intake.reduce((a, b) => a + b, 0) / intake.length);
      inner.push(el("div.row", { style: "align-items:baseline;gap:6px;padding:0 2px 6px" }, [
        el("div.metric.sm", { text: String(avgIn) }), el("span.unit", { text: "kcal avg intake" })]));
      inner.push(sparkline({ values: intake, color: "violet", height: 60, dots: false,
        gridIdx: weekBoundaries(recent), hStep: 500,
        tipText: (i) => `${recent[i].slice(5)}: ${intake[i]} kcal` }));
    }
    inner.push(el("div.note", { style: "margin-top:10px", text: `${dates.length} day${dates.length > 1 ? "s" : ""} logged` + (avgP != null ? ` · avg protein ${avgP} g` : "") + (dates.length > 21 ? " · chart: last 21 days" : "") }));
    card.replaceChildren(...inner);
    card.style.display = "";
  } catch { /* offline / none → hidden */ }
}

// Training-load (ACWR) card — filled after mount; hidden until data loads.
//
// The underlying signal depends on the tracker: WHOOP reports day strain (0-21,
// logarithmic), Apple reports active energy (kcal). Those are NOT comparable in
// absolute terms, which is why the card leads with the acute:chronic RATIO — a
// series measured against itself, and therefore the same idea either way — and
// labels the raw unit rather than hardcoding "strain".
async function fillLoad(card) {
  try {
    if (!(await has(CAP.load))) return;
    const L = await loadSeries(35);
    if (!L || L.insufficient) return;
    const flagText = L.flag === "high" ? "ramping fast" : L.flag === "low" ? "detraining" : "balanced";
    const flagCls = L.flag === "high" ? "over" : L.flag === "low" ? "under" : "on";
    const unit = L.unit || "load";
    const fmt = (v) => (unit === "kcal" ? Math.round(v).toLocaleString("en-GB") : v.toFixed(1));
    card.replaceChildren(
      el("div.card-head", {}, [
        el("div.label", { text: "Training load · " + (L.label || "daily load") }),
        el("span.volchip." + flagCls, { text: flagText })]),
      el("div.row", { style: "align-items:baseline;gap:6px;padding:0 2px 6px" }, [
        el("div.metric.sm", { text: L.ratio != null ? L.ratio.toFixed(2) : "–" }), el("span.unit", { text: "acute : chronic" })]),
      sparkline({ values: L.series, color: "violet", height: 60, dots: false,
        tipText: (i) => `${L.label || "Load"} ${fmt(L.series[i])}` }),
      el("div.note", { style: "margin-top:10px", text:
        `7-day avg ${fmt(L.acute)} vs 28-day ${fmt(L.chronic)} ${unit}. Sweet spot 0.8–1.3; over 1.5 is a risky ramp, under 0.8 is detraining.` }),
    );
    card.style.display = "";
  } catch { /* offline / not connected → stay hidden */ }
}

// Resolve the cardio prescription for a session from the program (older sessions
// weren't stored with one). Lets the VO2max trend skip interval days.
function prescriptionFor(program, s) {
  if (s.prescription) return s.prescription;
  const wk = ((program && program.weeks) || []).find((w) => w.weekNumber === s.weekNumber);
  const day = wk && wk.days ? wk.days[s.weekday] : null;
  return (day && day.prescription) || "";
}

const exName = (program, id) => ((program && program.exercises && program.exercises[id]) || {}).name || id;
// Best estimated-1RM across a logged exercise's working sets (normalises strength
// across changing rep ranges — a heavier/fewer-reps week is comparable).
const bestE1 = (ex) => {
  const ws = (ex.sets || []).filter((s) => s.reps != null);
  return ws.length ? Math.max(...ws.map((s) => e1rm(s.weightKg, s.reps))) : 0;
};

function delta(value, { unit = weightLabel(), goodIfPositive = true, fmt } = {}) {
  if (value == null || Math.abs(value) < 1e-6) return el("span.delta.flat", { text: "—" });
  const good = goodIfPositive ? value > 0 : value < 0;
  const sign = value > 0 ? "+" : "−";
  const body = fmt ? fmt(Math.abs(value)) : Math.round(Math.abs(value)) + (unit ? " " + unit : "");
  return el("span.delta." + (good ? "up" : "down"), { text: sign + body });
}

function prettyShort(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// Monday-anchored week key for an ISO date, and the data indices where the week
// flips — used to draw per-week divider lines on date-indexed charts.
function mondayKey(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d), dow = (dt.getDay() + 6) % 7;   // 0 = Monday
  dt.setDate(dt.getDate() - dow);
  return `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
}
function weekBoundaries(dates) {
  const out = [];
  for (let i = 1; i < dates.length; i++) if (mondayKey(dates[i]) !== mondayKey(dates[i - 1])) out.push(i);
  return out;
}

function sectionHead(label, right) {
  return el("div.card-head", {}, [el("div.label", { text: label }), right || null]);
}

// Global time horizons for the whole Progress page. `days: null` = all time.
const RANGES = [
  { key: "1w", label: "1W", days: 7 },
  { key: "4w", label: "4W", days: 28 },
  { key: "3m", label: "3M", days: 90 },
  { key: "all", label: "All", days: null },
];
let rangeKey = "all";   // persists while the module stays loaded (across tab visits)

function cutoffISO(days) {
  if (!days) return null;
  const [y, m, d] = M.todayISO().split("-").map(Number);
  const dt = new Date(y, m - 1, d - days + 1);   // inclusive of today → last N days
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
const rangeLabel = () => (RANGES.find((r) => r.key === rangeKey) || RANGES[3]).label;

// MEDIAN estimated-1RM change across every lift with 2+ occurrences in the
// window — an overall "are you getting stronger" index. Median (not mean) so a
// couple of accessories that started near-bodyweight and tripled don't inflate
// it. Returns a fraction (0.03 = +3%) or null when there's no before/after.
function strengthIndexChange(strengthSessions) {
  const byKey = new Map();
  for (const s of strengthSessions) for (const ex of s.strengthResult || []) {
    const k = ex.exerciseId + "|" + s.weekday;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({ date: s.date, e1: bestE1(ex) });
  }
  const pcts = [];
  for (const occ of byKey.values()) {
    const o = occ.filter((x) => x.e1 > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (o.length >= 2 && o[0].e1 > 0) pcts.push((o[o.length - 1].e1 - o[0].e1) / o[0].e1);
  }
  if (!pcts.length) return null;
  pcts.sort((a, b) => a - b);
  const n = pcts.length;
  return n % 2 ? pcts[(n - 1) / 2] : (pcts[n / 2 - 1] + pcts[n / 2]) / 2;
}

// Recomp scorecard — the headline read on the primary goal (lose fat + build
// muscle together). Correlates the signals tracked: waist (the honest fat
// signal, when measured), bodyweight trend, the e1RM strength index, and
// average daily energy balance. Filled async (energy balance needs WHOOP),
// hidden until there's something to say.
async function fillRecomp(card, inRange, cutoff) {
  try {
    const strengthS = inRange.filter((s) => s.type === "strength" && s.strengthResult && s.strengthResult.length);
    const sIdx = strengthIndexChange(strengthS);
    const bwPts = inRange.filter((s) => s.sessionNotes && s.sessionNotes.bodyweightKg)
      .map((s) => ({ date: s.date, kg: s.sessionNotes.bodyweightKg })).sort((a, b) => (a.date < b.date ? -1 : 1));
    let latestBw = bwPts.length ? bwPts[bwPts.length - 1].kg : null;
    if (latestBw == null) { try { latestBw = await getBodyweight(); } catch {} }
    const bwDelta = bwPts.length >= 2 ? bwPts[bwPts.length - 1].kg - bwPts[0].kg : null;
    // waist beats scale weight as the fat signal — muscle gain hides fat loss on the scale
    let waistDelta = null;
    try {
      const wl = (await getMeasurementsLog()).filter((e) => e.waistCm != null && (!cutoff || e.date >= cutoff));
      if (wl.length >= 2) waistDelta = wl[wl.length - 1].waistCm - wl[0].waistCm;
    } catch {}

    let avgBal = null;
    try {
      const log = await getNutritionLog();
      let burn = {}; try { burn = burnByDate((await whoopCyclesAll(95)).map(mapCycle)); } catch {}
      const bals = Object.keys(log).filter((d) => !cutoff || d >= cutoff)
        .map((d) => (burn[d] != null && log[d].kcal != null) ? log[d].kcal - burn[d] : null).filter((b) => b != null);
      if (bals.length) avgBal = Math.round(bals.reduce((a, b) => a + b, 0) / bals.length);
    } catch {}

    if (sIdx == null && bwDelta == null && latestBw == null && waistDelta == null) return;   // nothing to read yet

    const sUp = sIdx != null && sIdx > 0.015, sDown = sIdx != null && sIdx < -0.015;
    // fat signal: waist when measured (≥0.8 cm move), else bodyweight (≥0.5 kg)
    const wDown = waistDelta != null ? waistDelta < -0.8 : bwDelta != null && bwDelta < -0.5;
    const wUp = waistDelta != null ? waistDelta > 0.8 : bwDelta != null && bwDelta > 0.5;
    let head, detail, tone = "neutral";
    if (sUp && wDown) { head = "Recomp is working"; detail = "Stronger and lighter at once — keep protein high to hold the muscle."; tone = "good"; }
    else if (sUp && wUp) { head = "Lean gaining"; detail = "Strength and weight both up — good if you're fine gaining; tighten the deficit if fat-loss is the priority."; }
    else if (sUp) { head = "Recomposing"; detail = "Stronger at a steady weight — muscle up, fat likely down. Textbook recomp."; tone = "good"; }
    else if (sDown && wDown) { head = "Cutting hard"; detail = "Weight and strength both down — push protein and keep the heavy sets so the loss stays fat, not muscle."; tone = "warn"; }
    else if (sDown && wUp) { head = "Worth a look"; detail = "Weight up while strength dips — check sleep/recovery and that your loads are actually climbing."; tone = "warn"; }
    else if (sDown) { head = "Strength dipping"; detail = "Down at a steady weight — expected on a deload week; otherwise check recovery."; }
    else if (wDown) { head = "Leaning out"; detail = "Weight trending down, strength holding — keep training heavy to protect muscle."; tone = "good"; }
    else { head = "Holding steady"; detail = "Maintaining — fine on a deload or a maintenance stretch."; }
    if (avgBal != null) detail += ` Averaging ${avgBal <= 0 ? Math.abs(avgBal) + " kcal/day deficit" : avgBal + " kcal/day surplus"}.`;

    const toneColor = tone === "good" ? "var(--accent)" : tone === "warn" ? "var(--coral)" : "var(--text)";
    const stat = (val, color, label) => el("div", {}, [
      el("div.metric.sm", { style: "color:" + color, text: val }), el("div.label", { style: "margin-top:5px", text: label })]);
    card.replaceChildren(
      el("div.row", {}, [el("div.label", { text: "Recomp" }), el("span.spacer"), el("span.note", { text: cutoff ? "last " + rangeLabel() : "all time" })]),
      el("div", { style: "font-weight:800;font-size:1.08rem;margin:9px 0 5px;color:" + toneColor, text: head }),
      el("div.note", { text: detail }),
      el("div.statgrid.three", { style: "margin-top:16px" }, [
        waistDelta != null
          ? stat((waistDelta > 0 ? "+" : "−") + Math.abs(lengthValue(waistDelta)).toFixed(1),
              wDown ? "var(--accent)" : wUp ? "var(--coral)" : "var(--text-dim)", `Waist Δ ${lengthLabel()}`)
          : stat(bwDelta != null && (wDown || wUp) ? (bwDelta > 0 ? "+" : "−") + Math.abs(weightValue(bwDelta)).toFixed(1) : (latestBw != null ? M.fmtWeight(latestBw, { withUnit: false }) : "—"),
              wDown ? "var(--accent)" : wUp ? "var(--coral)" : "var(--text-dim)", bwDelta != null && (wDown || wUp) ? "Bodyweight Δ" : "Bodyweight"),
        stat(sIdx != null ? (sIdx > 0 ? "+" : "−") + Math.abs(sIdx * 100).toFixed(0) + "%" : "—",
          sUp ? "var(--accent)" : sDown ? "var(--coral)" : "var(--text-dim)", "Strength e1RM"),
        stat(avgBal != null ? (avgBal > 0 ? "+" : "−") + Math.abs(avgBal) : "—",
          avgBal == null ? "var(--text-dim)" : avgBal <= 0 ? "var(--accent)" : "var(--coral)", "kcal/day bal"),
      ]),
    );
    card.style.display = "";
  } catch { /* hidden on error */ }
}

// Strength standard — best recent e1RM per big lift vs bodyweight-relative
// standards (Caliber-pattern benchmark). Cross-program (ability, not block),
// scoped to the last 8 weeks so it reflects current strength. Hidden without
// a bodyweight or any benchmarked lift.
async function fillStandards(card) {
  try {
    const bwKg = await getBodyweight();
    if (!bwKg) return;
    const since = cutoffISO(56);
    const best = {};
    for (const s of await getAllSessions()) {
      if (!s.strengthResult || (since && s.date < since)) continue;
      for (const ex of s.strengthResult) {
        const e1 = bestE1(ex);
        if (e1 > (best[ex.exerciseId] || 0)) best[ex.exerciseId] = e1;
      }
    }
    // Sex drives which ratio table applies; without it the benchmark would be a
    // guess dressed up as a score, so the card stays hidden until it's set.
    const prof = await getProfile();
    if (!prof || !prof.features.strengthStandards) return;
    // SAY WHY IT'S EMPTY rather than vanishing. Both inputs are things the user
    // can supply in one tap, and a card that silently never appears reads as a
    // feature that doesn't work — the benchmark needs a bodyweight to divide by
    // and a sex to pick the ratio table, and neither is guessable.
    const missing = [!bwKg ? "your bodyweight" : null, !prof.sex ? "your sex" : null].filter(Boolean);
    if (missing.length) {
      card.style.display = "";
      card.replaceChildren(
        el("div.label", { text: "Strength standard" }),
        el("p.note", { style: "margin-top:6px", text:
          `Scores your big lifts against bodyweight-relative benchmarks. Needs ${missing.join(" and ")} — `
          + `${missing.length > 1 ? "they're" : "it's"} in Profile, and nothing else uses ${missing.length > 1 ? "them" : "it"} for scoring.` }),
        el("button.btn.block", { style: "margin-top:10px", onclick: () => go("#/settings") }, "Open Profile"),
      );
      return;
    }
    const sc = strengthScore(best, bwKg, prof.sex);
    if (!sc) return;
    // each level starts at a fixed score position; the per-lift kg demarcations
    // are that boundary × bodyweight — so every bar is a full labelled scale.
    const TICKS = [20, 40, 60, 80, 100];
    const NAMES = ["Beg", "Nov", "Int", "Adv", "Elite"];
    const tickX = (p) => `left:${p}%;transform:translateX(${p === 100 ? "-100%" : "-50%"})`;
    const axis = el("div", { style: "position:relative;height:13px;margin:12px 2px 0" },
      NAMES.map((n, i) => el("span.faint", { style: `position:absolute;${tickX(TICKS[i])};font-size:.6rem;letter-spacing:.03em`, text: n })));
    const rows = sc.lifts.map((l) => el("div", { style: "margin-top:12px" }, [
      el("div.row", { style: "align-items:baseline" }, [
        el("span", { style: "font-weight:700", text: l.label }),
        el("span.dim", { style: "margin-left:8px;font-size:.8rem", text: `${M.fmtWeight(Math.round(l.e1))} e1RM` }),
        el("span.spacer"),
        el("span.dim", { style: "font-size:.8rem", text: l.level }),
      ]),
      el("div", { style: "position:relative;height:7px;border-radius:3px;background:var(--bg-elev2);margin-top:6px" }, [
        el("div", { style: `position:absolute;left:0;top:0;bottom:0;width:${l.score}%;border-radius:3px;background:var(--grad-cta,var(--accent))` }),
        ...TICKS.slice(0, 4).map((p) => el("div", { style: `position:absolute;left:${p}%;top:-2px;bottom:-2px;width:1px;background:var(--line)` })),
      ]),
      el("div", { style: "position:relative;height:12px;margin-top:3px" },
        l.levelsKg.map((kg, i) => el("span.faint", { style: `position:absolute;${tickX(TICKS[i])};font-size:.62rem;font-variant-numeric:tabular-nums`, text: String(Math.round(weightValue(kg))) }))),
    ]));
    card.replaceChildren(
      el("div.card-head", {}, [
        el("div.row", { style: "align-items:baseline;gap:8px" }, [el("div.label", { text: "Strength standard" }), el("span.faint", { style: "font-size:.62rem;letter-spacing:.06em", text: "LAST 8 WK" })]),
        el("span.volchip.on", { text: sc.level })]),
      el("div.row", { style: "align-items:baseline;gap:6px;padding:0 2px 2px" }, [
        el("div.metric.sm", { text: String(sc.overall) }), el("span.unit", { text: "/ 100" })]),
      axis,
      ...rows,
      el("div.note", { style: "margin-top:12px", text: `Numbers under each bar: the e1RM (${weightLabel()}) where that level starts at your ${M.fmtWeight(bwKg)} bodyweight — below Beginner counts as developing. Best lifts of the last 8 weeks, common ${prof.sex} standards.` }),
    );
    card.style.display = "";
  } catch { /* hidden on error */ }
}

// DEXA body-composition card (Body tab). A periodic gold-standard read: fat mass,
// fat-free mass, distribution (android/gynoid, A/G), metabolic (RMR, RSMI, BMI)
// and bone (BMD, T/Z, centile). One scan = baseline; 2+ = tracked change (Δ fat
// down, Δ lean held/up = the true recomp signal). Retest due 12 weeks after the
// last. Hidden until a scan exists. `goodDir`: 'down' | 'up' | null per metric.
const DEXA_RETEST_DAYS = 84;   // 12 weeks

// Goal-progress baseline. These used to be module constants holding one
// person's numbers; they now come from the profile, and every one of them is
// optional — an install with no weight goal simply doesn't draw the goal track.
function goalConfig(profile) {
  const g = (profile && profile.goal) || {};
  if (!Number.isFinite(g.weightKg) || !Number.isFinite(g.baselineKg)) return null;
  const iso = g.baselineDate || null;
  return {
    goalKg: g.weightKg,
    startKg: g.baselineKg,
    startISO: iso,
    // "1 Jan" style short label, derived rather than stored so it can't drift
    // out of sync with the date it labels.
    startLabel: iso
      ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })
      : "start",
  };
}
async function fillDexa(card) {
  try {
    const log = await getDexaLog();
    if (!log.length) return;
    const latest = log[log.length - 1];
    const prev = log.length > 1 ? log[log.length - 2] : null;
    const has = (k) => latest[k] != null;
    const bfOf = (s) => s.bodyFatPct != null ? s.bodyFatPct
      : (s.totalFatKg != null && s.totalMassKg ? (s.totalFatKg / s.totalMassKg) * 100 : null);

    // next-scan-due chip
    const dueISO = addDaysISO(latest.date, DEXA_RETEST_DAYS);
    const daysToDue = daysBetween(M.todayISO(), dueISO);
    const dueChip = daysToDue <= 0
      ? el("span.volchip.over", { text: "retest due" })
      : el("span.note", { text: `next in ${Math.max(1, Math.round(daysToDue / 7))} wk` });

    // one metric row, with a good/bad-coloured delta when a prior scan exists.
    // `conv` converts a stored metric value to the displayed unit — identity for
    // the ratios and percentages, weightValue for the four masses.
    const mrow = (label, k, unit, dec, goodDir, conv = (x) => x) => {
      if (!has(k)) return null;
      const v = conv(latest[k]);
      const f = (x) => (dec != null ? x.toFixed(dec) : String(x));
      let dEl = null;
      if (prev && prev[k] != null) {
        const d = v - conv(prev[k]);
        const eps = dec != null ? Math.pow(10, -dec) / 2 : 0.5;
        if (Math.abs(d) <= eps) dEl = el("span.delta.flat", { text: "—" });
        else {
          const good = goodDir === "down" ? d < 0 : goodDir === "up" ? d > 0 : null;
          dEl = el("span.delta." + (good == null ? "flat" : good ? "up" : "down"),
            { text: (d > 0 ? "+" : "−") + f(Math.abs(d)) });
        }
      }
      return el("div.row", { style: "align-items:baseline;margin-top:9px" }, [
        el("span", { style: "font-weight:600", text: label }), el("span.spacer"),
        el("span.dim", { style: "font-variant-numeric:tabular-nums;font-size:.9rem", text: f(v) + (unit ? " " + unit : "") }),
        dEl,
      ]);
    };
    const group = (title, rows) => {
      const r = rows.filter(Boolean);
      return r.length ? el("div", { style: "margin-top:16px" }, [
        el("div.faint", { style: "font-size:.66rem;text-transform:uppercase;letter-spacing:.1em", text: title }), ...r]) : null;
    };

    const inner = [el("div.card-head", {}, [el("div.label", { text: "Body composition · DEXA" }), dueChip])];

    // ===== HERO: progress toward the bodyweight goal — the card's key metric.
    // Projected at HELD muscle (target BF% comes from the scan's lean mass); "to go"
    // uses a live bodyweight reading when there is one. Skipped entirely when the
    // profile carries no weight goal — most people won't set one. =====
    const goal = goalConfig(await getProfile());
    if (goal && has("totalMassKg") && has("totalFatKg") && has("ffmKg")) {
      const nonFat = latest.totalMassKg - latest.totalFatKg;        // muscle + bone, held
      const targetFat = Math.max(0, goal.goalKg - nonFat);
      const targetBF = (targetFat / (targetFat + latest.ffmKg)) * 100;
      let curW = latest.totalMassKg;
      try { const bw = await getBodyweight(); if (bw) curW = bw; } catch {}
      const toGo = curW - goal.goalKg;
      const lost = goal.startKg - curW;                        // progress from the baseline
      const pct = goal.startKg > goal.goalKg ? Math.max(0, Math.min(100, (lost / (goal.startKg - goal.goalKg)) * 100)) : 0;
      inner.push(
        el("div.row", { style: "align-items:baseline;padding:2px 2px 0" }, [
          el("div.label", { text: "Weight loss" }), el("span.spacer"),
          el("span.note", { text: `goal ${M.fmtWeight(goal.goalKg)}` })]),
        el("div.row", { style: "align-items:baseline;gap:6px;padding:1px 2px 6px" }, [
          el("div.metric.sm", { text: lost > 0.1 ? weightValue(lost).toFixed(1) : "0" }),
          el("span.unit", { text: `${weightLabel()} lost since ${goal.startLabel}` }), el("span.spacer"),
          el("span.dim", { style: "font-size:.85rem;font-variant-numeric:tabular-nums", text: toGo > 0.1 ? `${weightValue(toGo).toFixed(1)} to go` : "reached ✓" })]),
        el("div", { style: "position:relative;height:8px;border-radius:4px;background:var(--bg-elev2);margin-top:2px" }, [
          el("div", { style: `position:absolute;left:0;top:0;bottom:0;width:${pct}%;border-radius:4px;background:var(--grad-cta,var(--accent))` })]),
        el("div.row", { style: "margin-top:6px;font-size:.7rem;color:var(--text-dim)" }, [
          el("span", { text: `${M.fmtWeight(goal.startKg)} · ${goal.startLabel}` }), el("span.spacer"), el("span", { text: M.fmtWeight(goal.goalKg) })]),
        el("div.note", { style: "margin-top:8px", text:
          `Reaching ${M.fmtWeight(goal.goalKg)} lands you at ~${Math.round(targetBF)}% body fat if you hold your ${M.fmtWeight(Math.round(latest.ffmKg))} of lean mass.` }),
      );
    }

    // fat vs lean split bar (of total mass)
    if (has("totalFatKg") && has("ffmKg")) {
      const fat = latest.totalFatKg, ffm = latest.ffmKg, tot = latest.totalMassKg || (fat + ffm);
      const fp = Math.max(0, Math.min(100, (fat / tot) * 100)), lp = Math.max(0, Math.min(100, (ffm / tot) * 100));
      const rem = Math.max(0, 100 - fp - lp);
      inner.push(el("div", { style: "display:flex;height:16px;border-radius:5px;overflow:hidden;margin:16px 0 4px" }, [
        el("div", { style: `width:${fp}%;background:var(--coral)` }),
        el("div", { style: `width:${lp}%;background:var(--accent)` }),
        el("div", { style: `width:${rem}%;background:var(--bg-elev2)` }),
      ]));
      inner.push(el("div.row", { style: "font-size:.72rem;color:var(--text-dim);margin-bottom:2px" }, [
        el("span", { text: `Fat ${weightValue(fat).toFixed(1)} ${weightLabel()}` }), el("span.spacer"),
        el("span", { text: `Lean ${weightValue(ffm).toFixed(1)} ${weightLabel()}` })]));
    }

    inner.push(group("Composition", [
      mrow("Total mass", "totalMassKg", weightLabel(), 1, "down", weightValue),
      mrow("Fat mass", "totalFatKg", weightLabel(), 1, "down", weightValue),
      mrow("Fat-free mass", "ffmKg", weightLabel(), 1, "up", weightValue),
      mrow("Body fat", "bodyFatPct", "%", 1, "down"),
      mrow("BMI", "bmi", "", 1, "down"),
    ]));
    inner.push(group("Fat distribution", [
      mrow("Android (belly)", "androidFatPct", "%", 1, "down"),
      mrow("Gynoid (hips)", "gynoidFatPct", "%", 1, null),
      mrow("A/G ratio", "agRatio", "", 2, "down"),
    ]));
    // surface the A/G ratio — the #1 health signal; >1.0 (men) = central/android fat
    if (latest.agRatio != null && latest.agRatio > 1.0) {
      inner.push(el("div.note", { style: "margin-top:8px;color:var(--amber)", text:
        `A/G ${latest.agRatio.toFixed(2)} is elevated — your fat sits central (android). It's the biggest health lever and the fastest to respond to the cut.` }));
    }
    inner.push(group("Metabolic & muscle", [
      mrow("Resting metabolic rate", "rmr", "kcal", 0, "up"),
      mrow("Skeletal muscle index", "rsmi", "kg/m²", 2, "up"),
    ]));
    inner.push(group("Bone density", [
      mrow("BMD", "bmd", "g/cm²", 3, "up"),
      mrow("T-score", "tScore", "", 1, "up"),
      mrow("Z-score", "zScore", "", 1, "up"),
      mrow("Centile", "centile", "", 0, "up"),
    ]));

    inner.push(el("div.note", { style: "margin-top:16px", text: prev
      ? `Latest ${latest.date} vs ${prev.date}. Green = the healthy direction — fat & central fat down, lean, bone & metabolism up.`
      : `Baseline ${latest.date}. Retest around ${dueISO} to track fat vs lean change — the real recomp signal.` }));
    inner.push(el("button.btn.block", { style: "margin-top:12px", onclick: () => go("#/settings") },
      prev ? "Log a new scan →" : "Add / edit scan →"));

    card.replaceChildren(...inner.filter(Boolean));
    card.style.display = "";
  } catch { /* hidden on error */ }
}

// --- shared across the Progress + Body tabs ---------------------------------
// The time-range selector (1W/4W/3M/All) — shared `rangeKey`, re-renders whichever
// tab passed its own render fn.
function rangeSeg(rerender) {
  const seg = el("div.segmented", { style: "margin-top:12px" });
  for (const r of RANGES) seg.appendChild(el("button" + (rangeKey === r.key ? ".on" : ""),
    { onclick: () => { rangeKey = r.key; rerender(); } }, r.label));
  return seg;
}
async function scopedSessions() {
  const program = await getActiveProgram();
  // ALL blocks' sessions — trends flow across block boundaries (Block 1 → Block 2 →…)
  // as one continuous story instead of resetting when a new block takes over.
  // Cards that are inherently current-block-scoped (weekly sets/muscle) guard on
  // programId themselves; the progression/comparison ENGINE stays within-program.
  const sessions = (await getAllSessions()).slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const logged = sessions.filter((s) => (s.strengthResult && s.strengthResult.length) || s.cardioResult);
  return { program, sessions, logged };
}
function emptyState(title) {
  return mount([el("h1", { text: title }), el("div.card", { style: "margin-top:14px" }, [
    el("p.dim", { style: "margin:0", text: "No sessions logged yet. Finish a workout and your trends will start building here." }),
    el("button.btn.primary.block", { style: "margin-top:14px", onclick: () => go("#/") }, "Go to today"),
  ])]);
}

// Date helpers for the DEXA retest cadence.
function addDaysISO(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
function daysBetween(aISO, bISO) {
  const t = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).getTime(); };
  return Math.round((t(bISO) - t(aISO)) / 86400000);
}

export async function renderProgress() {
  const { program, logged } = await scopedSessions();
  if (!logged.length) return emptyState("Progress");
  // "Running & cardio" off means the pace trend and modality breakdown go away.
  // Logged runs are NOT hidden from the session feed — the toggle governs the
  // analytics you asked not to see, not whether your training happened.
  const progProfile = await getProfile().catch(() => null);
  const showCardio = !progProfile || progProfile.features.cardio !== false;

  const children = [el("h1", { text: "Progress" }), rangeSeg(renderProgress)];
  // section anchors for the sticky jump-chip navigator (built just before mount,
  // so only sections that actually rendered get a chip)
  const secs = [];
  const anchor = (id, label) => { secs.push({ id, label }); return el("div", { id, style: "scroll-margin-top:60px" }); };
  const cutoff = cutoffISO((RANGES.find((r) => r.key === rangeKey) || RANGES[3]).days);
  const inWindow = (iso) => !cutoff || iso >= cutoff;
  const inRange = logged.filter((s) => inWindow(s.date));
  const strength = inRange.filter((s) => s.type === "strength");
  const cardio = inRange.filter((s) => s.type === "cardio" && s.cardioResult);

  const standardsCard = el("div.card", { style: "display:none" });

  // ===== 1. weekly sets / muscle  &  2. muscle map (both from one computation) =====
  if (program && strength.length) {
    const curWeek = M.weekNumberFor(program, M.todayISO());
    const planned = plannedSetsByMuscle(program, curWeek);
    const loggedSets = setsFromResults(strength.filter((s) => s.programId === program.id && s.weekNumber === curWeek).flatMap((s) => s.strengthResult || []));
    const rows = MUSCLES.filter((m) => (planned[m] || 0) > 0 || (loggedSets[m] || 0) > 0).map((m) => volRow(m, loggedSets[m] || 0, planned[m] || 0));
    if (rows.length) {
      children.push(anchor("sec-volume", "Volume"));
      // 1. weekly sets / muscle
      children.push(el("div.card-head", { style: "margin-top:6px" }, [
        el("h2", { style: "margin:0", text: "Weekly sets / muscle" }),
        el("span.note", { text: `Week ${curWeek}` }),
      ]));
      children.push(el("div.card.flush", {}, [
        el("div.volwrap", {}, rows),
        el("p.note", { style: "margin:12px 2px 2px", text: "Bar = sets logged, tick = the week's planned target, green band = productive range (MEV–MAV). The chip rates your program's planned dose: light (below MEV) · productive · high (above MAV)." }),
      ]));
      // THE GAP A YOGA-SUBSTITUTED WEEK LEAVES IS SHOWN, NOT HIDDEN.
      //
      // Yoga contributes zero hard sets by design — the strength evidence for it
      // comes entirely from untrained, older or clinical populations, and it is
      // isometric work, which transfers to isometric strength and not to dynamic
      // strength. So a week where a lifting day became a practice reads as
      // under-dosed on the bars above, and that reading is CORRECT. Saying so is
      // more useful than quietly crediting sets that were never done, and it is
      // the same principle as the builder naming a Zone-2-only choice instead of
      // fixing it: an explicit decision is surfaced, never overridden.
      const yogaCard = await yogaGapNote(program, curWeek, loggedSets);
      if (yogaCard) children.push(yogaCard);
      // 2. muscle map — lit by the sets you've LOGGED this week (the bars card above
      //    covers the planned dose; the map answers "what have I actually trained").
      const VC = { under: "#5fa8ff", in: "#2fe6a6", over: "#fb7185" };
      const colorOf = (m) => { const lv = loggedSets[m] || 0; if (!lv && !(planned[m] > 0)) return null; return VC[landmarkStatus(m, lv)] || null; };
      const leg = (c, lbl) => el("span", { style: "display:inline-flex;align-items:center;gap:6px;font-size:.72rem;color:var(--text-dim)" }, [
        el("span", { style: `width:11px;height:11px;border-radius:3px;background:${c}` }), el("span", { text: lbl })]);
      children.push(el("div.card-head", { style: "margin-top:6px" }, [
        el("h2", { style: "margin:0", text: "Muscle map" }),
        el("span.note", { text: `Week ${curWeek}` }),
      ]));
      children.push(el("div.card", {}, [
        muscleBody(colorOf),
        el("div.row", { style: "gap:16px;justify-content:center;flex-wrap:wrap;margin-top:12px" },
          [leg(VC.under, "Below MEV"), leg(VC.in, "Productive"), leg(VC.over, "Over MAV")]),
        el("p.note", { style: "margin:10px 2px 2px", text: "Lit by the sets you've logged this week — blue muscles are still below the productive range (train them), green are in it, red are over." }),
      ]));
    }
  }

  // ===== 4. running pace =====
  if (showCardio && cardio.length) {
    children.push(anchor("sec-cardio", "Cardio"));
    // pace only compares within running — a machine's "km" isn't a road km, so
    // elliptical is kept out of the pace trend (its progress shows in the breakdown).
    const runCardio = cardio.filter((s) => isRunModality(s.cardioResult.modality));
    const paceData = runCardio.map((s) => ({ date: s.date, pace: M.paceSecPerKm(s.cardioResult) })).filter((p) => p.pace != null);
    const paces = paceData.map((p) => p.pace);
    const dists = cardio.map((s) => s.cardioResult.distanceKm || 0);
    const lastPace = paces[paces.length - 1];
    const inner = [sectionHead(paces.length ? "Running pace" : "Cardio",
      paces.length > 1 ? delta(paceValue(paces[paces.length - 1]) - paceValue(paces[0]), { goodIfPositive: false, fmt: (v) => `${Math.round(v)} s${paceLabel()}` }) : null)];
    if (lastPace != null) inner.push(el("div.row", { style: "align-items:baseline;gap:6px;padding:0 2px 6px" }, [
      el("div.metric.sm", { text: M.fmtPace(lastPace, { withUnit: false }) }), el("span.unit", { text: paceLabel() })]));
    if (paces.length > 1) inner.push(sparkline({ values: paces.map((p) => -p), color: "cyan", height: 70, dots: true,
      gridIdx: weekBoundaries(paceData.map((p) => p.date)),
      tipText: (i) => `${prettyShort(paceData[i].date)}: ${M.fmtPace(paces[i])}` }));
    // per-modality breakdown — outdoor / treadmill / elliptical tracked separately
    const byMod = CARDIO_MODALITIES.map((m) => {
      const rs = cardio.filter((s) => (s.cardioResult.modality || "run_outdoor") === m.id);
      return { m, n: rs.length, km: rs.reduce((a, s) => a + (s.cardioResult.distanceKm || 0), 0) };
    }).filter((x) => x.n);
    if (byMod.length > 1) inner.push(el("div.row.wrap", { style: "gap:6px;margin-top:10px" },
      byMod.map((x) => el("span.badge", { text: `${x.m.label} · ${x.n} · ${distanceValue(x.km).toFixed(1)} ${distanceLabel()}` }))));
    inner.push(el("div.note", { style: "margin-top:10px" }, [`${cardio.length} sessions · ${distanceValue(dists.reduce((a, b) => a + b, 0)).toFixed(1)} ${distanceLabel()} total`]));
    children.push(el("div.card.flush", {}, inner));
  }

  // ===== 5. volume lifted | weekly trend (two half-width cards, equal height) =====
  if (inRange.length) {
    const totalVol = strength.reduce((s, x) => s + M.sessionVolume(x), 0);
    const volNum = el("div.metric.sm", { text: "0" });
    countUp(volNum, Math.round(weightValue(totalVol)), { dur: 900, fmt: (v) => Math.round(v).toLocaleString("en-GB") });
    const weeksActive = new Set(inRange.map((s) => s.weekNumber)).size;
    const liftedMini = el("div.card", {}, [
      el("div.label", { text: "Volume lifted" }),
      el("div.row", { style: "align-items:baseline;gap:4px;margin-top:8px" }, [
        volNum, el("span.unit", { style: "font-size:.8rem;color:var(--text-dim);font-weight:700", text: weightLabel() })]),
      el("div.note", { style: "margin-top:5px", text: rangeKey === "all" ? "all time" : "last " + rangeLabel() }),
      el("div.statgrid", { style: "margin-top:14px" }, [
        miniStat("Sessions", String(inRange.length)),
        miniStat("Weeks", String(weeksActive)),
      ]),
    ]);
    // weekly trend bar chart
    let trendMini;
    if (strength.length) {
      const byWeek = new Map();
      for (const s of strength) byWeek.set(s.weekNumber, (byWeek.get(s.weekNumber) || 0) + M.sessionVolume(s));
      const weeks = [...byWeek.keys()].sort((a, b) => a - b);
      const vals = weeks.map((w) => byWeek.get(w));
      const labels = weeks.map((w) => "W" + w);
      const last = vals[vals.length - 1], prev = vals.length > 1 ? vals[vals.length - 2] : null;
      // Don't compare an in-progress week against a completed one (misleading "decline").
      const curWeek = program ? M.weekNumberFor(program, M.todayISO()) : null;
      const lastInProgress = weeks[weeks.length - 1] === curWeek;
      trendMini = el("div.card", {}, [
        el("div.card-head", {}, [el("div.label", { text: "Weekly trend" }),
          lastInProgress ? null : (prev != null ? delta(weightValue(last) - weightValue(prev)) : null)]),
        barChart({ values: vals, labels, color: "accent", height: 104,
          tipText: (i) => `${labels[i]}: ${M.fmtWeight(Math.round(vals[i]))}` }),
      ]);
    } else {
      trendMini = el("div.card", {}, [el("div.label", { text: "Weekly trend" }),
        el("p.note", { style: "margin-top:10px", text: "No strength weeks in range." })]);
    }
    children.push(el("div.dualcard", {}, [liftedMini, trendMini]));
  } else {
    children.push(el("div.card", {}, [el("p.dim", { style: "margin:0", text: `No sessions in the last ${rangeLabel()}.` })]));
  }

  // ===== 6. strength trend — per-lift progression (est. 1RM, normalises rep ranges) =====
  // key by (exerciseId, weekday) so a lift trained on two days (e.g. incline
  // press Wed + Thu) tracks separately — matching the comparison engine's scope.
  const byKey = new Map(), daysPerEx = {};
  for (const s of strength) {
    for (const ex of s.strengthResult || []) {
      const key = ex.exerciseId + "|" + s.weekday;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ date: s.date, ex, loc: s.location, top: M.topSetWeight(ex), e1: bestE1(ex) });
      (daysPerEx[ex.exerciseId] = daysPerEx[ex.exerciseId] || new Set()).add(s.weekday);
    }
  }
  const progEquip = await equipmentForProgram(program);
  const lifts = [...byKey.entries()]
    .map(([key, occ]) => { const [exId, weekday] = key.split("|"); return { exId, weekday, occ: occ.sort((a, b) => (a.date < b.date ? -1 : 1)) }; })
    .filter((l) => l.occ.length >= 2 && l.occ.some((o) => o.e1 > 0))
    .map((l) => {
      const e1s = l.occ.map((o) => o.e1);
      const lastOcc = l.occ[l.occ.length - 1];
      const ceiling = loadCeiling((program.exercises[l.exId] || {}).implement, lastOcc.loc, progEquip);
      return { ...l, e1s, last: e1s[e1s.length - 1], change: e1s[e1s.length - 1] - e1s[0],
        lastTop: lastOcc.top, stall: detectStall(l.occ.map((o) => o.ex), ceiling), multiDay: daysPerEx[l.exId].size > 1 };
    })
    .sort((a, b) => b.change - a.change);

  if (lifts.length) {
    children.push(anchor("sec-strength", "Strength"));
    // strength standards (async fill) live with the rest of the strength section
    children.push(standardsCard);
    children.push(el("div.card-head", { style: "margin-top:6px" }, [
      el("h2", { style: "margin:0", text: "Strength trend" }),
      el("span.note", { text: "est. 1RM" }),
    ]));
    const list = el("div.list", {}, lifts.slice(0, 14).map((l) =>
      el("div.card.tight", {}, [
        el("div.row", { style: "gap:12px" }, [
          el("div", { style: "width:40px;height:40px;flex:none" }, [illustration(l.exId)]),
          el("div", { style: "flex:1;min-width:0" }, [
            el("div", { style: "font-weight:700;line-height:1.2", text: exName(program, l.exId) }),
            el("div.note", { text: `${M.fmtWeight(Math.round(l.last))} est. 1RM · ${M.fmtWeight(l.lastTop)} top · ${l.occ.length}×${l.multiDay ? " · " + l.weekday : ""}` }),
          ]),
          l.stall
            ? el("span.badge", { style: "color:var(--amber);background:rgba(251,191,36,.1);border-color:rgba(251,191,36,.3)", text: "⚠ stall" })
            : delta(weightValue(l.change)),
        ]),
        el("div", { style: "margin-top:8px" }, [sparkline({ values: l.e1s, color: "accent", height: 46, dots: true,
          tipText: (i) => `${prettyShort(l.occ[i].date)}: ${M.fmtWeight(Math.round(l.e1s[i]))}` })]),
        l.stall ? el("div.note", { style: "margin-top:6px;color:var(--amber)", text: l.stall.message }) : null,
      ])));
    children.push(list);
  }

  // (running pace lives above; bodyweight/waist/VO₂max/training-load/nutrition
  //  now live in the Body tab; aerobic-efficiency & interval-intensity removed.)

  // ===== 7. recent sessions =====
  const recent = [...inRange].reverse().slice(0, 6);
  if (recent.length) { children.push(anchor("sec-sessions", "Sessions")); children.push(el("h2", { text: "Recent sessions" })); }
  children.push(el("div.list", {}, recent.map((s) => {
    const sub = s.type === "cardio" && s.cardioResult
      ? `${distanceValue(s.cardioResult.distanceKm)} ${distanceLabel()} · ${M.fmtDuration(s.cardioResult.timeSeconds)}`
      : `${(s.strengthResult || []).length} exercises · ${M.fmtWeight(Math.round(M.sessionVolume(s)))}`;
    return el("button.item", { onclick: () => go(`#/summary/${s.id}`), style: "text-align:left" }, [
      el("div.ico", {}, [illustration(s.type === "cardio" ? "run" : "barbell")]),
      el("div.meta", {}, [
        el("div.t", {}, [`${prettyShort(s.date)} `, el("span.faint", { text: `· Wk${s.weekNumber}` })]),
        el("div.s", { text: sub }),
      ]),
      locationBadge(s.location),
    ]);
  })));
  if (logged.length > recent.length)
    children.push(el("button.btn.block", { style: "margin-top:10px", onclick: () => go("#/history") }, "All sessions →"));
  children.push(el("button.btn.block", { style: "margin-top:8px", onclick: () => go("#/records") }, "🏆 Personal records →"));

  // sticky jump-chips under the range selector — one per section that rendered
  if (secs.length > 1) {
    children.splice(2, 0, el("div.jumpchips", {}, secs.map((sec) =>
      el("button.jchip", { onclick: () => {
        const t = document.getElementById(sec.id);
        if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
      } }, sec.label))));
  }
  mount(children);
  fillStandards(standardsCard);        // async: e1RM vs bodyweight standards (fixed 8-week window)
}

// --- Body / Composition tab -------------------------------------------------
// Everything about the body itself: the recomposition verdict (headline), the
// DEXA scan read, bodyweight, tape measurements (waist + chest/arm/thigh),
// nutrition, and the fitness/recovery markers (VO₂max, WHOOP training load).
export async function renderComposition() {
  const { logged } = await scopedSessions();
  if (!logged.length) return emptyState("Body");

  const children = [el("h1", { text: "Body" }), rangeSeg(renderComposition)];
  const cutoff = cutoffISO((RANGES.find((r) => r.key === rangeKey) || RANGES[3]).days);
  const inWindow = (iso) => !cutoff || iso >= cutoff;
  const inRange = logged.filter((s) => inWindow(s.date));

  // ===== recomp scorecard — the headline body read (filled after mount) =====
  const recompCard = el("div.card.featured", { style: "display:none" });
  children.push(recompCard);

  // ===== bodyweight (directly under recomp) — the full arc, drawing every
  //   weigh-in logged across ALL blocks (not just the active one). A tracker's
  //   API typically exposes only the LATEST weight rather than a history, so the
  //   curve is the goal baseline (when one is set) + your own weigh-ins. =====
  const bwProfile = await getProfile();
  const bwGoal = goalConfig(bwProfile);
  const wByDate = new Map();
  try { for (const e of await getWeightLog()) if (e && e.kg) wByDate.set(e.date, e.kg); } catch {}   // tracker/manual history
  for (const s of await getAllSessions()) {   // in-app weigh-ins (authoritative for their date)
    if (s.sessionNotes && s.sessionNotes.bodyweightKg) wByDate.set(s.date, s.sessionNotes.bodyweightKg);
  }
  // Anchor the curve at the goal baseline so the first weigh-in isn't the origin.
  if (bwGoal && bwGoal.startISO && !wByDate.has(bwGoal.startISO)) wByDate.set(bwGoal.startISO, bwGoal.startKg);
  const bw = [...wByDate.entries()].map(([date, kg]) => ({ date, kg }))
    .filter((p) => inWindow(p.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (bw.length >= 1 && bwProfile && bwProfile.features.weight) {
    const vals = bw.map((b) => b.kg);
    const lastB = vals[vals.length - 1], firstB = vals[0];
    const toGoal = bwGoal ? lastB - bwGoal.goalKg : null;
    children.push(el("div.card.flush", {}, [
      sectionHead("Bodyweight", bw.length > 1
        ? delta(weightValue(lastB) - weightValue(firstB), { goodIfPositive: false, fmt: (v) => `${v.toFixed(1)} ${weightLabel()}` }) : null),
      el("div.row", { style: "align-items:baseline;gap:5px;padding:0 2px 6px" }, [
        el("div.metric.sm", { text: M.fmtWeight(lastB, { withUnit: false }) }), el("span.unit", { text: weightLabel() }),
      ]),
      bw.length > 1 ? sparkline({ values: vals, color: "violet", height: 70, gridIdx: weekBoundaries(bw.map((b) => b.date)),
        tipText: (i) => `${prettyShort(bw[i].date)}: ${M.fmtWeight(vals[i])}` }) : null,
      bwGoal ? el("div.row", { style: "margin-top:8px;align-items:baseline" }, [
        el("span.note", { text: `Goal ${M.fmtWeight(bwGoal.goalKg)}` }), el("span.spacer"),
        el("span.dim", { style: "font-size:.82rem;font-variant-numeric:tabular-nums", text: toGoal > 0.1 ? `${weightValue(toGoal).toFixed(1)} ${weightLabel()} to go` : "reached ✓" })]) : null,
      el("div.note", { style: "margin-top:6px", text: rangeKey === "all" && bwGoal
        ? `Since ${bwGoal.startLabel} · imported history + in-app weigh-ins.`
        : `Last ${rangeLabel()} · imported history + in-app weigh-ins.` }),
    ]));
  }

  // ===== DEXA body composition (gold-standard periodic scan; filled after mount) =====
  const dexaCard = el("div.card", { style: "display:none" });
  children.push(dexaCard);

  // ===== tape measurements — waist (fat signal) + chest/arm/thigh (muscle) =====
  try {
    const ml = (await getMeasurementsLog()).filter((e) => inWindow(e.date));
    const series = (f) => ml.filter((e) => e[f] != null).map((e) => ({ date: e.date, v: e[f] }));
    const waist = series("waistCm");
    if (waist.length >= 1) {
      const wv = waist.map((e) => e.v), lastW = wv[wv.length - 1];
      children.push(el("div.card.flush", {}, [
        sectionHead("Waist", waist.length > 1
          ? delta(lengthValue(lastW) - lengthValue(wv[0]), { goodIfPositive: false, fmt: (v) => `${v.toFixed(1)} ${lengthLabel()}` }) : null),
        el("div.row", { style: "align-items:baseline;gap:5px;padding:0 2px 6px" }, [
          el("div.metric.sm", { text: lengthValue(lastW).toFixed(1) }), el("span.unit", { text: lengthLabel() })]),
        waist.length > 1 ? sparkline({ values: wv, color: "cyan", height: 70, gridIdx: weekBoundaries(waist.map((e) => e.date)),
          tipText: (i) => `${prettyShort(waist[i].date)}: ${lengthValue(wv[i])} ${lengthLabel()}` }) : null,
        el("div.note", { style: "margin-top:8px", text: "Waist down at steady weight = recomp working. Add readings in Profile → Measurements." }),
      ]));
    }
    // chest / arm / thigh — muscle-holding signals; a compact row each (hold or up = good)
    const muscleDims = [["chestCm", "Chest"], ["armCm", "Arm"], ["thighCm", "Thigh"]]
      .map(([f, label]) => ({ label, s: series(f) })).filter((x) => x.s.length);
    if (muscleDims.length) {
      children.push(el("div.card.flush", {}, [
        el("div.label", { style: "margin-bottom:4px", text: "Tape · muscle" }),
        ...muscleDims.map((x) => {
          const v = x.s.map((e) => e.v), lastV = v[v.length - 1];
          const d = x.s.length > 1 ? lastV - v[0] : null;
          return el("div.row", { style: "align-items:baseline;margin-top:9px" }, [
            el("span", { style: "font-weight:700", text: x.label }), el("span.spacer"),
            el("span.dim", { style: "font-variant-numeric:tabular-nums;font-size:.9rem", text: `${lengthValue(lastV).toFixed(1)} ${lengthLabel()}` }),
            d != null ? delta(lengthValue(d), { goodIfPositive: true, fmt: (n) => `${n.toFixed(1)} ${lengthLabel()}` }) : null,
          ]);
        }),
        el("div.note", { style: "margin-top:10px", text: "Holding or growing while the waist drops = you're keeping muscle through the cut." }),
      ]));
    }
  } catch { /* no measurements yet */ }

  // ===== nutrition — energy balance in vs WHOOP burn (filled after mount) =====
  const nutritionCard = el("div.card.flush", { style: "display:none" });
  children.push(nutritionCard);

  // ===== VO₂max (from WHOOP) — cardio-fitness marker, moved here from Progress =====
  const vo2log = (await getVO2maxLog()).filter((e) => inWindow(e.date));
  if (vo2log.length) {
    const vals = vo2log.map((e) => e.value);
    const latest = vo2log[vo2log.length - 1];
    const vInner = [sectionHead("VO₂max",
      vals.length > 1 ? delta(vals[vals.length - 1] - vals[0], { fmt: (v) => v.toFixed(1) }) : null)];
    vInner.push(el("div.row", { style: "align-items:baseline;gap:6px;padding:0 2px 6px" }, [
      el("div.metric.sm", { text: latest.value.toFixed(1) }), el("span.unit", { text: "ml/kg/min" })]));
    if (vals.length > 1) vInner.push(sparkline({ values: vals, color: "cyan", height: 70, dots: true,
      gridIdx: weekBoundaries(vo2log.map((e) => e.date)),
      tipText: (i) => `${prettyShort(vo2log[i].date)}: ${vals[i].toFixed(1)}` }));
    vInner.push(el("div.note", { style: "margin-top:10px", text: `From Whoop · updated ${latest.date}.` }));
    children.push(el("div.card.flush", {}, vInner));
  }

  // ===== training load (WHOOP acute:chronic strain; filled after mount) — moved from Progress =====
  const loadCard = el("div.card.flush", { style: "display:none" });
  children.push(loadCard);

  mount(children);
  fillRecomp(recompCard, inRange, cutoff);   // async: waist/bodyweight × strength × energy balance
  fillDexa(dexaCard);                        // async: latest DEXA scan + change vs prior
  fillNutrition(nutritionCard, cutoff);      // async: calories in vs WHOOP burn
  fillLoad(loadCard);                        // async: WHOOP strain acute:chronic (always current)
}

function miniStat(label, value) {
  return el("div", {}, [
    el("div.metric.sm", { text: value }),
    el("div.label", { style: "margin-top:5px", text: label }),
  ]);
}

/**
 * Name the gap a yoga practice left in the week's hard sets.
 *
 * Only speaks when a practice actually STOOD IN FOR a lifting day — a standalone
 * practice or one that replaced the mobility work costs the week nothing and
 * saying otherwise would be noise. When it does speak it names the muscles that
 * are actually short, because "you did yoga instead" is a fact and "back and
 * quads are under their floor this week" is the useful version of it.
 */
async function yogaGapNote(program, curWeek, loggedSets) {
  if (!program || !curWeek) return null;
  const { getYogaLog } = await import("../store.js");
  const { intentById } = await import("../yoga/intents.js");
  const log = await getYogaLog();
  if (!log.length) return null;
  // The ISO dates covered by the current program week.
  const start = addDaysLocal(program.startDate, (curWeek - 1) * 7);
  const end = addDaysLocal(start, 6);
  const thisWeek = log.filter((e) => e.date >= start && e.date <= end);
  if (!thisWeek.length) return null;
  const substituting = thisWeek.filter((e) => e.substitutes === "strength");
  const short = MUSCLES.filter((m) => LANDMARKS[m] && (loggedSets[m] || 0) < LANDMARKS[m].mev);

  const lines = [];
  lines.push(el("p.note", { text: `${thisWeek.length} yoga practice${thisWeek.length === 1 ? "" : "s"} this week: ` +
    thisWeek.map((e) => `${(intentById(e.intent) || {}).label || e.intent} (${e.minutes} min)`).join(", ") + "." }));
  if (substituting.length) {
    lines.push(el("p.note", { text: "Counted for adherence. It contributes no hard sets, so the bars above are the real dose — a vigorous flow is a session, not an equivalent one." }));
    if (short.length) {
      lines.push(el("p.note.bad", { text: `Below the growth floor this week: ${short.join(", ")}.` }));
    }
  } else {
    lines.push(el("p.note", { text: "None of them stood in for a lifting day, so the week's hard sets are unaffected." }));
  }
  return el("div.card", {}, [el("h2", { text: "Yoga this week" }), ...lines]);
}

function addDaysLocal(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

// Front + back body silhouette, each muscle region tinted by its weekly-volume
// status (Fitbod-style — the body is its own legend). statusOf(muscle) →
// 'under' | 'in' | 'over' | 'none'. Reuses the volume.js landmark judgment.
function bodyHeatmap(statusOf) {
  const C = { under: "#2b6f86", in: "var(--accent)", over: "var(--amber)", none: "#2b313b" };
  const f = (m) => C[statusOf(m)] || C.none;
  const svg = `<svg viewBox="0 0 240 222" width="100%" style="max-width:330px;margin:0 auto;display:block" xmlns="http://www.w3.org/2000/svg">
    <g stroke="#0a0b0e" stroke-width="1.2">
      <circle cx="60" cy="20" r="11" fill="#2b313b"/>
      <ellipse cx="40" cy="44" rx="11" ry="8" fill="${f("Shoulders")}"/><ellipse cx="80" cy="44" rx="11" ry="8" fill="${f("Shoulders")}"/>
      <rect x="46" y="48" width="13" height="16" rx="5" fill="${f("Chest")}"/><rect x="61" y="48" width="13" height="16" rx="5" fill="${f("Chest")}"/>
      <ellipse cx="31" cy="62" rx="6" ry="13" fill="${f("Biceps")}"/><ellipse cx="89" cy="62" rx="6" ry="13" fill="${f("Biceps")}"/>
      <rect x="50" y="66" width="20" height="24" rx="5" fill="${f("Core")}"/>
      <ellipse cx="52" cy="118" rx="9" ry="24" fill="${f("Quads")}"/><ellipse cx="68" cy="118" rx="9" ry="24" fill="${f("Quads")}"/>
      <ellipse cx="52" cy="166" rx="7" ry="18" fill="${f("Calves")}"/><ellipse cx="68" cy="166" rx="7" ry="18" fill="${f("Calves")}"/>
    </g>
    <text x="60" y="214" fill="#8b93a1" font-size="9" text-anchor="middle" font-weight="700">FRONT</text>
    <g stroke="#0a0b0e" stroke-width="1.2">
      <circle cx="180" cy="20" r="11" fill="#2b313b"/>
      <ellipse cx="160" cy="44" rx="11" ry="8" fill="${f("Shoulders")}"/><ellipse cx="200" cy="44" rx="11" ry="8" fill="${f("Shoulders")}"/>
      <path d="M168 48 h24 a6 6 0 0 1 6 6 l-3 28 a30 30 0 0 1 -30 0 l-3 -28 a6 6 0 0 1 6 -6 z" fill="${f("Back")}"/>
      <ellipse cx="151" cy="62" rx="6" ry="13" fill="${f("Triceps")}"/><ellipse cx="209" cy="62" rx="6" ry="13" fill="${f("Triceps")}"/>
      <ellipse cx="172" cy="92" rx="9" ry="9" fill="${f("Glutes")}"/><ellipse cx="188" cy="92" rx="9" ry="9" fill="${f("Glutes")}"/>
      <ellipse cx="172" cy="124" rx="9" ry="22" fill="${f("Hamstrings")}"/><ellipse cx="188" cy="124" rx="9" ry="22" fill="${f("Hamstrings")}"/>
      <ellipse cx="172" cy="168" rx="7" ry="18" fill="${f("Calves")}"/><ellipse cx="188" cy="168" rx="7" ry="18" fill="${f("Calves")}"/>
    </g>
    <text x="180" y="214" fill="#8b93a1" font-size="9" text-anchor="middle" font-weight="700">BACK</text>
  </svg>`;
  const leg = (c, label) => el("span", { style: "display:inline-flex;align-items:center;gap:6px;font-size:.72rem;color:var(--text-dim)" }, [
    el("span", { style: `width:11px;height:11px;border-radius:3px;background:${c}` }), el("span", { text: label }),
  ]);
  return el("div", { style: "display:flex;flex-direction:column;gap:10px" }, [
    el("div", { html: svg }),
    el("div.row", { style: "gap:16px;justify-content:center;flex-wrap:wrap" }, [
      leg("#2b6f86", "Under MEV"), leg("var(--accent)", "Productive"), leg("var(--amber)", "Over MAV"),
    ]),
  ]);
}

function volRow(muscle, logged, planned) {
  const L = LANDMARKS[muscle] || { mev: 0, mav: 0 };
  const max = Math.max(L.mav * 1.35, planned * 1.1, logged * 1.1, 1);
  const pct = (v) => Math.max(0, Math.min(100, (v / max) * 100));
  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  // The chip rates the PROGRAM'S planned weekly DOSE vs the productive range — not
  // completion — so word it as a dose ("light/productive/high"), never "on target"
  // (which reads like a progress verdict next to the logged/planned count).
  const st = landmarkStatus(muscle, planned);
  const chipText = st === "under" ? "light" : st === "over" ? "high" : "productive";
  return el("div.volrow", {}, [
    el("div.volhead", {}, [
      el("span.volname", { text: muscle }), el("span.spacer"),
      el("span.volnum", { text: `${fmt(logged)} / ${fmt(planned)}` }),
      el("span.volchip." + st, { text: chipText }),
    ]),
    el("div.voltrack", {}, [
      el("div.volband", { style: `left:${pct(L.mev)}%;right:${100 - pct(L.mav)}%` }),
      el("div.volfill", { style: `width:${pct(logged)}%` }),
      el("div.voltick", { style: `left:${pct(planned)}%` }),
    ]),
  ]);
}
