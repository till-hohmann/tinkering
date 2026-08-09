// cardio.js — cardio is split into two phases so Whoop can finalize while you
// stretch:
//   runCardioCore() — the run plan + guided segment timer; returns tracked
//                     moving-time (seconds) or null. Shown in the core phase.
//   logCardio()     — the run-details form (distance/HR/RPE/time). Shown AFTER
//                     the cool-down, so the Whoop numbers are final.

import { el, clear } from "../ui.js";
import { icon } from "../icons.js";
import { illustration } from "../illustrations.js";
import { previousCardio, getZoneBounds, cardioHistory, cardioHistoryAcross, getLastCardioModality, setLastCardioModality } from "../store.js";
import { runPlayer } from "../components/runplayer.js";
import { muteToggle, unlockAudio } from "../components/sound.js";
import { interruptSheet } from "../components/interrupt.js";
import { segmentTarget, zoneForHR, nextCardioTarget, DEFAULT_ZONE_BOUNDS,
  CARDIO_MODALITIES, modalityFromSport, classifyRun } from "../cardio-intel.js";

// One plain-language line telling you the SHAPE of the session — intervals vs a
// single continuous effort — so "am I doing intervals or one run?" is never a
// question. Derived from the prescription via the same classifier the engine uses.
function runStructure(prescription) {
  const c = classifyRun(prescription || "");
  if (c.kind === "interval") return { icon: "⚡", text: `Intervals — ${c.reps || "several"} hard efforts with recoveries` };
  if (c.kind === "tempo") return { icon: "▬", text: "One continuous tempo effort (no intervals)" };
  return { icon: "▬", text: c.deload ? "One continuous easy run" : "One continuous steady run (no intervals)" };
}
import { bestWorkoutFor, provider, has, CAP } from "../health/index.js";
import { isDeloadWeek } from "../progression.js";
import { distanceLabel, distanceValue, distanceToKm } from "../units.js";
import * as M from "../model.js";

// Deload/taper flag for the week governing this date — cardio backs off in the
// same weeks strength does (the prescription text usually says so too, but the
// week phase is authoritative).
const deloadFor = (program, iso) =>
  isDeloadWeek((program.weeks || []).find((w) => w.weekNumber === M.weekNumberFor(program, iso)));

// Parse a run prescription into timed segments. Handles WU/CD, "KxM hard / S easy"
// intervals, "M min continuous" tempo, and plain "N min" Zone-2 steady runs. Each
// segment is tagged with its target HR zone (segmentTarget) so the run player can
// show a live band — pass the user's zone bounds to anchor the bpm numbers.
export function parseRunSegments(prescription, bounds = DEFAULT_ZONE_BOUNDS) {
  const txt = String(prescription || "");
  const toSec = (v, u) => (/s/i.test(u) && !/min/i.test(u) ? Number(v) : Number(v) * 60);
  const rpeM = txt.match(/RPE\s*(\d+\s*[-–]\s*\d+|\d+)/i);
  const rpe = rpeM ? rpeM[1].replace(/\s/g, "") : null;
  const segs = [];

  const wu = txt.match(/WU\s*(\d+)\s*min/i);
  if (wu) segs.push({ kind: "warmup", label: "Warm-up jog", seconds: +wu[1] * 60, cue: "easy-jog" });

  const iv = txt.match(/(\d+)\s*[x×]\s*(\d+)\s*(min|s)[^/]*?\/\s*(\d+)\s*(min|s)\s*easy/i);
  const tempo = txt.match(/(\d+)(?:\s*[-–]\s*\d+)?\s*min\s*(?:continuous|tempo|zone\s*3)/i);
  if (iv) {
    // a steady Zone-2 block BEFORE the reps (the Block-2+ "long run + strides"
    // structure: e.g. "Zone 2 42 min … then 6 x 20 s strides / 40 s easy")
    const steadyPre = txt.match(/zone\s*2\D{0,12}?(\d+)\s*min/i);
    if (steadyPre) segs.push({ kind: "steady", label: "Zone 2", seconds: +steadyPre[1] * 60, cue: "easy-jog" });
    const reps = +iv[1], hard = toSec(iv[2], iv[3]), easy = toSec(iv[4], iv[5]);
    for (let r = 1; r <= reps; r++) {
      segs.push({ kind: "hard", label: `Hard ${r}/${reps}`, seconds: hard, cue: "speed-up" });
      if (r < reps) segs.push({ kind: "easy", label: "Easy", seconds: easy, cue: "slow-down" });
    }
  } else if (tempo) {
    segs.push({ kind: "tempo", label: "Tempo", seconds: +tempo[1] * 60, cue: "speed-up" });
  } else {
    const main = txt.replace(/WU\s*\d+\s*min/i, "").replace(/CD\s*\d+\s*min/i, "").match(/(\d+)(?:\s*[-–]\s*\d+)?\s*min/i);
    if (main && !wu) segs.push({ kind: "steady", label: "Zone 2", seconds: +main[1] * 60, cue: "easy-jog" });
  }

  const cd = txt.match(/CD\s*(\d+)\s*min/i);
  if (cd) segs.push({ kind: "cooldown", label: "Cool-down", seconds: +cd[1] * 60, cue: "cool-down" });

  // tag each segment with its target HR band (RPE from the prescription wins for hard reps)
  for (const s of segs) s.target = segmentTarget(s.kind, bounds, s.kind === "hard" ? rpe : null);
  return segs;
}

const fmtSeg = (s) => { const m = Math.floor(s / 60), sec = s % 60; return sec ? `${m}:${String(sec).padStart(2, "0")}` : `${m} min`; };

// X button on a cardio screen → leave the workout. Save-for-later / discard
// (and, on the log screen, complete-now which saves what's entered).
async function cardioExit(onExit, canComplete, onCompleteSave) {
  const kind = await interruptSheet({ canComplete });
  if (kind === "continue") return;
  if (kind === "complete" && onCompleteSave) return onCompleteSave();
  onExit && onExit(kind);
}

// --- core phase: plan + guided run (returns tracked seconds, or null) -----
export async function runCardioCore(container, program, day, weekday, iso, { onDone, onExit }) {
  const bounds = await getZoneBounds();
  const modality = await getLastCardioModality();
  const segments = parseRunSegments(day.prescription || "", bounds);
  let history = await cardioHistory(program.id, weekday, iso);
  if (!history.length) history = await cardioHistoryAcross(weekday, iso);   // new-block seed: targets carry across the handover
  const target = nextCardioTarget({ prescription: day.prescription || "", history, bounds, deload: deloadFor(program, iso), modality });

  clear(container);
  container.appendChild(el("div.routine-head", {}, [
    el("button.btn.ghost", { style: "padding:0", "aria-label": "Leave workout", onclick: () => cardioExit(onExit, false) }, "✕"),
    el("span.spacer"), muteToggle(), el("span.badge.cyan", { text: "Run" }),
  ]));
  const structure = runStructure(day.prescription);
  container.appendChild(el("div.row", { style: "gap:12px" }, [
    el("div.illotile", { style: "width:44px;height:44px;flex:none;padding:0" }, [illustration("run")]),
    el("div", { style: "min-width:0" }, [
      el("h2", { style: "margin:0", text: "Today's run" }),
      el("div.note", { style: "margin-top:2px" }, [`${structure.icon} ${structure.text}`]),
    ]),
  ]));
  container.appendChild(el("div.card.tight", { style: "margin-top:12px" }, [
    el("p.note", { style: "margin:0", text: day.prescription || "" })]));

  // today's HR target — the coaching nudge that fixes the "intervals never hit the zone" miss
  container.appendChild(el("div.card.hrtarget", { style: "margin-top:10px" }, [
    el("div.row", { style: "align-items:center;gap:8px" }, [
      el("span.zchip.z" + target.zone.z, { text: "Z" + target.zone.z }),
      el("div", {}, [
        el("div.label", { text: "Target" }),
        el("div", { style: "font-weight:700;margin-top:2px", text: target.headline }),
      ]),
    ]),
    target.lastVerdict ? el("p.note." + (target.verdictCls === "under" ? "warn" : ""),
      { style: "margin:10px 0 0", text: target.lastVerdict }) : null,
  ]));

  if (segments.length) {
    container.appendChild(el("div.label", { style: "margin:18px 2px 8px", text: "Segments" }));
    container.appendChild(el("div.list", {}, segments.map((s, i) =>
      el("div.setrow", {}, [
        el("span.n", { text: String(i + 1) }),
        el("span.val", { text: s.label }),
        el("span.zchip.sm.z" + s.target.z, { text: `${s.target.loBpm}-${s.target.hiBpm}` }),
        el("span.dim.tnum", { text: fmtSeg(s.seconds) }),
      ]))));
    container.appendChild(el("button.btn.primary.big.block", { style: "margin-top:16px",
      onclick: () => { unlockAudio(); runPlayer(container, segments, { onDone: (sec) => onDone && onDone(sec) }); } }, "Start guided run"));
    container.appendChild(el("button.btn.ghost.block", { style: "margin-top:8px", onclick: () => onDone && onDone(null) }, "Skip timer"));
    container.appendChild(el("p.note.center", { style: "margin-top:10px", text: "You'll add distance & heart rate after the cool-down." }));
  } else {
    container.appendChild(el("button.btn.primary.big.block", { style: "margin-top:16px", onclick: () => onDone && onDone(null) }, "Begin run"));
  }
}

// --- end phase: run details from Whoop (time pre-filled if tracked) -------
export async function logCardio(container, program, day, weekday, iso, { trackedSec, onComplete, onExit }) {
  const prev = await previousCardio(program.id, weekday, iso);
  const bounds = await getZoneBounds();
  let history = await cardioHistory(program.id, weekday, iso);
  if (!history.length) history = await cardioHistoryAcross(weekday, iso);   // new-block seed: targets carry across the handover
  let modality = await getLastCardioModality();
  // target depends on modality (distance creep + verdict prefer same-machine
  // history), so recompute it when the modality changes.
  let target = nextCardioTarget({ prescription: day.prescription || "", history, bounds, deload: deloadFor(program, iso), modality });
  const refreshTarget = () => {
    target = nextCardioTarget({ prescription: day.prescription || "", history, bounds, deload: deloadFor(program, iso), modality });
    updateInsight();
  };
  clear(container);

  // time as h : mm : ss number fields — iOS number pad has no ":" key, and
  // Monday Zone-2 runs can go over an hour.
  const totSec = trackedSec != null ? trackedSec : prev ? prev.cardioResult.timeSeconds : 0;
  const tStyle = "width:52px;text-align:center;font-size:1.2rem;font-weight:700;padding:10px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:10px;color:var(--text)";
  const hrIn = el("input", { type: "number", inputmode: "numeric", placeholder: "h",
    value: totSec ? String(Math.floor(totSec / 3600)) : "", style: tStyle });
  const minIn = el("input", { type: "number", inputmode: "numeric", placeholder: "min",
    value: totSec ? String(Math.floor((totSec % 3600) / 60)).padStart(2, "0") : "", style: tStyle });
  const secIn = el("input", { type: "number", inputmode: "numeric", placeholder: "sec", min: "0", max: "59",
    value: totSec ? String(totSec % 60).padStart(2, "0") : "", style: tStyle });
  const fields = {
    distance: el("input", { type: "text", inputmode: "decimal", placeholder: distanceLabel(),
      value: prev ? String(distanceValue(prev.cardioResult.distanceKm)) : "" }),
    hr: el("input", { type: "number", inputmode: "numeric", placeholder: "bpm",
      value: prev ? String(prev.cardioResult.avgHR) : "" }),
  };
  let rpe = prev ? prev.cardioResult.feltRPE : 7;

  const colon = () => el("span", { style: "font-weight:800;font-size:1.2rem", text: ":" });
  const timeRow = el("div.row", { style: "margin:12px 0" }, [
    el("div", {}, [el("div", { text: "Time" }), el("div.faint", { style: "font-size:.78rem", text: "hr : min : sec" })]),
    el("span.spacer"),
    el("div.row", { style: "gap:5px" }, [hrIn, colon(), minIn, colon(), secIn]),
  ]);

  function row(label, input, hint) {
    input.style.cssText = "width:130px;text-align:right;font-size:1.2rem;font-weight:700;padding:10px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:10px;color:var(--text)";
    return el("div.row", { style: "margin:12px 0" }, [
      el("div", {}, [el("div", { text: label }), hint ? el("div.faint", { style: "font-size:.78rem", text: hint }) : null]),
      el("span.spacer"), input,
    ]);
  }
  const rpeOut = el("strong.tnum", { text: String(rpe) });
  const rpeSlider = el("input", { type: "range", min: "1", max: "10", value: String(rpe), style: "flex:1" });
  rpeSlider.addEventListener("input", () => { rpe = Number(rpeSlider.value); rpeOut.textContent = String(rpe); });

  container.appendChild(el("div.routine-head", {}, [
    el("button.btn.ghost", { style: "padding:0", "aria-label": "Leave workout", onclick: () => cardioExit(onExit, true, save) }, "✕"),
    el("span.spacer"), el("span.badge.cyan", { text: "Run details" }),
  ]));
  container.appendChild(el("div.row", {}, [
    el("div.illotile", { style: "width:40px;height:40px;flex:none;padding:0" }, [illustration("run")]),
    el("h2", { style: "margin:0", text: "Add your run" }),
  ]));
  container.appendChild(el("p.note", { style: "margin:8px 2px 0",
    text: trackedSec != null ? `Tracked ${M.fmtDuration(trackedSec)} moving time. Add the Whoop numbers now they're final.` : "Enter your run from Whoop." }));

  // modality — run outdoor / treadmill / elliptical (tracked somewhat separately)
  const modSeg = el("div.segmented");
  CARDIO_MODALITIES.forEach((m) => {
    const b = el("button" + (m.id === modality ? ".on" : ""), { onclick: () => {
      modality = m.id;
      [...modSeg.children].forEach((c) => c.classList.toggle("on", c === b));
      refreshTarget();
    } }, m.label);
    modSeg.appendChild(b);
  });
  container.appendChild(el("div", { style: "margin-top:12px" }, [
    el("div.dim", { style: "margin-bottom:6px", text: "Type" }), modSeg,
  ]));

  // Optional one-tap auto-fill from whichever tracker is connected. The button
  // only appears when the active provider can actually supply workouts — with no
  // tracker there is nothing to pull, and a dead button is worse than none.
  const tracker = await provider();
  const canPull = await has(CAP.workouts);
  const whoopNote = el("p.note", { style: "margin:8px 2px 0;display:none" });
  const pullBtn = el("button.btn.block", { style: "margin-top:10px", onclick: pullFromWhoop }, `⟲ Pull from ${tracker.label}`);
  if (canPull) { container.appendChild(pullBtn); container.appendChild(whoopNote); }
  let whoopExtra = null;   // richer metrics captured from the tracker, persisted on save
  async function pullFromWhoop() {
    pullBtn.disabled = true; pullBtn.textContent = `Pulling from ${tracker.label}…`;
    try {
      const m = await bestWorkoutFor(iso);
      if (!m) {
        whoopNote.textContent = `No ${tracker.label} workout found for today yet.`;
        whoopNote.style.display = ""; return;
      }
      if (m.timeSeconds) {
        hrIn.value = String(Math.floor(m.timeSeconds / 3600));
        minIn.value = String(Math.floor((m.timeSeconds % 3600) / 60)).padStart(2, "0");
        secIn.value = String(m.timeSeconds % 60).padStart(2, "0");
      }
      if (m.distanceKm != null) fields.distance.value = String(distanceValue(m.distanceKm));
      if (m.avgHR != null) fields.hr.value = String(m.avgHR);
      whoopExtra = { source: m.source || tracker.id, maxHR: m.maxHR, zoneMins: m.zoneMins, strain: m.strain, whoopSport: m.sport };
      if (m.sport) {   // let the tracker's sport pick the modality (elliptical/treadmill/run)
        modality = modalityFromSport(m.sport);
        [...modSeg.children].forEach((c, i) => c.classList.toggle("on", CARDIO_MODALITIES[i].id === modality));
      }
      refreshTarget();
      const z4 = m.zoneMins && m.zoneMins[4], z5 = m.zoneMins && m.zoneMins[5];
      const hardMin = (z4 || 0) + (z5 || 0);
      whoopNote.innerHTML = `<span style="color:var(--accent)">●</span> Filled from ${tracker.label}${m.sport ? " (" + m.sport + ")" : ""}` +
        (m.maxHR ? ` · max ${m.maxHR} bpm` : "") +
        (hardMin ? ` · ${hardMin} min in Zone 4-5` : "") +
        (m.strain != null ? ` · strain ${m.strain}` : "");
      whoopNote.style.display = "";
    } catch (e) {
      whoopNote.textContent = /401|not_linked/.test(e.message || "") ? `Connect ${tracker.label} in Profile first.` : `${tracker.label}: ` + (e.message || "couldn't load");
      whoopNote.style.display = "";
    } finally { pullBtn.disabled = false; pullBtn.textContent = `⟲ Pull from ${tracker.label}`; }
  }

  container.appendChild(timeRow);
  container.appendChild(row("Distance", fields.distance, distanceLabel()));
  container.appendChild(row("Avg HR", fields.hr, "bpm"));

  // live insight: which zone the avg HR landed in vs today's target, plus a
  // VO2max estimate once distance/time/HR are all in. Updates as you type.
  const insight = el("div.card.hrtarget", { style: "margin:6px 0 2px;display:none" });
  function reading() {
    return {
      timeSeconds: (Number(hrIn.value) || 0) * 3600 + (Number(minIn.value) || 0) * 60 + (Number(secIn.value) || 0),
      distanceKm: distanceToKm(M.parseNum(fields.distance.value)) ?? 0,   // typed in the display unit, stored in km
      avgHR: Math.round(M.parseNum(fields.hr.value)),
    };
  }
  function updateInsight() {
    const c = reading();
    if (!c.avgHR) { insight.style.display = "none"; return; }
    clear(insight);
    let chipZ, label, line;
    const z = zoneForHR(c.avgHR, bounds);
    if (target.kind === "interval") {
      // Interval days are judged by real time in Zone 4-5, never by the
      // whole-run average — that blends the recoveries in and always reads low.
      const zm = whoopExtra && whoopExtra.zoneMins;
      const hardMin = zm ? (zm[4] || 0) + (zm[5] || 0) : null;
      if (hardMin != null) {
        const need = target.needHardMin || 6;
        const planned = target.plannedHardMin ? ` of ~${target.plannedHardMin} prescribed` : "";
        chipZ = 4; label = "Time in Zone 4-5";
        line = hardMin >= need
          ? `${hardMin} min${planned} — the hard reps reached the zone.`
          : `${hardMin} min${planned} — the hard reps fell short of ${target.hrBand[0]}-${target.hrBand[1]} bpm.`;
      } else {
        chipZ = z.z; label = `Avg HR · Zone ${z.z} ${z.name}`;
        line = `${c.avgHR} bpm avg — includes the recoveries. Pull time-in-zone from your tracker to judge the hard reps.`;
      }
    } else {
      const inBand = c.avgHR >= target.hrBand[0] && c.avgHR <= target.hrBand[1];
      const under = c.avgHR < target.hrBand[0];
      chipZ = z.z; label = `Avg HR · Zone ${z.z} ${z.name}`;
      const verdict = inBand ? "on target"
        : under && target.deload ? "nice and easy — exactly right for a deload"
        : under ? `under target (Z${target.zone.z} is ${target.hrBand[0]}-${target.hrBand[1]})`
        : `above target (Z${target.zone.z} is ${target.hrBand[0]}-${target.hrBand[1]})`;
      line = `${c.avgHR} bpm — ${verdict}`;
    }
    insight.appendChild(el("div.row", { style: "align-items:center;gap:8px" }, [
      el("span.zchip.z" + chipZ, { text: "Z" + chipZ }),
      el("div", {}, [
        el("div.label", { text: label }),
        el("div", { style: "font-weight:700;margin-top:2px", text: line }),
      ]),
    ]));
    insight.style.display = "";
  }
  [hrIn, minIn, secIn, fields.distance, fields.hr].forEach((i) => i.addEventListener("input", updateInsight));
  container.appendChild(insight);

  container.appendChild(el("div", { style: "margin:16px 0" }, [
    el("div.row", {}, [el("div", { text: "Felt (RPE)" }), el("span.spacer"), rpeOut]), rpeSlider,
  ]));
  if (prev) {
    const c = prev.cardioResult;
    container.appendChild(el("p.note", { text: `Last ${weekday}: ${c.distanceKm} km · ${M.fmtDuration(c.timeSeconds)} · HR ${c.avgHR} · pace ${M.fmtPace(M.paceSecPerKm(c))}` }));
  }
  container.appendChild(el("button.btn.primary.big.block", { style: "margin-top:14px", onclick: save }, "Save run"));
  updateInsight();

  function save() {
    setLastCardioModality(modality);
    onComplete && onComplete({
      timeSeconds: (Number(hrIn.value) || 0) * 3600 + (Number(minIn.value) || 0) * 60 + (Number(secIn.value) || 0),
      distanceKm: distanceToKm(M.parseNum(fields.distance.value)) ?? 0,   // typed in the display unit, stored in km
      avgHR: Math.round(M.parseNum(fields.hr.value)),
      feltRPE: rpe,
      ...(whoopExtra || {}),   // max HR, per-zone minutes, strain, sport, source="whoop" (when pulled)
      modality,                // run_outdoor / run_treadmill / elliptical
    });
  }
}
