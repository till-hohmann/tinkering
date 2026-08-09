// settings.js — the Profile tab: program summary, backup/vault export, import/
// restore, and the sound toggle.

import { getActiveProgram, getAllPrograms, getAllSessions, importProgram, restoreBackup,
  setLastExport, getLastExport, getSelectionMode, setActiveProgramManual, setAutoProgram,
  getZoneBounds, setZoneBounds, syncedPrefs, getVO2maxLog, addVO2max,
  getBodyweight, setBodyweight, getProteinPerKg, setProteinPerKg,
  getDeficitTarget, setDeficitTarget, getMeasurementsLog, addMeasurement,
  getDexaLog, addDexaScan } from "../store.js";
import { todayISO } from "../model.js";
import * as M from "../model.js";
import { buildBackup, buildMarkdownLog, shareOrDownload } from "../export.js";
import { isSoundEnabled, setSoundEnabled, getAudioMode, setAudioMode, testAudio } from "../components/sound.js";
import { zonesFromBounds, DEFAULT_ZONE_BOUNDS } from "../cardio-intel.js";
import { provider, has, resetProviderCache, PROVIDERS, CAP,
  recoveryToday, bestWorkoutFor, body as trackerBody, vo2max as healthVO2max } from "../health/index.js";
import { resetAppleCache } from "../health/apple.js";
import { getProfile, patchProfile, TRACKED_FEATURES, equipmentFor } from "../profile.js";
import { THEMES, DEFAULT_THEME, applyTheme } from "../theme.js";
import { weightLabel, weightValue, weightToKg, lengthLabel, lengthValue, lengthToCm,
  distanceLabel, distanceValue, readEdit, defaultEquipmentFor, isStockRack, rackFields, plateLabel,
  METRIC_EQUIPMENT, IMPERIAL_EQUIPMENT } from "../units.js";
import { resolvedConfig, setRuntimeConfig, hasBackup } from "../config.js";
import * as db from "../db.js";
import { el, mount, go } from "../ui.js";
import { cloudPull, cloudCheck } from "../cloudsync.js";

// Running build version — baked into the code so it always reflects the
// installed version (iOS standalone PWAs don't reliably expose caches.keys()
// or SW messaging to the page). BUMP THIS together with CACHE in sw.js.
const APP_VERSION = "v146";

function daysSince(iso) {
  if (!iso) return null;
  const a = new Date(iso + "T00:00:00"), b = new Date(todayISO() + "T00:00:00");
  return Math.floor((b - a) / 86400000);
}

// Re-render this screen in place after a control changes what it should show.
//
// `go("#/settings")` CANNOT do this, which is subtle enough that three controls
// shipped broken: go() only assigns window.location.hash, and assigning a hash
// the value it already holds fires no hashchange, so the router never runs. The
// tracker picker, the program selector and the units switch all "worked" — they
// wrote the change and left the screen showing the old state until you navigated
// away and back. Scroll position is preserved because every one of these controls
// lives well down a long page, and snapping to the top on each tap is its own bug.
const redraw = () => {
  const y = window.scrollY;
  return renderSettings().then(() => window.scrollTo(0, y));
};

export async function renderSettings() {
  const program = await getActiveProgram();
  const programs = await getAllPrograms();
  const sel = await getSelectionMode();
  const sessions = await getAllSessions();
  const logged = sessions.filter((s) => (s.strengthResult && s.strengthResult.length) || s.cardioResult);
  const last = await getLastExport();
  const since = daysSince(last);
  const totalVol = logged.filter((s) => s.type === "strength").reduce((a, s) => a + M.sessionVolume(s), 0);
  const bounds = await getZoneBounds();

  // The active tracker, resolved once. Several cards below decide whether to
  // render an auto-fill button at all based on what it can actually supply, so
  // this has to be known before any of them are built.
  const trk = await provider();
  const canPullBody = await has(CAP.body);

  const status = el("p.note", { style: "min-height:1.2em" });

  // --- Heart-rate zones: fully editable ------------------------------------
  // 6 contiguous zones from 6 boundaries [Z1floor..Z5floor, maxHR]. Editing the
  // floors reshapes every zone; a live preview shows the resulting bpm bands.
  const hrStatus = el("p.note", { style: "margin-top:8px;min-height:1em" });
  const inStyle = "width:74px;text-align:center;font-size:1.05rem;font-weight:700;padding:8px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:10px;color:var(--text)";
  const labels = ["Zone 1 starts", "Zone 2 starts", "Zone 3 starts", "Zone 4 starts", "Zone 5 starts", "Max HR (top of Zone 5)"];
  const inputs = bounds.map((v) => el("input", { type: "number", inputmode: "numeric", value: String(v), style: inStyle }));
  const editRows = inputs.map((inp, i) => el("div.row", { style: "margin:7px 0;align-items:center" }, [
    el("div", { style: "flex:1", text: labels[i] }), el("span.spacer"), inp,
  ]));
  const preview = el("div", { style: "margin-top:14px" });
  function readInputs() { return inputs.map((i) => Math.round(M.parseNum(i.value))); }
  function renderPreview(b) {
    preview.replaceChildren(...zonesFromBounds(b).map((z) => el("div.zrow", {}, [
      el("span.zchip.z" + z.z, { text: "Z" + z.z }),
      el("span", { style: "flex:1;font-weight:600", text: z.name }),
      el("span.tnum.dim", { text: z.loBpm == null ? `< ${b[0]} bpm` : `${z.loBpm}–${z.hiBpm} bpm` }),
    ])));
  }
  renderPreview(bounds);
  inputs.forEach((inp) => inp.addEventListener("input", () => {
    const b = readInputs();
    if (b.every((n, i) => i === 0 || n > b[i - 1])) renderPreview(b);
  }));
  async function saveZones() {
    const b = readInputs();
    if (b.some((n) => n < 40 || n > 240)) { hrStatus.textContent = "Use heart rates between 40 and 240 bpm."; return; }
    if (!b.every((n, i) => i === 0 || n > b[i - 1])) { hrStatus.textContent = "Each zone must start higher than the one before it."; return; }
    await setZoneBounds(b); renderPreview(b);
    hrStatus.textContent = "Heart-rate zones saved.";
  }
  async function resetZones() {
    inputs.forEach((inp, i) => (inp.value = String(DEFAULT_ZONE_BOUNDS[i])));
    await saveZones();
  }
  // Pull the tracker's own observed max HR and apply it to the Zone 5 top.
  async function maxHRfromWhoop() {
    hrStatus.textContent = "Checking your tracker…";
    try {
      const m = await trackerBody();
      if (m && m.maxHR != null) {
        inputs[5].value = String(m.maxHR);
        await saveZones();
        hrStatus.textContent = `Max HR set to ${m.maxHR} from ${trk.label}.`;
      } else hrStatus.textContent = `${trk.label} didn't return a max HR.`;
    } catch (e) { hrStatus.textContent = /401|not_linked/.test(e.message || "") ? "Connect your tracker first (below)." : `Couldn't reach ${trk.label}.`; }
  }
  // Derive the 5 zone floors from the current Max HR (%HRmax model) — personalises
  // the zones to the athlete instead of fixed bpm bands (programming audit Gap F).
  function setZonesFromMax() {
    const max = Math.round(M.parseNum(inputs[5].value));
    if (!max || max < 120 || max > 240) { hrStatus.textContent = "Enter a sensible Max HR first."; return; }
    const pct = [0.57, 0.68, 0.76, 0.84, 0.91];   // Z1..Z5 floors as a fraction of HRmax
    pct.forEach((p, i) => { inputs[i].value = String(Math.round(max * p)); });
    renderPreview(readInputs());
    saveZones();
    hrStatus.textContent = `Zones set from a max HR of ${max}.`;
  }
  const hrCard = el("div.card", {}, [
    el("div.label", { style: "margin-bottom:2px", text: "Heart-rate zones" }),
    el("p.note", { style: "margin-top:4px", text: "These drive every cardio target and the VO₂max estimate. Match them to your watch if it has its own zones, or derive them from your max HR below." }),
    el("div", { style: "margin-top:8px" }, editRows),
    el("div.btn-row", { style: "margin-top:12px" }, [
      el("button.btn.primary", { onclick: saveZones }, "Save zones"),
      el("button.btn", { onclick: resetZones }, "Reset"),
    ]),
    canPullBody ? el("button.btn.block", { style: "margin-top:8px", onclick: maxHRfromWhoop }, `⟲ Max HR from ${trk.label}`) : null,
    el("button.btn.block", { style: "margin-top:8px", onclick: setZonesFromMax }, "Set zones from max HR"),
    hrStatus,
    el("div.label", { style: "margin:18px 2px 2px", text: "Current zones" }),
    preview,
  ]);

  // --- VO2max --- Apple computes this natively; WHOOP shows it in-app but has
  // never exposed it via API, so on WHOOP this stays a manual entry.
  const vo2log = await getVO2maxLog();
  const latestVO2 = vo2log.length ? vo2log[vo2log.length - 1] : null;
  const vo2In = el("input", { type: "text", inputmode: "decimal", placeholder: "ml/kg/min",
    value: latestVO2 ? String(latestVO2.value) : "",
    style: "width:120px;text-align:center;font-size:1.05rem;font-weight:700;padding:8px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:10px;color:var(--text)" });
  const vo2Status = el("p.note", { style: "margin-top:8px;min-height:1em",
    text: latestVO2 ? `Current: ${latestVO2.value} (updated ${latestVO2.date}).` : "Not set yet — copy it from your watch or tracker app." });
  async function saveVO2() {
    const v = M.parseNum(vo2In.value);
    if (v < 20 || v > 90) { vo2Status.textContent = "Enter a VO₂max between 20 and 90."; return; }
    await addVO2max(v, todayISO());
    vo2Status.textContent = `Saved ${Math.round(v * 10) / 10} for today.`;
  }
  const vo2Card = el("div.card", {}, [
    el("div.label", { text: "VO₂max" }),
    el("p.note", { style: "margin-top:4px", text: "Your tracker is the source of truth here. Update this when it changes; Progress trends your readings." }),
    el("div.row", { style: "margin-top:10px;gap:8px;align-items:center" }, [
      el("div", { style: "flex:1", text: "Latest reading" }), el("span.spacer"),
      vo2In, el("button.btn", { onclick: saveVO2 }, "Save"),
    ]),
    vo2Status,
  ]);

  // --- Nutrition: bodyweight (drives the protein target) + protein g/kg -------
  let bw0 = await getBodyweight();
  const perKg0 = await getProteinPerKg();
  const def0 = await getDeficitTarget();
  const nutStatus = el("p.note", { style: "margin-top:8px;min-height:1em" });
  const numStyle = "width:96px;text-align:center;font-size:1.05rem;font-weight:700;padding:8px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:10px;color:var(--text)";
  const bwIn = el("input", { type: "text", inputmode: "decimal", placeholder: weightLabel(),
    value: bw0 != null ? String(weightValue(bw0)) : "", style: numStyle });
  bwIn.dataset.shown = bwIn.value;      // an untouched field keeps the stored kg exactly (see readEdit)
  const bwKgNow = () => readEdit(bwIn, bw0 ?? 0, (v) => weightToKg(M.parseNum(v)));
  // Protein stays g per KG even on an imperial profile: it's the convention every
  // source states the number in, and converting it would leave the user guessing
  // which one their 2.0 was. The target it produces is in grams either way.
  const perKgIn = el("input", { type: "text", inputmode: "decimal", placeholder: "g/kg", value: String(perKg0), style: numStyle });
  const defIn = el("input", { type: "text", inputmode: "numeric", placeholder: "kcal", value: String(def0), style: numStyle });
  const targetLine = el("div.note", { style: "margin-top:10px" });
  function showTarget() {
    const bwKg = bwKgNow(), pk = M.parseNum(perKgIn.value);
    targetLine.textContent = bwKg && pk
      ? `Protein target: ${Math.round(bwKg * pk)} g/day (${pk} g/kg at ${M.fmtWeight(bwKg)}).`
      : "Enter bodyweight to compute a protein target.";
  }
  showTarget();
  [bwIn, perKgIn].forEach((i) => i.addEventListener("input", showTarget));
  async function saveNutrition() {
    const bw = bwKgNow(), pk = M.parseNum(perKgIn.value), def = M.parseNum(defIn.value);
    if (bw && (bw < 30 || bw > 250)) { nutStatus.textContent = "Bodyweight looks off."; return; }
    if (pk && (pk < 1 || pk > 4)) { nutStatus.textContent = "Protein g/kg should be ~1.4–2.5."; return; }
    if (def && (def < 0 || def > 1500)) { nutStatus.textContent = "Deficit target should be ~0–1000 kcal."; return; }
    if (bw) await setBodyweight(bw);
    if (pk) await setProteinPerKg(pk);
    await setDeficitTarget(def);
    showTarget(); nutStatus.textContent = "Saved.";
  }
  async function bwFromWhoop() {
    nutStatus.textContent = `Checking ${trk.label}…`;
    try {
      const m = await trackerBody();
      if (m && m.weightKg != null) {
        // A pulled reading is authoritative: show it, and mark it as shown so a
        // later Save doesn't round-trip it back through the display unit.
        bwIn.value = String(weightValue(m.weightKg)); bwIn.dataset.shown = bwIn.value; bw0 = m.weightKg;
        await setBodyweight(m.weightKg); showTarget();
        nutStatus.textContent = `Bodyweight ${M.fmtWeight(m.weightKg)} from ${trk.label}.`;
      }
      else nutStatus.textContent = `${trk.label} didn't return a weight.`;
    } catch (e) { nutStatus.textContent = /401|not_linked/.test(e.message || "") ? "Connect your tracker first." : `Couldn't reach ${trk.label}.`; }
  }
  const nutritionCard = el("div.card", {}, [
    el("div.label", { text: "Nutrition" }),
    el("p.note", { style: "margin-top:4px", text: "Bodyweight sets your daily protein target; log food on the Today screen." }),
    el("div.row", { style: "margin-top:10px;align-items:center" }, [el("div", { style: "flex:1", text: "Bodyweight" }), el("span.spacer"),
      bwIn, canPullBody ? el("button.btn", { style: "margin-left:6px;padding:8px 10px", onclick: bwFromWhoop }, `⟲ ${trk.label}`) : null].filter(Boolean)),
    el("div.row", { style: "margin-top:10px;align-items:center" }, [el("div", { style: "flex:1" }, [el("div", { text: "Protein" }), el("div.faint", { style: "font-size:.78rem", text: "g per kg bodyweight" })]), el("span.spacer"), perKgIn]),
    el("div.row", { style: "margin-top:10px;align-items:center" }, [el("div", { style: "flex:1" }, [el("div", { text: "Deficit target" }), el("div.faint", { style: "font-size:.78rem", text: "kcal/day under your tracked burn (recomp ~300–500)" })]), el("span.spacer"), defIn]),
    targetLine,
    el("button.btn.block", { style: "margin-top:12px", onclick: saveNutrition }, "Save"),
    nutStatus,
  ]);

  // --- Body measurements — waist is the recomp fat signal --------------------
  const mlog = await getMeasurementsLog();
  const latestM = mlog.length ? mlog[mlog.length - 1] : null;
  const mStatus = el("p.note", { style: "margin-top:8px;min-height:1em",
    text: latestM ? `Last measured ${latestM.date}.` : "Not measured yet — waist alone is enough (navel level, relaxed)." });
  const mIn = {};
  const mRow = (key, label, hint) => {
    mIn[key] = el("input", { type: "text", inputmode: "decimal", placeholder: lengthLabel(),
      value: latestM && latestM[key] != null ? String(lengthValue(latestM[key])) : "", style: numStyle });
    mIn[key].dataset.shown = mIn[key].value;   // carrying last month's number forward must not re-round it
    return el("div.row", { style: "margin-top:10px;align-items:center" }, [
      el("div", { style: "flex:1" }, [el("div", { text: label }), hint ? el("div.faint", { style: "font-size:.78rem", text: hint }) : null]),
      el("span.spacer"), mIn[key]]);
  };
  async function saveMeasurements() {
    // Typed in the display unit, stored in cm — the sanity gate below is on the
    // stored value, so it reads the same whichever unit was typed.
    const toCm = (k) => readEdit(mIn[k], (latestM && latestM[k]) || 0, (v) => lengthToCm(M.parseNum(v)));
    const vals = { waistCm: toCm("waistCm"), chestCm: toCm("chestCm"),
      armCm: toCm("armCm"), thighCm: toCm("thighCm") };
    if (!Object.values(vals).some((v) => v > 0)) { mStatus.textContent = "Enter at least one measurement."; return; }
    if (vals.waistCm && (vals.waistCm < 50 || vals.waistCm > 200)) { mStatus.textContent = `Waist looks off — is that ${lengthLabel()}?`; return; }
    await addMeasurement(todayISO(), vals);
    mStatus.textContent = "Saved for today. Progress trends your waist.";
  }
  const mP = (html) => el("p", { style: "margin:0 0 7px", html });
  const measureHelp = el("details.measure-help", { style: "margin-top:8px" }, [
    el("summary", { text: "How to measure exactly" }),
    el("div.note", { style: "margin-top:8px;line-height:1.5" }, [
      mP("<strong>Same way every time</strong> — that's what makes the trend real. Measure in the morning before eating or training. Keep the tape flat and level (parallel to the floor), snug against the skin but not digging in. Take each reading twice and use the average, and always measure the same (e.g. right) side."),
      mP("<strong>Waist</strong> — bare stomach at <strong>navel (belly-button) height</strong>. Stand tall, arms at your sides, belly relaxed — don't suck in or push out. Read it at the end of a normal breath out. This is the main fat-loss signal, so nail the consistency here."),
      mP("<strong>Chest</strong> — around the <strong>fullest part at nipple level</strong>, tape flat across the back and just under the armpits. Arms relaxed at your sides; read on a normal exhale (don't puff the chest up)."),
      mP("<strong>Upper arm</strong> — arm raised, <strong>biceps flexed hard</strong>, forearm curled toward you; wrap around the biggest part of the peak. (Relaxed and hanging works too — just always use the same one.)"),
      el("p", { style: "margin:0", html: "<strong>Thigh</strong> — standing, weight even on both feet, muscle relaxed. Measure the <strong>largest part high on the thigh</strong>, about a hand's width (~15 cm) below the groin crease — or pick a fixed distance above the kneecap and reuse it every time." }),
    ]),
  ]);
  const measureCard = el("div.card", {}, [
    el("div.label", { text: "Measurements" }),
    el("p.note", { style: "margin-top:4px", text: "Tape, weekly-ish. Waist drives the recomp scorecard — it's the honest fat-loss signal when the scale won't move." }),
    measureHelp,
    mRow("waistCm", "Waist", "navel level, belly relaxed, normal exhale"),
    mRow("chestCm", "Chest", "fullest point, nipple level · optional"),
    mRow("armCm", "Upper arm", "flexed, around the peak · optional"),
    mRow("thighCm", "Thigh", "largest point, standing relaxed · optional"),
    el("button.btn.block", { style: "margin-top:12px", onclick: saveMeasurements }, "Save measurements"),
    mStatus,
  ]);

  // --- DEXA scan — periodic gold-standard body composition -------------------
  const dlog = await getDexaLog();
  const latestD = dlog.length ? dlog[dlog.length - 1] : null;
  const dStatus = el("p.note", { style: "margin-top:8px;min-height:1em",
    text: latestD ? `Last scan ${latestD.date}. Retest ~12 weeks apart to track fat vs lean.` : "No scan yet — enter your DEXA results to start tracking." });
  const dDate = el("input", { type: "date", value: (latestD && latestD.date) || todayISO(), max: todayISO(),
    style: numStyle + ";width:150px" });
  const dIn = {};
  const dRow = (key, label, unit) => {
    dIn[key] = el("input", { type: "text", inputmode: "decimal", placeholder: unit || "",
      value: latestD && latestD[key] != null ? String(latestD[key]) : "", style: numStyle });
    return el("div.row", { style: "margin-top:10px;align-items:center" }, [
      el("div", { style: "flex:1" }, [el("div", { text: label }), unit ? el("div.faint", { style: "font-size:.78rem", text: unit }) : null]),
      el("span.spacer"), dIn[key]]);
  };
  const dGroup = (title) => el("div.faint", { style: "margin-top:16px;font-size:.66rem;text-transform:uppercase;letter-spacing:.1em", text: title });
  async function saveDexa() {
    const date = dDate.value || todayISO();
    const vals = {};
    for (const k of Object.keys(dIn)) { const raw = dIn[k].value.trim(); if (raw !== "") vals[k] = M.parseNum(raw); }
    if (!Object.keys(vals).length) { dStatus.textContent = "Enter at least one value."; return; }
    await addDexaScan(date, vals);
    dStatus.textContent = `Saved ${date}. The Body tab now tracks this scan.`;
  }
  const dexaCard = el("div.card", {}, [
    el("div.label", { text: "DEXA scan" }),
    el("p.note", { style: "margin-top:4px", text: "Full body-composition scan (quarterly-ish). The Body tab trends fat vs lean between scans — the real recomp signal. Leave any field blank to skip it." }),
    el("div.row", { style: "margin-top:12px;align-items:center" }, [el("div", { style: "flex:1" }, [el("div", { text: "Scan date" })]), el("span.spacer"), dDate]),
    dGroup("Composition"),
    dRow("totalMassKg", "Total mass", "kg"),
    dRow("totalFatKg", "Total fat mass", "kg"),
    dRow("ffmKg", "Fat-free mass", "kg"),
    dRow("bodyFatPct", "Body fat", "%"),
    dRow("bmi", "BMI", ""),
    dGroup("Fat distribution"),
    dRow("androidFatPct", "Android fat", "%"),
    dRow("gynoidFatPct", "Gynoid fat", "%"),
    dRow("agRatio", "A/G ratio", ""),
    dGroup("Metabolic & muscle"),
    dRow("rmr", "Resting metabolic rate", "kcal"),
    dRow("rsmi", "Skeletal muscle index (RSMI)", "kg/m²"),
    dGroup("Bone density"),
    dRow("bmd", "BMD", "g/cm²"),
    dRow("tScore", "T-score", ""),
    dRow("zScore", "Z-score", ""),
    dRow("centile", "Centile", ""),
    el("button.btn.block", { style: "margin-top:14px", onclick: saveDexa }, "Save DEXA scan"),
    dStatus,
  ]);

  // --- Tracker -------------------------------------------------------------
  // One card for all providers. Picking a provider rewrites profile.tracker and
  // re-renders; the card body is then whatever that provider needs — an OAuth
  // button for WHOOP, Shortcut setup for Apple, nothing for none.
  //
  // Status is checked over the network, so render a placeholder and fill it in
  // after mount (never block the page on a slow request).
  const trkLine = el("p.note", { style: "margin-top:0", text: "Checking…" });
  const trkBtnRow = el("div.btn-row", { style: "margin-top:10px" });
  const trkLatest = el("div", { style: "margin-top:4px" });

  const trkSeg = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 4px" });
  for (const p of PROVIDERS) {
    const on = p.id === trk.id;
    const b = el("button.progchip" + (on ? ".on" : ""), {}, p.label);
    b.onclick = async () => {
      await patchProfile({ tracker: { provider: p.id } });
      resetProviderCache();
      redraw();
    };
    trkSeg.appendChild(b);
  }
  const trkBlurb = el("p.note", { style: "margin:2px 0 0;font-size:.76rem",
    text: (PROVIDERS.find((p) => p.id === trk.id) || {}).blurb || "" });

  async function refreshTracker() {
    trkBtnRow.replaceChildren();
    trkLatest.replaceChildren();
    if (trk.id === "none") { trkLine.textContent = "Everything is logged by hand. No account, nothing leaves the device."; return; }
    trkLine.textContent = "Checking…";
    const st = await trk.status();

    if (st.unconfigured) {
      trkLine.textContent = trk.id === "whoop"
        ? "No WHOOP broker configured. Deploy whoop-worker/ and add its URL under Cloud backup below."
        : (st.detail || "Not configured yet.");
      return;
    }
    if (st.offline) {
      trkLine.textContent = `Offline — can't reach ${trk.label} right now.`;
      trkBtnRow.appendChild(el("button.btn", { onclick: refreshTracker }, "Retry"));
      return;
    }
    if (st.connected) {
      const who = st.who ? ` as ${st.who}` : "";
      // Apple pushes on a schedule rather than answering on demand, so a bridge
      // that stopped firing must READ as stopped — otherwise three-week-old
      // numbers quietly present themselves as today's.
      if (st.stale) {
        trkLine.innerHTML = `<span style="color:var(--amber)">●</span> Last push ${st.lastPush} (${st.staleDays} days ago). Check the Shortcut automation is still enabled.`;
      } else {
        trkLine.innerHTML = `<span style="color:var(--accent)">●</span> Connected${who}. `
          + (st.lastPush ? `Last push ${st.lastPush}, ${st.days} days stored.` : "Runs and readiness can auto-fill.");
      }
      trkBtnRow.appendChild(el("button.btn", { onclick: loadLatest }, "Refresh data"));
      if (trk.id === "whoop") {
        trkBtnRow.appendChild(el("button.btn", { onclick: async () => {
          trkLine.textContent = "Disconnecting…"; await trk.disconnect(); refreshTracker();
        } }, "Disconnect"));
      }
      loadLatest();
    } else if (trk.id === "whoop") {
      trkLine.textContent = "Not connected. Link WHOOP to auto-fill runs (HR, distance, time-in-zone) and readiness.";
      trkBtnRow.appendChild(el("button.btn.primary", { onclick: async () => {
        try { trkLine.textContent = "Opening WHOOP…"; await trk.connect(); }
        catch (e) { trkLine.textContent = "Couldn't start sign-in: " + e.message; }
      } }, "Connect WHOOP"));
    } else {
      trkLine.textContent = "No data pushed yet. Install the Shortcut and run it once — see the setup steps below.";
    }
  }

  // Pull the latest recovery + workout through the common interface (verifies
  // the data path and gives an at-a-glance "what your tracker knows today").
  async function loadLatest() {
    trkLatest.replaceChildren(el("p.note", { style: "margin:10px 0 0", text: `Loading your latest ${trk.label} data…` }));
    try {
      const [r, w, v] = await Promise.all([
        recoveryToday().catch(() => null),
        bestWorkoutFor(todayISO()).catch(() => null),
        healthVO2max().catch(() => null),
      ]);
      const rows = [];
      if (r) rows.push(statRow(r.derived ? "Readiness (est.)" : "Recovery", [
        r.recoveryPct != null ? r.recoveryPct + "%" : "–",
        r.restingHR != null ? "RHR " + r.restingHR : null,
        r.hrv != null ? "HRV " + r.hrv : null,
      ]));
      if (v && v.value != null) rows.push(statRow("VO₂max", [v.value + " ml/kg/min", v.date || null]));
      if (w) {
        const hard = ((w.zoneMins && w.zoneMins[4]) || 0) + ((w.zoneMins && w.zoneMins[5]) || 0);
        rows.push(statRow(w.sport || "Last workout", [
          w.distanceKm != null ? `${distanceValue(w.distanceKm)} ${distanceLabel()}` : null,
          w.timeSeconds ? M.fmtDuration(w.timeSeconds) : null,
          w.avgHR != null ? "avg " + w.avgHR : null,
          w.maxHR != null ? "max " + w.maxHR : null,
          hard ? hard + " min Z4-5" : null,
          w.strain != null ? "strain " + w.strain : null,
        ]));
      }
      trkLatest.replaceChildren(
        el("div.label", { style: "margin:14px 2px 6px", text: "Latest from " + trk.label }),
        ...(rows.length ? rows : [el("p.note", { style: "margin:0", text: "Connected, but nothing recent came back yet." })]),
      );
    } catch (e) {
      trkLatest.replaceChildren(el("p.note", { style: "margin:10px 0 0", text: `Couldn't load ${trk.label} data: ` + (e.message || "error") }));
    }
  }
  refreshTracker();   // fire-and-forget; updates the live nodes once it resolves

  const privacyNote = {
    whoop: "Read-only access to your workouts, recovery and sleep. Your WHOOP login stays with WHOOP; this device holds only a private link key, and the connection can be revoked here or in the WHOOP app anytime.",
    apple: "Your phone pushes a small daily summary to your OWN backup Worker. Apple Health itself is never opened by this app — a PWA can't read HealthKit — so you control exactly which metrics the Shortcut sends, and turning the automation off stops it immediately.",
    none: "Nothing is sent anywhere. All data stays in this browser until you export it.",
  }[trk.id];

  const trackerCard = el("div.card", {}, [
    el("div.label", { text: "Tracker" }),
    trkSeg,
    trkBlurb,
    el("div", { style: "margin-top:12px" }, [trkLine, trkBtnRow, trkLatest]),
    trk.id === "apple" ? appleSetup() : null,
    trk.id === "apple" ? appleImport() : null,
    el("p.note", { style: "margin-top:12px;font-size:.74rem", text: privacyNote }),
  ].filter(Boolean));

  async function doExport(kind) {
    const iso = todayISO();
    const isMd = kind === "md";
    const text = isMd ? buildMarkdownLog(programs, sessions, iso) : buildBackup(programs, sessions, iso, await syncedPrefs());
    const res = await shareOrDownload(isMd ? "fitness-log.md" : "fitness-backup.json", text,
      isMd ? "text/markdown" : "application/json");
    if (res !== "cancelled") { await setLastExport(iso); status.textContent = `Exported ${isMd ? "vault log" : "backup"} (${res}).`; }
  }

  async function doCloudRestore() {
    if (!window.confirm("Restore from the cloud backup? This overwrites the matching days on this device with the cloud snapshot. Use this to roll back after testing.")) return;
    status.textContent = "Restoring from cloud…";
    const data = await cloudPull();
    if (!data || !Array.isArray(data.sessions) || !data.sessions.length) {
      status.textContent = "Cloud restore failed — offline, or no backup found.";
      return;
    }
    await restoreBackup(data);
    status.textContent = `Restored ${data.programs?.length || 0} program(s), ${data.sessions.length} sessions from cloud.`;
    setTimeout(() => go("#/"), 800);
  }

  const importInput = el("input", { type: "file", accept: "application/json,.json", style: "display:none" });
  importInput.addEventListener("change", async () => {
    const f = importInput.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.kind === "fitness-backup" || (data.programs && data.sessions)) {
        await restoreBackup(data);
        status.textContent = `Restored ${data.programs?.length || 0} program(s), ${data.sessions?.length || 0} sessions.`;
      } else {
        const program = data.program || data;
        if (!program.id || !program.weeks) throw new Error("Not a valid program file");
        await importProgram(program, true);
        status.textContent = `Imported program "${program.name}".`;
      }
      setTimeout(() => go("#/"), 600);
    } catch (e) { status.textContent = "Import failed: " + e.message; }
  });

  let soundOn = isSoundEnabled();
  const soundBtn = el("button.btn", { style: "min-width:74px" }, soundOn ? "On" : "Off");
  soundBtn.onclick = () => { soundOn = !soundOn; setSoundEnabled(soundOn); soundBtn.textContent = soundOn ? "On" : "Off"; };

  let amode = getAudioMode();
  const seg = el("div.segmented");
  const mkOpt = (val, label) => {
    const b = el("button" + (amode === val ? ".on" : ""), {}, label);
    b.onclick = () => { amode = val; setAudioMode(val); [...seg.children].forEach((c) => c.classList.toggle("on", c === b)); };
    return b;
  };
  seg.appendChild(mkOpt("mix", "Mix with music"));
  seg.appendChild(mkOpt("loud", "Always audible"));
  const testBtn = el("button.btn.block", { style: "margin-top:12px", onclick: () => testAudio() }, "▶ Test voice cue");

  // Program selection: Automatic (by date) or pin a specific block. Only useful
  // with more than one program loaded.
  let programCard = null;
  if (programs.length > 1) {
    const ordered = [...programs].sort((a, b) => ((a.startDate || "") < (b.startDate || "") ? -1 : 1));
    // Wrapping chips (not a fixed segmented control) so it can't overflow the card
    // as more blocks are added. Labels are "Block N" by chronological order.
    const pseg = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px" });
    const mkProg = (active, label, onPick) => {
      const b = el("button.progchip" + (active ? ".on" : ""), {}, label);
      b.onclick = async () => { await onPick(); redraw(); };
      return b;
    };
    pseg.appendChild(mkProg(sel.auto, "Auto", setAutoProgram));
    ordered.forEach((p, i) => {
      const isPinned = !sel.auto && sel.activeId === p.id;
      pseg.appendChild(mkProg(isPinned, `Block ${i + 1}`, () => setActiveProgramManual(p.id)));
    });
    programCard = el("div.card", {}, [
      el("div.label", { style: "margin-bottom:8px", text: "Program selection" }),
      pseg,
      el("p.note", { style: "margin-top:10px", text: sel.auto
        ? "Automatic: the app switches to each block on its start date."
        : `Pinned to “${program ? program.name : "?"}”. Switch back to Auto to follow the calendar.` }),
    ]);
  }

  // --- Cloud backup (self-host) --------------------------------------------
  // The app is local-only until you point it at a backup Worker you deployed.
  // Storing the endpoint + token here (rather than only in a build-time config)
  // is what lets someone run the PUBLIC code unchanged and still have durable
  // backup — no forking, no rebuilding. These values are device-local and are
  // deliberately excluded from the synced prefs: they are the credential for the
  // very service that does the syncing.
  const cfg0 = await resolvedConfig(db);
  const cloudStatus = el("p.note", { style: "margin-top:8px;min-height:1em" });
  const epIn = el("input", { type: "text", placeholder: "https://your-backup.workers.dev", value: (cfg0.backup && cfg0.backup.endpoint) || "",
    style: "width:100%;padding:9px 11px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:10px;color:var(--text);font-size:.82rem" });
  const tokIn = el("input", { type: "password", placeholder: "your backup token", value: (cfg0.backup && cfg0.backup.token) || "",
    style: "width:100%;padding:9px 11px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:10px;color:var(--text);font-size:.82rem" });
  async function testCloud() {
    cloudStatus.textContent = "Checking…";
    const r = await cloudCheck();
    cloudStatus.textContent =
      r.ok ? (r.empty ? "Reachable — no backup stored yet. It'll upload on your next change." : `Reachable — ${r.sessions} sessions stored.`)
      : r.reason === "unconfigured" ? "Not configured — the app is local-only."
      : r.reason === "unauthorized" ? "Rejected — the token doesn't match the Worker's BACKUP_TOKEN."
      : r.reason === "unreachable" ? "Couldn't reach that URL. Check it's deployed and you're online."
      : `Worker returned ${r.status}.`;
  }
  async function saveCloud() {
    const ep = epIn.value.trim().replace(/\/+$/, ""), tok = tokIn.value.trim();
    if (ep && !/^https:\/\//i.test(ep)) { cloudStatus.textContent = "The endpoint must start with https://"; return; }
    await setRuntimeConfig(db, { backup: { endpoint: ep || null, token: tok || null } });
    cloudStatus.textContent = ep ? "Saved. Testing…" : "Cleared — the app is now local-only.";
    if (ep) await testCloud();
  }
  const cloudCard = el("div.card", {}, [
    el("div.label", { style: "margin-bottom:4px", text: "Cloud backup" }),
    el("p.note", { style: "margin-top:0", text: hasBackup(cfg0)
      ? "Your data is mirrored to your own Worker, so it survives this device being wiped."
      : "Optional. Without it the app works fully offline, but a storage wipe loses everything not exported. Deploy backup-worker/ and paste its details here." }),
    el("div", { style: "margin-top:10px" }, [el("div.faint", { style: "font-size:.72rem;margin-bottom:4px", text: "WORKER URL" }), epIn]),
    el("div", { style: "margin-top:10px" }, [el("div.faint", { style: "font-size:.72rem;margin-bottom:4px", text: "TOKEN" }), tokIn]),
    el("div.btn-row", { style: "margin-top:12px" }, [
      el("button.btn.primary", { onclick: saveCloud }, "Save"),
      el("button.btn", { onclick: testCloud }, "Test connection"),
    ]),
    cloudStatus,
    el("p.note", { style: "margin-top:10px;font-size:.73rem", text:
      "This token can read and overwrite your whole training log, so treat it like a password. It stays on this device and is never included in exports or synced anywhere." }),
  ]);

  // --- Appearance ----------------------------------------------------------
  // Themes vary surfaces and the brand accent only. The data palette (mint =
  // strength, cyan = cardio, violet = recovery, coral = intensity) is fixed
  // across all of them, because those hues carry meaning in charts and on the
  // muscle map — restyling them would change what the app says, not how it looks.
  const profileNow = await getProfile();
  const currentTheme = (profileNow && profileNow.theme) || DEFAULT_THEME;
  const themeGrid = el("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px;margin-top:12px" });
  function paintThemes(active) {
    themeGrid.replaceChildren(...THEMES.map((t) => {
      const on = t.id === active;
      const chip = el("button", {
        style: `text-align:left;padding:10px;border-radius:13px;cursor:pointer;background:${t.swatch[0]};`
          + `border:1.5px solid ${on ? t.swatch[1] : "var(--line)"};color:#fff`,
        onclick: async () => {
          applyTheme(t.id);                 // instant, before the write lands
          paintThemes(t.id);
          await patchProfile({ theme: t.id });
        },
      }, [
        el("div", { style: "display:flex;gap:5px;align-items:center" }, [
          el("span", { style: `width:20px;height:20px;border-radius:999px;background:${t.swatch[1]};display:inline-block` }),
          on ? el("span", { style: `color:${t.swatch[1]};font-weight:800;font-size:.8rem`, text: "✓" }) : null,
        ].filter(Boolean)),
        el("div", { style: "margin-top:8px;font-weight:700;font-size:.84rem;color:#fff", text: t.name }),
      ]);
      return chip;
    }));
  }
  paintThemes(currentTheme);

  // --- Units ---------------------------------------------------------------
  // Onboarding asks once, and until now that was the only chance to answer: an
  // install that picked the wrong system was stuck with it. Switching is safe
  // because nothing stored changes — every weight, length and distance is held
  // in metric and converted at the edges — so this only changes what's printed.
  // The three move together: nobody wants pounds with kilometres.
  const unitsNow = (profileNow && profileNow.units && profileNow.units.weight) || "kg";
  const uSeg = el("div.segmented");
  const uOpt = (val, label) => {
    const b = el("button" + (unitsNow === val ? ".on" : ""), {}, label);
    b.onclick = async () => {
      [...uSeg.children].forEach((c) => c.classList.toggle("on", c === b));
      await patchProfile({ units: val === "lb"
        ? { weight: "lb", length: "in", distance: "mi" }
        : { weight: "kg", length: "cm", distance: "km" } });
      redraw();                            // re-render in place; go() would be a no-op here
    };
    return b;
  };
  uSeg.appendChild(uOpt("kg", "kg · cm · km"));
  uSeg.appendChild(uOpt("lb", "lb · in · mi"));

  // A RACK IS NOT A DISPLAY UNIT. Everything the app stores is metric and simply
  // reads out in whichever system you pick — except the kit, which is physical
  // objects. A 20 kg bar under imperial units reads "44 lb", which no gym owns,
  // and the engine then rounds loads to weights nobody can load. So when the
  // places still carry the OTHER system's stock rack, offer to re-base them.
  // Only stock racks are offered: an edited rack describes a real gym.
  const wantEquip = defaultEquipmentFor(profileNow);
  const otherEquip = unitsNow === "lb" ? METRIC_EQUIPMENT : IMPERIAL_EQUIPMENT;
  const stale = (profileNow && profileNow.places || []).filter((pl) => isStockRack(pl, otherEquip));
  const rebaseStatus = el("p.note", { style: "margin-top:8px;min-height:1em" });
  const rebaseRow = stale.length ? el("div", { style: "margin-top:14px;padding-top:14px;border-top:1px solid var(--line)" }, [
    el("div", { style: "font-weight:700;font-size:.9rem", text: "Your kit is still a " + (unitsNow === "lb" ? "metric" : "US") + " rack" }),
    el("p.note", { style: "margin-top:4px", text:
      `${stale.map((p) => p.name).join(", ")} ${stale.length === 1 ? "uses" : "use"} a `
      + `${otherEquip.barWeightKg === METRIC_EQUIPMENT.barWeightKg ? "20 kg bar with metric plates" : "45 lb bar with pound plates"}`
      + `, so loads get prescribed at weights your rack can't make. Re-basing swaps in a `
      + `${weightValue(wantEquip.barWeightKg)} ${weightLabel()} bar and `
      + `${wantEquip.barbellPlatesKg.map((k) => plateLabel(k)).join(" / ")} ${weightLabel()} plates. Your logged sets are untouched.` }),
    el("button.btn.block", { style: "margin-top:10px", onclick: async () => {
      const places = (profileNow.places || []).map((pl) =>
        (isStockRack(pl, otherEquip) ? { ...pl, ...rackFields(wantEquip) } : pl));
      await patchProfile({ places });
      redraw();
    } }, `Re-base to a ${unitsNow === "lb" ? "US" : "metric"} rack`),
    rebaseStatus,
  ]) : null;

  const unitsCard = el("div.card", {}, [
    el("div.label", { text: "Units" }),
    el("p.note", { style: "margin-top:4px", text: "Display only — your log is stored in metric and converted on the way out, so switching never rewrites a single logged set." }),
    el("div", { style: "margin-top:12px" }, [uSeg]),
    rebaseRow,
  ]);

  // --- build a block ---------------------------------------------------------
  // The builder used to be reachable ONLY from the zero-program state — the Home
  // and Plan buttons both sit inside `if (!program)`, and the router only jumps
  // to it when there is no active block. So the moment you had a plan, the thing
  // that writes plans became unreachable, which is exactly backwards: re-planning
  // is what you do repeatedly. This is the permanent way in.
  const buildCard = el("div.card", {}, [
    el("div.label", { text: "Training blocks" }),
    el("p.note", { style: "margin-top:4px", text: program
      ? "Build a new block when this one ends, or replace it if the plan stopped fitting. Existing blocks are kept — the app runs whichever one covers today."
      : "Answer a few questions and the app writes the plan, then runs it with you session by session." }),
    el("button.btn.block.primary", { style: "margin-top:12px", onclick: () => go("#/build") },
      program ? "Build a new block" : "Build my first block"),
  ]);

  // --- what you track --------------------------------------------------------
  // Onboarding asks this and, until the audit, nothing but two Progress cards
  // ever read the answer — so an install could switch nutrition off at setup and
  // still be shown a nutrition card forever. The toggles gate the optional cards
  // below, and they live here so the answer is changeable rather than a one-shot
  // question at setup. Turning one off hides its card; the data is kept.
  const feats = (profileNow && profileNow.features) || {};
  const featList = el("div.list", { style: "margin-top:12px" });
  const paintFeats = (state) => featList.replaceChildren(...TRACKED_FEATURES.map(([key, title, sub]) => {
    const on = !!state[key];
    return el("button.item" + (on ? ".on" : ""), {
      style: "text-align:left" + (on ? ";border-color:var(--accent)" : ""),
      onclick: async () => {
        const next = { ...state, [key]: !on };
        paintFeats(next);
        await patchProfile({ features: { [key]: !on } });
        redraw();                          // the gated cards below appear/disappear
      },
    }, [
      el("div.meta", {}, [el("div.t", { text: title }), el("div.s", { text: sub })]),
      el("span.badge" + (on ? ".accent" : ""), { text: on ? "On" : "Off" }),
    ]);
  }));
  paintFeats(feats);
  const featuresCard = el("div.card", {}, [
    el("div.label", { text: "What you track" }),
    el("p.note", { style: "margin-top:4px", text: "Turning one off just hides its card — nothing you've already logged is deleted." }),
    featList,
  ]);

  const themeCard = el("div.card", {}, [
    el("div.label", { text: "Theme" }),
    el("p.note", { style: "margin-top:4px", text: "Changes surfaces and the accent. Chart colours stay fixed — mint is strength, cyan is cardio, violet is recovery, coral is intensity, in every theme." }),
    themeGrid,
  ]);

  // --- delete everything ----------------------------------------------------
  // Table stakes for anything holding health data, and it has to be real: this
  // drops the whole IndexedDB database, not just the rows the UI knows about.
  // Two-step by design — a single tap that destroys a year of training is a
  // trap, and the typed confirmation is what makes it a decision rather than a
  // slip. Deliberately does NOT touch the cloud backup: the user's own Worker is
  // theirs to clear, and silently wiping a remote copy from a local button is a
  // surprise nobody wants. The copy says so.
  const dangerStatus = el("p.note", { style: "margin-top:10px;min-height:1em" });
  const dangerBody = el("div");
  function dangerIdle() {
    dangerBody.replaceChildren(
      el("p.note", { style: "margin-top:0", text:
        "Removes every session, program, measurement and setting from this device, permanently. Export first if you might want any of it back." }),
      el("button.btn.block.danger", { style: "margin-top:12px", onclick: dangerConfirm }, "Delete all my data"),
    );
    dangerStatus.textContent = "";
  }
  function dangerConfirm() {
    const typed = el("input", { type: "text", placeholder: "DELETE",
      style: "width:100%;padding:11px 13px;background:var(--bg-elev2);border:1px solid var(--red);border-radius:11px;color:var(--text);font-size:.95rem;text-align:center;letter-spacing:.12em" });
    const cfgHasBackup = hasBackup(cfg0);
    dangerBody.replaceChildren(
      el("p.note", { style: "margin-top:0;color:var(--red)", text:
        `This deletes ${sessions.length} session${sessions.length === 1 ? "" : "s"} and ${programs.length} program${programs.length === 1 ? "" : "s"}. It cannot be undone.` }),
      cfgHasBackup
        ? el("p.note", { style: "margin-top:8px", text:
            "Your cloud backup is NOT touched — it's on your own Worker, so clear it there if you want it gone. Note that reopening the app would otherwise restore from it." })
        : null,
      el("div", { style: "margin-top:12px" }, [el("div.faint", { style: "font-size:.72rem;margin-bottom:5px", text: "TYPE DELETE TO CONFIRM" }), typed]),
      el("div.btn-row", { style: "margin-top:12px" }, [
        el("button.btn", { onclick: dangerIdle }, "Cancel"),
        el("button.btn.danger", { onclick: async () => {
          if (typed.value.trim().toUpperCase() !== "DELETE") { dangerStatus.textContent = "Type DELETE to confirm."; return; }
          dangerStatus.textContent = "Deleting…";
          const ok = await db.deleteEverything();
          if (!ok) { dangerStatus.textContent = "Couldn't delete — close any other tabs with the app open and try again."; return; }
          // Full reload rather than a re-render: every module holds cached state
          // (profile, provider, config) that would otherwise outlive the data.
          location.replace(location.pathname);
        } }, "Delete everything"),
      ]),
    );
  }
  dangerIdle();
  const dangerCard = el("div.card", { style: "margin-top:12px;border-color:var(--red)" }, [
    el("div.label", { style: "color:var(--red)", text: "Delete all data" }),
    dangerBody, dangerStatus,
  ]);

  // section header between grouped setting cards (keeps an 11-card list scannable)
  const sectionH = (t) => el("h2", { style: "margin:26px 2px 0", text: t });

  mount([
    el("h1", { text: "Profile" }),

    el("div.card", {}, [
      el("div.label", { text: "Active program" }),
      el("h3", { style: "margin:9px 0 2px", text: program ? program.name : "none" }),
      el("div.note", { text: program ? `${program.lengthWeeks} weeks` : "" }),
      el("div.statgrid.three", { style: "margin-top:18px" }, [
        miniStat("Sessions", String(logged.length)),
        miniStat("Volume", Math.round(totalVol).toLocaleString("en-GB")),
        miniStat("Programs", String(programs.length)),
      ]),
    ]),

    sectionH("Program"),
    buildCard,
    ...(programCard ? [programCard] : []),

    // Each of these is gated on its own toggle in "What you track" below. A
    // feature that is off keeps its data — it just stops asking about it.
    ...(feats.nutrition || feats.measurements || feats.dexa || feats.vo2max ? [sectionH("Health & body")] : []),
    feats.nutrition ? nutritionCard : null,
    feats.measurements ? measureCard : null,
    feats.dexa ? dexaCard : null,
    feats.vo2max ? vo2Card : null,

    sectionH("Devices & cardio"),
    trackerCard,
    feats.cardio ? hrCard : null,

    sectionH("Appearance"),
    featuresCard,
    unitsCard,
    themeCard,

    sectionH("Audio"),
    el("div.card", {}, [
      el("div.row", {}, [el("div", { style: "flex:1" }, [el("div.label", { text: "Audio cues" }),
        el("div.note", { style: "margin-top:4px", text: "Spoken commands in warm-ups, runs & cool-downs" })]), soundBtn]),
      el("div.label", { style: "margin:16px 0 8px", text: "When music is playing" }),
      seg,
      el("p.note", { style: "margin-top:10px", text: "Cues play while the screen is on — the app keeps the screen awake during a workout, so just don't press the power button. Mix blends cues over your music without interrupting it (iOS can't deliver cues once the phone is hard-locked, and silences blended cues on the mute switch). Always audible keeps cues audible even on the mute switch, but pauses your music." }),
      testBtn,
    ]),

    sectionH("Data & backup"),
    cloudCard,
    el("div.card", {}, [
      el("div.label", { style: "margin-bottom:8px", text: "Backup & vault export" }),
      since != null ? el("p.note" + (since >= 10 ? ".warn" : ""), { style: "margin-top:0", text: since >= 10 ? `⚠ Last export ${since} days ago — time for a backup.` : `Last export ${since === 0 ? "today" : since + " day(s) ago"}.` })
        : el("p.note", { style: "margin-top:0", text: "No export yet. Export regularly — your data lives only on this device." }),
      el("div.btn-row", { style: "margin-top:10px" }, [
        el("button.btn.primary", { onclick: () => doExport("md") }, "Vault log (.md)"),
        el("button.btn", { onclick: () => doExport("json") }, "Backup (.json)"),
      ]),
      status,
    ]),

    el("div.card", {}, [
      el("div.label", { style: "margin-bottom:8px", text: "Import / restore" }),
      el("p.note", { style: "margin-top:0", text: "Import a new program (JSON) or restore a full backup." }),
      el("button.btn.block", { onclick: () => importInput.click() }, "Choose file…"),
      el("button.btn.block", { style: "margin-top:8px", onclick: doCloudRestore }, "Restore from cloud"),
      importInput,
    ]),

    dangerCard,

    el("div.card", { style: "margin-top:12px" }, [
      el("div.label", { text: "Health disclaimer" }),
      el("p.note", { style: "margin-top:6px;line-height:1.5", text:
        "Ninefold is general fitness software, not medical advice. Its prescriptions come from published training heuristics and from your own logged performance — they take no account of any injury, condition or medication. If you're carrying an injury, in pain that changes with load, or returning from surgery, get a plan from a qualified physiotherapist instead. Talk to a doctor before starting a new training programme." }),
    ]),

    el("p.note.center", { style: "margin-top:22px", text: "Data stays on this device. Exports are the durable backup." }),
    el("p.note.center", { style: "margin-top:8px;font-size:.72rem", text: "Ninefold " + APP_VERSION }),
  ]);
}

// Apple Health setup. There is no OAuth here and no button that can "connect"
// anything: a PWA cannot read HealthKit, so the bridge is an iOS Shortcut the
// user installs and points at their own endpoint. The card's job is to make that
// legible and to hand over the exact URL to paste.
function appleSetup() {
  const endpointLine = el("code.copyline", { style: "display:block;margin-top:6px;padding:9px 11px;background:var(--bg-elev2);border:1px solid var(--line);border-radius:9px;font-size:.72rem;word-break:break-all", text: "…" });
  const copyBtn = el("button.btn", { style: "margin-top:8px", onclick: async () => {
    try { await navigator.clipboard.writeText(endpointLine.textContent); copyBtn.textContent = "Copied ✓"; }
    catch { copyBtn.textContent = "Select and copy manually"; }
    setTimeout(() => { copyBtn.textContent = "Copy ingest URL"; }, 1800);
  } }, "Copy ingest URL");
  (async () => {
    const cfg = await resolvedConfig(db);
    endpointLine.textContent = hasBackup(cfg)
      ? cfg.backup.endpoint.replace(/\/+$/, "") + "/health-ingest"
      : "Set up Cloud backup first — the Shortcut posts into it.";
  })();
  const step = (n, title, body) => el("div", { style: "margin-top:12px" }, [
    el("div", { style: "font-weight:700;font-size:.85rem" }, [
      el("span", { style: "display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;border-radius:999px;background:var(--bg-elev3);margin-right:8px;font-size:.72rem", text: String(n) }),
      title]),
    el("p.note", { style: "margin:5px 0 0 28px", text: body }),
  ]);
  return el("details", { style: "margin-top:14px" }, [
    el("summary", { style: "cursor:pointer;font-weight:700;font-size:.88rem", text: "Set up the Health bridge" }),
    el("p.note", { style: "margin-top:8px" , text:
      "A web app can't read Apple Health directly — Apple provides no web API. Instead your phone pushes a small daily summary to your own Worker on a schedule, which means you decide exactly what gets sent and can stop it at any time." }),
    step(1, "Copy your ingest URL", "This is your own backup Worker. Nobody else can write to it without your token."),
    endpointLine, copyBtn,
    step(2, "Create the Shortcut", "Shortcuts app → new shortcut → Find Health Samples for resting heart rate, HRV, sleep, weight, active energy, basal energy and VO₂max → Get Contents of URL, method POST, JSON body, pasting the URL above and your token as an Authorization header."),
    step(3, "Automate it", "Shortcuts → Automation → Time of Day, every morning, run it without asking. Once a day is enough; the app reads whatever was last pushed."),
    step(4, "Run it once by hand", "Then come back here — the card above should show the last push date."),
    el("p.note", { style: "margin-top:12px;font-size:.73rem", text:
      "Prefer not to build it yourself? The Health Auto Export app does the same thing with a REST destination and no scripting." }),
  ]);
}

// Import the Health app's own export archive — everything from BEFORE the
// Shortcut existed. Separate from the bridge above because it needs no backend
// at all: the parsed history is stored on-device and merged with whatever the
// Shortcut has pushed.
function appleImport() {
  const status = el("p.note", { style: "margin-top:10px;min-height:1.2em" });
  const bar = el("div", { style: "display:none;height:5px;border-radius:3px;background:var(--bg-elev3);margin-top:10px;overflow:hidden" },
    [el("div", { style: "width:0;height:100%;background:var(--grad-cta);transition:width .2s" })]);
  const fill = bar.firstChild;
  const summary = el("div", { style: "margin-top:10px" });

  const input = el("input", { type: "file", accept: ".zip,.xml,application/zip,text/xml", style: "display:none" });
  const pick = el("button.btn.block", { style: "margin-top:10px", onclick: () => input.click() }, "Choose export.zip…");

  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    summary.replaceChildren();
    pick.disabled = true;
    bar.style.display = "";
    const mb = (n) => (n / 1048576).toFixed(0);
    status.textContent = `Reading ${file.name} (${mb(file.size)} MB)…`;
    try {
      const { parseAppleExport, summarise, applyImport } = await import("../health/apple-import.js");
      const result = await parseAppleExport(file, {
        onProgress: ({ bytes, records, days }) => {
          // A zip decompresses to roughly 3x its size, so the bar is an estimate
          // — but a moving bar is the point, not precision.
          const est = /\.zip$/i.test(file.name) ? file.size * 3 : file.size;
          fill.style.width = Math.min(97, (bytes / Math.max(1, est)) * 100) + "%";
          status.textContent = `${records.toLocaleString("en-GB")} records · ${days} days…`;
        },
      });
      fill.style.width = "100%";
      const s = summarise(result);
      if (!s.days) {
        status.textContent = "No usable health data found in that file.";
        return;
      }
      status.textContent = "Saving…";
      const written = await applyImport(result, { onStep: (m) => { status.textContent = m; } });
      resetAppleCache();

      const row = (label, n) => (n ? el("div.row", { style: "margin:5px 0;font-size:.84rem" }, [
        el("span", { style: "flex:1", text: label }), el("span.dim.tnum", { text: n.toLocaleString("en-GB") })]) : null);
      summary.replaceChildren(...[
        el("div.label", { style: "margin-bottom:6px", text: "Imported" }),
        el("p.note", { style: "margin:0 0 8px", text: `${s.days} days, ${s.from} to ${s.to}.` }),
        row("Weigh-ins", s.weight), row("Resting HR", s.restingHR), row("HRV", s.hrv),
        row("Sleep", s.sleep), row("Energy", s.energy), row("VO₂max", s.vo2max),
        row("Waist", s.waist), row("Workouts", s.workouts),
        written.updated ? el("p.note", { style: "margin-top:8px", text: `${written.added} new days, ${written.updated} updated.` }) : null,
        ...result.warnings.map((w) => el("p.note", { style: "margin-top:8px;font-size:.73rem", text: w })),
      ].filter(Boolean));
      status.textContent = "Done. Re-importing the same file later is safe — days merge by date.";
    } catch (e) {
      status.textContent = "Couldn't read it: " + (e.message || "unknown error");
    } finally {
      pick.disabled = false;
      input.value = "";
      setTimeout(() => { bar.style.display = "none"; fill.style.width = "0"; }, 1200);
    }
  });

  return el("details", { style: "margin-top:10px" }, [
    el("summary", { style: "cursor:pointer;font-weight:700;font-size:.88rem", text: "Import your Health history" }),
    el("p.note", { style: "margin-top:8px", text:
      "The Shortcut only knows about days after you set it up. This loads everything before it — weight, resting heart rate, HRV, sleep, energy and VO₂max, going back as far as your Health app does." }),
    el("p.note", { style: "margin-top:8px", text:
      "On your iPhone: Health app → your photo → Export All Health Data. It produces an export.zip. AirDrop or save it, then pick it here — no need to unzip it." }),
    // The one genuinely awkward bit, and worth stating plainly rather than
    // letting someone discover a dead button in the gym.
    el("p.note.warn", { style: "margin-top:8px", text:
      "If you added Ninefold to your Home Screen, do this in Safari instead — iOS blocks file pickers inside installed web apps. Same URL, same data." }),
    pick, input, bar, status, summary,
  ]);
}

function miniStat(label, value) {
  return el("div", {}, [el("div.metric.sm", { text: value }), el("div.label", { style: "margin-top:5px", text: label })]);
}

// One compact line: a bold label + a dot-separated list of values (nulls dropped).
function statRow(label, parts) {
  const vals = (parts || []).filter((p) => p != null && p !== "");
  return el("div.row", { style: "margin:7px 0;align-items:baseline;gap:8px" }, [
    el("span", { style: "font-weight:700;min-width:96px", text: label }),
    el("span.dim", { style: "flex:1;text-align:right;font-variant-numeric:tabular-nums", text: vals.join("  ·  ") || "–" }),
  ]);
}
