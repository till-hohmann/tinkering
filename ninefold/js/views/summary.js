// summary.js — post-session summary & celebration. Headline metric, per-exercise
// deltas vs the previous week, PRs, cardio comparison, a substitution note when
// the session was relocated, and an inline edit mode to fix logged sets.

import { getActiveProgram, getSession, saveSession, previousExercise, previousCardio, previousStrengthSession }
  from "../store.js";
import * as M from "../model.js";
import { el, mount, go, locationBadge, addActionBar, backBtn, countUp } from "../ui.js";
import { illustration } from "../illustrations.js";
import { metaFor } from "../substitution.js";
import { celebrate } from "../components/confetti.js";
import { strengthExportText } from "../whoop.js";
import { workoutsFor, provider, has, CAP } from "../health/index.js";
import { modalityLabel } from "../cardio-intel.js";

function exName(program, id) { return metaFor(program, id).name; }

function deltaChip(value, kind = "kg", goodIfPositive = true) {
  if (value == null || Math.abs(value) < (kind === "km" ? 0.005 : 0.5))
    return el("span.delta.flat", { text: "=" });
  const good = goodIfPositive ? value > 0 : value < 0;
  const sign = value > 0 ? "+" : "−";
  const mag = Math.abs(value);
  const body =
    kind === "kg" ? M.fmtWeight(mag) :
    kind === "km" ? mag.toFixed(2) + " km" :
    kind === "sec" ? Math.round(mag) + " s" :
    Math.round(mag) + " bpm";
  return el("span.delta." + (good ? "up" : "down"), { text: `${sign}${body}` });
}

export async function renderSummary(sessionId) {
  const session = await getSession(sessionId);
  const program = await getActiveProgram();
  if (!session) return mount([el("div.card", {}, [el("p", { text: "Session not found." }),
    el("button.btn.block", { onclick: () => go("#/progress") }, "Progress")])]);

  const isToday = session.date === M.todayISO();
  const backHref = isToday ? "#/" : "#/progress";
  const title = isToday
    ? (session.type === "cardio" ? "Run complete" : "Session complete")
    : prettyDate(session.date);

  // precompute comparisons once (independent of edit state)
  const prevByEx = {};
  let prevStrength = null, prevCardio = null;
  if (session.type === "strength") {
    prevStrength = await previousStrengthSession(program.id, session.weekday, session.date);
    for (const ex of session.strengthResult || [])
      prevByEx[ex.exerciseId] = await previousExercise(program.id, session.weekday, ex.exerciseId, session.date);
  } else if (session.cardioResult) {
    prevCardio = await previousCardio(program.id, session.weekday, session.date);
  }

  let editing = false, celebrated = false, cardioRefs = null;

  const canShare = (session.type === "strength" && (session.strengthResult || []).some((e) => e.sets && e.sets.length))
    || (session.type === "cardio" && !!session.cardioResult);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // A square share image of the session (Strava/Hevy-style). Pure SVG → canvas →
  // PNG, then navigator.share (files) with a download fallback. Colours hardcoded
  // since the rasterised SVG is standalone (CSS vars don't apply).
  function buildShareSVG() {
    const W = 1080, H = 1080;
    const bg = "#0a0b0e", card = "#14171d", line = "#23272f", ink = "#f1f4f9", dim = "#8b93a1", accent = "#2fe6a6", cyan = "#38bdf8";
    const disc = session.type === "cardio" ? cyan : accent;
    const ff = `font-family="system-ui,-apple-system,Segoe UI,sans-serif"`;
    let headline, unit, typeLabel, stats = [], lifts = [];
    if (session.type === "strength") {
      headline = Math.round(M.sessionVolume(session)).toLocaleString("en-GB"); unit = "kg lifted"; typeLabel = "STRENGTH";
      const setCount = (session.strengthResult || []).reduce((n, ex) => n + (ex.sets || []).length, 0);
      stats = [["Exercises", String((session.strengthResult || []).length)], ["Sets", String(setCount)], ["Week", String(session.weekNumber)]];
      lifts = (session.strengthResult || []).map((ex) => {
        const tops = (ex.sets || []).reduce((a, b) => ((Number(b.weightKg) || 0) > (Number(a.weightKg) || 0) ? b : a), ex.sets[0] || {});
        return { name: exName(program, ex.exerciseId), top: M.topSetWeight(ex), txt: ex.sets && ex.sets.length ? M.setDisplay(ex.implement, tops) : "" };
      }).sort((a, b) => b.top - a.top).slice(0, 4);
    } else {
      const c = session.cardioResult;
      headline = (c.distanceKm || 0).toFixed(2); unit = "km"; typeLabel = "RUN";
      stats = [["Time", M.fmtDuration(c.timeSeconds)], ["Pace", M.fmtPace(M.paceSecPerKm(c)).replace(" /km", "")], ["Avg HR", String(c.avgHR || "–")]];
    }
    const statCols = stats.map((s, i) => {
      const x = 120 + i * 290;
      return `<text x="${x}" y="648" fill="${ink}" font-size="56" font-weight="800" ${ff}>${esc(s[1])}</text>
        <text x="${x}" y="694" fill="${dim}" font-size="25" font-weight="700" letter-spacing="2" ${ff}>${esc(s[0].toUpperCase())}</text>`;
    }).join("");
    const liftRows = lifts.map((l, i) => {
      const y = 808 + i * 60;
      return `<text x="120" y="${y}" fill="${ink}" font-size="33" font-weight="700" ${ff}>${esc(l.name)}</text>
        <text x="960" y="${y}" fill="${disc}" font-size="31" font-weight="700" text-anchor="end" ${ff}>${esc(l.txt)}</text>`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect width="${W}" height="${H}" fill="${bg}"/>
      <rect x="40" y="40" width="${W - 80}" height="${H - 80}" rx="40" fill="${card}" stroke="${line}"/>
      <text x="120" y="152" fill="${disc}" font-size="40" font-weight="900" letter-spacing="2" ${ff}>NINEFOLD</text>
      <text x="960" y="152" fill="${dim}" font-size="29" font-weight="700" text-anchor="end" ${ff}>${esc(prettyDate(session.date))}</text>
      <text x="120" y="300" fill="${dim}" font-size="29" font-weight="700" letter-spacing="3" ${ff}>${typeLabel} · ${esc(session.location || "")}</text>
      <text x="116" y="490" fill="${ink}" font-size="190" font-weight="800" letter-spacing="-6" ${ff}>${esc(headline)}</text>
      <text x="120" y="552" fill="${disc}" font-size="40" font-weight="800" ${ff}>${esc(unit)}</text>
      ${statCols}${liftRows}
    </svg>`;
  }
  async function shareSession(btn) {
    const prev = btn && btn.textContent;
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    try {
      const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(buildShareSVG());
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const canvas = document.createElement("canvas");
      canvas.width = 1080; canvas.height = 1080;
      canvas.getContext("2d").drawImage(img, 0, 0, 1080, 1080);
      const png = await new Promise((res) => canvas.toBlob(res, "image/png"));
      const file = new File([png], `strong-${session.date}.png`, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: "Ninefold" });
      else { const a = document.createElement("a"); a.href = URL.createObjectURL(png); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
    } catch { /* cancelled / unsupported */ }
    finally { if (btn) { btn.disabled = false; btn.textContent = prev; } }
  }

  function cardioEditCard(c) {
    const inp = (v, mode) => el("input", { type: mode === "numeric" ? "number" : "text",
      inputmode: mode, value: String(v), style: editIn() });
    const h = inp(Math.floor(c.timeSeconds / 3600), "numeric");
    const m = inp(Math.floor((c.timeSeconds % 3600) / 60), "numeric");
    const s = inp(c.timeSeconds % 60, "numeric");
    const dist = inp(c.distanceKm, "decimal");
    const hr = inp(c.avgHR, "numeric");
    const rpe = inp(c.feltRPE, "numeric");
    cardioRefs = { h, m, s, dist, hr, rpe };
    const rowf = (label, ...nodes) => el("div.row", { style: "margin:12px 0;align-items:center" }, [
      el("div", { text: label }), el("span.spacer"), el("div.row", { style: "gap:6px;align-items:center" }, nodes)]);
    return el("div.card", {}, [
      el("div.label", { style: "margin-bottom:4px", text: "Edit run" }),
      rowf("Time", h, el("span.dim", { text: ":" }), m, el("span.dim", { text: ":" }), s),
      rowf("Distance", dist, el("span.dim", { text: "km" })),
      rowf("Avg HR", hr, el("span.dim", { text: "bpm" })),
      rowf("RPE", rpe),
    ]);
  }

  function head() {
    return el("div", {}, [
      backBtn(isToday ? "Today" : "Progress", backHref),
      el("div.row", {}, [
        el("h1", { text: title, style: "margin:0;flex:1;min-width:0" }),
        canShare && !editing ? el("button.btn.ghost", { style: "padding:7px 13px", "aria-label": "Share session", onclick: (e) => shareSession(e.currentTarget) }, "⤴ Share") : null,
      ]),
      el("div.row.wrap", { style: "margin-top:10px" }, [
        locationBadge(session.location),
        el("span.badge.accent", { text: `Week ${session.weekNumber} · ${session.weekday}` }),
        session.preRoutineDone ? el("span.badge", { text: "✓ warm-up" }) : null,
        session.postRoutineDone ? el("span.badge", { text: "✓ cool-down" }) : null,
      ]),
    ]);
  }

  function substitutionCard() {
    const su = session.substitution;
    if (!su || !(su.items || []).length) return null;
    return el("div.card.tight", { style: "border-left:3px solid var(--violet)" }, [
      el("div.row", { style: "gap:8px;margin-bottom:7px;align-items:center" }, [
        el("span.volchip.in", { style: "color:var(--violet);background:var(--violet-ghost)", text: "⇄ Substituted" }),
        el("div.note", { text: `Trained in ${su.actualLocation} (planned ${su.plannedLocation})` }),
      ]),
      el("div.list", {}, su.items.map((it) => el("div.note", {
        text: `${exName(program, it.originalId)} → ${exName(program, it.subId)}${it.approximate ? " (approx)" : ""}` }))),
    ]);
  }

  function draw() {
    const children = [head()];
    const sc = substitutionCard();
    if (sc) children.push(sc);
    if (session.finisher && session.finisher.done) {
      children.push(el("div.card.tight", {}, [el("div.row", {}, [
        el("span.badge.cyan", { text: "⚡ Intervals" }), el("span.spacer"),
        el("span.note", { text: `${session.finisher.rounds} × ${session.finisher.workSec}/${session.finisher.easySec}s — done` }),
      ])]));
    }
    let prs = [];

    if (session.type === "cardio" && session.cardioResult && editing) {
      children.push(cardioEditCard(session.cardioResult));
    } else if (session.type === "cardio" && session.cardioResult) {
      const c = session.cardioResult;
      const distNum = el("div.metric", { text: "0" });
      countUp(distNum, c.distanceKm, { fmt: (v) => v.toFixed(2) });
      children.push(el("div.card", {}, [
        el("div.row", {}, [el("div.label", { text: "Distance" }), el("span.spacer"),
          el("span.badge.cyan", { text: modalityLabel(c.modality) })]),
        el("div.row", { style: "align-items:baseline;gap:6px;margin-top:8px" }, [distNum, el("span.unit", { text: "km" })]),
        el("div.statgrid.three", { style: "margin-top:18px" }, [
          miniStat("Time", M.fmtDuration(c.timeSeconds)),
          miniStat("Pace", M.fmtPace(M.paceSecPerKm(c)).replace(" /km", "")),
          miniStat("Avg HR", `${c.avgHR}`),
        ]),
      ]));
      // WHOOP detail: max HR, strain, and time-in-zone (when the run was pulled in)
      if (c.source === "whoop" && (c.maxHR != null || c.strain != null || (c.zoneMins && c.zoneMins.some((m) => m)))) {
        const zoneChips = (c.zoneMins || []).map((m, z) => (m ? el("span.zchip.z" + z, { style: "margin:0 6px 6px 0", text: `Z${z} ${m}m` }) : null)).filter(Boolean);
        children.push(el("div.card", {}, [
          el("div.row", {}, [el("div.label", { text: "From WHOOP" }), el("span.spacer"),
            c.maxHR != null ? el("span.dim", { text: `max ${c.maxHR} · strain ${c.strain != null ? c.strain : "–"}` }) : null]),
          zoneChips.length ? el("div", { style: "margin-top:12px;display:flex;flex-wrap:wrap" }, zoneChips) : null,
        ]));
      }
      if (prevCardio) {
        const cmp = M.compareCardio(c, prevCardio.cardioResult);
        children.push(el("div.card", {}, [
          el("div.label", { text: `vs last ${session.weekday}` }),
          el("div.row.wrap", { style: "gap:16px;margin-top:14px;justify-content:space-around" }, [
            labelled("Distance", deltaChip(cmp.distanceDelta, "km", true)),
            labelled("Pace", deltaChip(cmp.paceDelta != null ? -cmp.paceDelta : null, "sec", true)),
            labelled("Avg HR", deltaChip(cmp.hrDelta, "bpm", false)),
          ]),
          el("p.note", { style: "margin-top:14px", text: cardioBlurb(cmp) }),
        ]));
      } else {
        children.push(el("p.note", { style: "margin-top:10px", text: "First time on this weekday — no comparison yet." }));
      }
    }

    if (session.type === "strength") {
      const total = M.sessionVolume(session);
      const prevTotal = prevStrength ? M.sessionVolume(prevStrength) : null;
      if (!editing && prevTotal != null && total > prevTotal) prs.push(`Session volume ${M.fmtWeight(Math.round(total))} (beat ${M.fmtWeight(Math.round(prevTotal))})`);

      const volNum = el("div.metric", { text: "0" });
      countUp(volNum, Math.round(total), { dur: 700, fmt: (v) => Math.round(v).toLocaleString("en-GB") });
      const setCount = (session.strengthResult || []).reduce((n, ex) => n + (ex.sets || []).length, 0);
      children.push(el("div.card", {}, [
        el("div.row", {}, [el("div.label", { text: "Total volume" }), el("span.spacer"),
          prevTotal != null ? deltaChip(total - prevTotal, "kg", true) : null]),
        el("div.row", { style: "align-items:baseline;gap:6px;margin-top:8px" }, [volNum, el("span.unit", { text: "kg" })]),
        el("div.statgrid.three", { style: "margin-top:18px" }, [
          miniStat("Exercises", String((session.strengthResult || []).length)),
          miniStat("Sets", String(setCount)),
          prevTotal != null ? miniStat(`Last ${session.weekday}`, M.fmtWeight(Math.round(prevTotal)).replace(" kg", "")) : miniStat("Status", "Logged"),
        ]),
      ]));

      // WHOOP feedback loop: export the lifts to WHOOP's Weightlifting AI, then
      // sync the strain WHOOP recalculates back onto this session.
      if (!editing && (session.strengthResult || []).some((e) => (e.sets || []).length)) {
        const wStatus = el("p.note", { style: "margin:8px 0 0;min-height:1em",
          text: session.whoopStrain != null ? `WHOOP strain ${session.whoopStrain} synced for this session.` : "" });
        const exportBtn = el("button.btn", { onclick: async () => {
          const txt = strengthExportText(session, (id) => exName(program, id));
          try {
            if (navigator.share) { await navigator.share({ text: txt }); wStatus.textContent = "Shared — paste into the WHOOP Weightlifting AI."; }
            else { await navigator.clipboard.writeText(txt); wStatus.textContent = "Copied — paste it into the WHOOP Weightlifting AI."; }
          } catch { try { await navigator.clipboard.writeText(txt); wStatus.textContent = "Copied to clipboard."; } catch {} }
        } }, "Export for WHOOP");
        const syncBtn = el("button.btn", { onclick: async () => {
          syncBtn.disabled = true; const old = syncBtn.textContent; syncBtn.textContent = "Syncing…";
          try {
            const ws = await workoutsFor(session.date);
            const m = (ws || []).find((w) => /weightlift|strength|lifting|functional|traditional/i.test(w.sport || ""));
            if (m && m.strain != null) {
              session.whoopStrain = m.strain; await saveSession(session);
              wStatus.textContent = `WHOOP strain ${m.strain} synced — it feeds your training-load trend.`;
            } else wStatus.textContent = "No WHOOP weightlifting workout for this day yet (enter the exercises in WHOOP first).";
          } catch (e) { wStatus.textContent = /401/.test(e.message || "") ? "Connect WHOOP in Profile first." : "WHOOP: " + (e.message || "error"); }
          finally { syncBtn.disabled = false; syncBtn.textContent = old; }
        } }, "Sync strain");
        children.push(el("div.card", {}, [
          el("div.label", { text: "WHOOP feedback loop" }),
          el("p.note", { style: "margin-top:4px", text: "Export your lifts to WHOOP's Weightlifting AI, then sync the strain it calculates back here." }),
          el("div.btn-row", { style: "margin-top:10px" }, [exportBtn, syncBtn]),
          wStatus,
        ]));
      }

      const editRefs = [];
      const exCards = (session.strengthResult || []).map((ex) => {
        const prev = prevByEx[ex.exerciseId];
        const top = M.topSetWeight(ex);
        let cmp = null;
        if (!editing && prev) {
          cmp = M.compareStrength(ex.implement, ex, prev.exercise);
          if (cmp.topSetDelta > 0) prs.push(`${exName(program, ex.exerciseId)} top set ${M.fmtWeight(top)}`);
          else if (cmp.volumeDelta > 0) prs.push(`${exName(program, ex.exerciseId)} volume up`);
        }
        const body = editing
          ? el("div.editsets", {}, [
              ...ex.sets.map((s, i) => {
                const timed = s.reps == null;
                const w = el("input", { type: "text", inputmode: "decimal", value: String(s.weightKg ?? 0), style: editIn() });
                const r = el("input", { type: "number", inputmode: "numeric", value: String(timed ? (s.seconds ?? 0) : (s.reps ?? 0)), style: editIn() });
                editRefs.push({ ex, i, w, r, timed });
                return el("div.editrow", {}, [
                  el("span.n", { text: "S" + (i + 1) }), w, el("span.dim", { text: "kg" }), r,
                  el("span.dim", { text: timed ? "s" : "reps" }),
                  el("button.btn.ghost", { style: "padding:4px 9px;margin-left:auto", title: "Remove set", onclick: () => removeSet(ex, i) }, "✕"),
                ]);
              }),
              el("button.btn.block", { style: "margin-top:8px", onclick: () => addSet(ex) }, "+ Add set"),
            ])
          : el("div.note", { style: "margin-top:2px", text: ex.sets.length ? ex.sets.map((s) => M.setDisplay(ex.implement, s)).join("   ") : "no sets" });
        return el("div.card.tight", {}, [
          el("div.row", { style: "gap:12px" }, [
            el("div", { style: "width:40px;height:40px;flex:none" }, [illustration(ex.exerciseId)]),
            el("div", { style: "flex:1;min-width:0" }, [
              el("div", { style: "font-weight:700", text: exName(program, ex.exerciseId) }),
              !editing ? body : null,
            ]),
            !editing && cmp ? deltaChip(cmp.topSetDelta, "kg", true) : null,
          ]),
          editing ? body : null,
        ]);
      });
      if (exCards.length) {
        children.push(el("h2", { text: "Exercises" }));
        children.push(el("div.list", {}, exCards));
      } else {
        children.push(el("div.card", { style: "margin-top:14px" }, [el("p.dim", { style: "margin:0", text: "No sets were logged for this session." })]));
      }
      draw._editRefs = editRefs;
    }

    const n = session.sessionNotes || {};
    if (!editing && (n.bodyweightKg || n.energySleep || n.niggles)) {
      children.push(el("div.card.tight", { style: "margin-top:14px" }, [
        el("div.label", { style: "margin-bottom:8px", text: "Notes" }),
        n.bodyweightKg ? kv("Bodyweight", `${n.bodyweightKg} kg`) : null,
        n.energySleep ? el("p.note", { text: n.energySleep }) : null,
        n.niggles ? el("p.note.warn", { text: "⚠ " + n.niggles }) : null,
      ]));
    }

    if (!editing && prs.length) {
      children.splice(sc ? 2 : 1, 0, el("div.card", { style: "border-color:rgba(47,230,166,.4);background:var(--accent-ghost);box-shadow:var(--glow)" }, [
        el("div.row", { style: "gap:8px;margin-bottom:8px" }, [
          el("span", { style: "font-size:1.3rem", text: "🎉" }),
          el("div.label", { style: "color:var(--accent)", text: "New records" }),
        ]),
        el("div.list", {}, prs.map((p) => el("div.note", { style: "color:var(--text)", text: "• " + p }))),
      ]));
    }

    mount(children);

    if (editing) {
      addActionBar(
        el("button.btn.block", { onclick: () => { editing = false; draw(); } }, "Cancel"),
        el("button.btn.primary.block", { onclick: saveEdits }, "Save changes"),
      );
    } else {
      const actions = [el("button.btn.primary.block", { onclick: () => go(backHref) }, isToday ? "Done" : "Back")];
      if (session.type === "strength" && (session.strengthResult || []).length)
        actions.unshift(el("button.btn.block", { onclick: () => { editing = true; draw(); } }, "Edit sets"));
      else if (session.type === "cardio" && session.cardioResult)
        actions.unshift(el("button.btn.block", { onclick: () => { editing = true; draw(); } }, "Edit run"));
      addActionBar(...actions);
      if (prs.length && isToday && !celebrated) { celebrated = true; setTimeout(() => celebrate(), 280); }
    }
  }

  // Copy the current set inputs back into the session model (without persisting),
  // so adding/removing a set doesn't discard edits typed but not yet saved.
  function flushStrengthEdits() {
    for (const { ex, i, w, r, timed } of draw._editRefs || []) {
      if (!ex.sets[i]) continue;
      ex.sets[i].weightKg = M.parseNum(w.value);
      const val = Math.max(0, Math.round(M.parseNum(r.value)));
      if (timed) ex.sets[i].seconds = val; else ex.sets[i].reps = val;
    }
  }
  function addSet(ex) {
    flushStrengthEdits();
    const last = ex.sets[ex.sets.length - 1];
    const timed = last ? last.reps == null : false;
    ex.sets.push(timed
      ? { weightKg: last ? last.weightKg ?? 0 : 0, reps: null, seconds: last ? last.seconds ?? 30 : 30, done: true, edited: true }
      : { weightKg: last ? last.weightKg ?? 0 : 0, reps: last ? last.reps ?? 0 : 0, done: true, edited: true });
    draw();
  }
  function removeSet(ex, i) {
    flushStrengthEdits();
    ex.sets.splice(i, 1);
    draw();
  }

  async function saveEdits() {
    if (session.type === "cardio" && cardioRefs) {
      const c = session.cardioResult || (session.cardioResult = {});
      c.timeSeconds = (Number(cardioRefs.h.value) || 0) * 3600 + (Number(cardioRefs.m.value) || 0) * 60 + (Number(cardioRefs.s.value) || 0);
      c.distanceKm = M.parseNum(cardioRefs.dist.value);
      c.avgHR = Math.round(M.parseNum(cardioRefs.hr.value));
      c.feltRPE = Math.round(M.parseNum(cardioRefs.rpe.value));
    } else {
      flushStrengthEdits();
    }
    await saveSession(session);
    editing = false;
    draw();
  }

  draw();
}

function prettyDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}
function miniStat(label, value) {
  return el("div", {}, [el("div.metric.sm", { text: value }), el("div.label", { style: "margin-top:5px", text: label })]);
}
function kv(k, v) {
  return el("div.row", { style: "margin-top:4px" }, [el("span.dim", { text: k }), el("span.spacer"), el("span.tnum", { text: v })]);
}
function labelled(k, node) {
  return el("div", { style: "text-align:center" }, [node, el("div.label", { style: "margin-top:7px", text: k })]);
}
function cardioBlurb(cmp) {
  const bits = [];
  if (cmp.distanceDelta > 0.05) bits.push(`+${cmp.distanceDelta.toFixed(2)} km farther`);
  if (cmp.paceDelta != null && cmp.paceDelta < -1) bits.push("faster pace");
  if (cmp.hrDelta < -1) bits.push(`avg HR down ${Math.abs(Math.round(cmp.hrDelta))} bpm`);
  return bits.length ? "Nice — " + bits.join(", ") + "." : "Solid, steady session.";
}
function editIn() {
  return "width:70px;text-align:center;font-size:1rem;font-weight:700;padding:7px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:9px;color:var(--text)";
}
