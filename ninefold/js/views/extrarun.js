// extrarun.js — a run that is not part of the plan, started from the "+" bubble
// on Today.
//
//   shoes (if tracked) → zone → stopwatch, or straight to the log → run log →
//   summary
//
// No warm-up or cool-down, no plan credit (see extra-run.js for what that means
// and how it is kept from leaking into the plan screens). The run log is the
// same screen a planned run uses, told it is logging an extra run.
//
// THE STOPWATCH SURVIVES THE APP GOING AWAY. Its state is timestamps in a
// device-local draft, written on every start, pause and finish. A locked phone,
// a long stretch in Spotify, or iOS discarding the page all come back to the
// same elapsed time, recomputed from the clock. Leaving with "continue later"
// keeps the watch running, and the Today bubble shows the run in progress.

import { el, clear, mount, go, backBtn, registerCleanup } from "../ui.js";
import { getActiveProgram, saveSession, getZoneBounds, getExtraDraft, setExtraDraft, clearExtraDraft } from "../store.js";
import { getProfile } from "../profile.js";
import { zonesFromBounds } from "../cardio-intel.js";
import { todayISO } from "../model.js";
import { extraRunId, weekdayOf, makeExtraSession, startWatch, pauseWatch, resumeWatch, finishWatch, elapsedMs } from "../extra-run.js";
import { logCardio } from "./cardio.js";
import { shoePrompt } from "../components/shoe-picker.js";
import { interruptSheet } from "../components/interrupt.js";
import { beginRunAudio, endRunAudio, muteToggle, unlockAudio, cueItemStart, cueRoutineDone } from "../components/sound.js";
import { lockButton, closeScreenLock } from "../components/screenlock.js";

const ZONE_HINT = { 1: "Very easy", 2: "Easy, conversational", 3: "Tempo", 4: "Threshold", 5: "Max" };

const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
const localStamp = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
};

let wakeLock = null;
async function requestWake() { try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch {} }
function releaseWake() { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; }

export async function renderExtraRun() {
  const stage = el("div.stage");
  mount([stage]);
  const bounds = await getZoneBounds();
  const zones = zonesFromBounds(bounds);

  // A run already under way (or finished and not yet logged) picks up where it was.
  let draft = await getExtraDraft();
  if (draft && draft.watch && draft.watch.finishedAt == null) return stopwatch(stage, draft, zones);
  if (draft && draft.watch && draft.watch.finishedAt != null) return logIt(stage, draft);
  if (draft && draft.logging) return logIt(stage, draft);

  const date = todayISO();
  draft = { date, zone: 2, watch: null, logging: false };
  const profile = await getProfile();
  const features = profile.features || {};
  if (features.shoes) {
    const shoeId = await shoePrompt(stage);
    if (shoeId !== undefined) draft.shoeId = shoeId;
  }
  return setup(stage, draft, zones);
}

function setup(stage, draft, zones) {
  const zoneList = el("div.list", { style: "margin-top:10px" });
  const paintZones = () => zoneList.replaceChildren(...[1, 2, 3, 4, 5].map((z) => {
    const on = draft.zone === z, zo = zones[z];
    return el("button.item" + (on ? ".on" : ""), {
      style: "text-align:left" + (on ? ";border-color:var(--accent)" : ""),
      onclick: () => { draft.zone = z; paintZones(); },
    }, [
      el("span.zchip.z" + z, { text: "Z" + z }),
      el("div.meta", { style: "margin-left:10px" }, [
        el("div.t", { text: ZONE_HINT[z] }),
        el("div.s", { text: `${zo.loBpm}–${zo.hiBpm} bpm` }),
      ]),
    ]);
  }));
  paintZones();
  clear(stage);
  stage.appendChild(el("div", {}, [
    backBtn("Today", "#/"),
    el("div.label", { style: "margin-top:8px", text: "Extra run" }),
    el("h1", { style: "margin:4px 0 0", text: "A run off the plan" }),
    el("p.dim", { text: "It counts in your run history, your kilometres and your shoes. It does not count toward the week's planned sessions." }),
    el("div.label", { style: "margin-top:16px", text: "Run it in" }),
    zoneList,
    el("button.btn.primary.big.block", { style: "margin-top:16px", onclick: async () => {
      unlockAudio();
      draft.watch = startWatch(Date.now());
      await setExtraDraft(draft);
      cueItemStart();
      stopwatch(stage, draft, zones);
    } }, "Start recording"),
    el("button.btn.block", { style: "margin-top:8px", onclick: async () => {
      draft.logging = true;
      await setExtraDraft(draft);
      logIt(stage, draft);
    } }, "Already done it: just log it"),
  ]));
}

function stopwatch(stage, draft, zones) {
  const zo = zones[draft.zone] || zones[2];
  const big = el("div.timer-big.tnum", { text: "0:00" });
  const pauseBtn = el("button.btn.big", { style: "flex:1", onclick: togglePause });
  const status = el("div.faint.center", { style: "margin-top:6px;min-height:1.2em" });
  let tick = null;

  beginRunAudio();
  requestWake();
  const stop = () => { if (tick) clearInterval(tick); tick = null; releaseWake(); endRunAudio(); closeScreenLock(); };
  registerCleanup(stop);

  clear(stage);
  stage.append(
    el("div.routine-head", {}, [
      el("button.btn.ghost", { style: "padding:0", "aria-label": "Leave the run", onclick: leave }, "✕"),
      el("span.spacer"), lockButton(), muteToggle(), el("span.badge.cyan", { text: "Extra run" }),
    ]),
    el("div.hr-target.z" + zo.z, { style: "margin-top:18px" }, [
      el("span.zchip.z" + zo.z, { text: "Z" + zo.z }),
      el("span.hr-band.tnum", { text: `${zo.loBpm}–${zo.hiBpm}` }),
      el("span.hr-unit", { text: "bpm" }),
    ]),
    el("div.timer-wrap", { style: "margin-top:18px" }, [el("div.timer-ring.cyan", { style: "--p:100%" }), big]),
    status,
    el("div.ctl-zone", {}, [
      el("div.btn-row", { style: "margin-top:16px" }, [
        pauseBtn,
        el("button.btn.primary.big", { style: "flex:1", onclick: finish }, "Finish"),
      ]),
    ]),
  );

  function paint() {
    big.textContent = fmtClock(elapsedMs(draft.watch, Date.now()));
    const paused = draft.watch.pausedAt != null;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    status.textContent = paused ? "Paused" : "";
  }
  async function togglePause() {
    const now = Date.now();
    draft.watch = draft.watch.pausedAt != null ? resumeWatch(draft.watch, now) : pauseWatch(draft.watch, now);
    await setExtraDraft(draft);
    paint();
  }
  async function finish() {
    draft.watch = finishWatch(draft.watch, Date.now());
    await setExtraDraft(draft);
    cueRoutineDone();
    stop();
    logIt(stage, draft);
  }
  async function leave() {
    const kind = await interruptSheet({ title: "Leave this run?",
      subtitle: "Continue later keeps the stopwatch running. Pick it up from the + on Today.", resumeLabel: "Keep running" });
    if (kind === "continue") return;
    if (kind === "complete") return finish();
    if (kind === "discard") await clearExtraDraft();
    stop();
    go("#/");
  }

  paint();
  tick = setInterval(paint, 250);
}

async function logIt(stage, draft) {
  const program = await getActiveProgram();
  const w = draft.watch;
  const trackedSec = w && w.finishedAt != null ? Math.round(elapsedMs(w, w.finishedAt) / 1000) : null;
  const date = draft.date || todayISO();
  logCardio(stage, program, { type: "cardio", prescription: "" }, weekdayOf(date), date, {
    trackedSec,
    extra: { zone: draft.zone || 2, startedAtMs: w ? w.startedAt : null },
    onComplete: async (cardioResult) => {
      const started = w ? new Date(w.startedAt) : new Date();
      const session = makeExtraSession({
        id: extraRunId(started), date, cardioResult, zone: draft.zone || 2,
        shoeId: draft.shoeId, completedAt: localStamp(new Date()),
      });
      await saveSession(session);
      await clearExtraDraft();
      go(`#/summary/${session.id}`);
    },
    onExit: async (kind) => {
      if (kind === "discard") await clearExtraDraft();
      go("#/");
    },
  });
}
