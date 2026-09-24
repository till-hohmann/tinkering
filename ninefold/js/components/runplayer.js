// runplayer.js — guided run engine. Plays a list of run segments with a live
// timer, a spoken cue at each segment start ("easy jog" / "speed up" / "slow
// down" / "cool down"), and Pause / Extend / Skip controls. Calls
// onDone(totalSeconds) when the run finishes or is ended early.
//
// segments: [{ kind, label, seconds, cue }]  cue = a sound.js clip key.
//
// LOCKED-SCREEN SUPPORT: iOS freezes JS and SUSPENDS Web Audio when the screen
// locks, so timer-driven (and even Web-Audio-scheduled) cues don't fire. Foreground
// cues are spoken live via say() (Web Audio, blends with music). For the locked
// case the player keeps a "lock timeline" up to date (buildTimeline -> setRunTimeline
// in sound.js): the upcoming cues rendered into ONE continuous clip that sound.js
// plays through a media element at the moment of locking (the only thing that
// survives a lock; it pauses the music, accepted). The rAF loop drives the on-screen
// timer and, on unlock, fast-forwards SILENTLY through segments elapsed while locked
// (their cues were already voiced by the timeline) so nothing double-fires.

import { el, clear, haptic, registerCleanup } from "../ui.js";
import { say, cueTick, cueRoutineDone, muteToggle,
  beginRunAudio, endRunAudio, setRunTimeline, clearRunTimeline, preloadVoice, ensureAudioRunning } from "./sound.js";
import { lockButton, closeScreenLock } from "./screenlock.js";

let wakeLock = null;
async function requestWake() {
  try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch {}
}
function releaseWake() { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; }

const fmt = (s) => {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
};
const ringClass = (kind) => (kind === "hard" ? "hard" : "cyan");

export function runPlayer(container, segments, { onDone } = {}) {
  let idx = 0, paused = false, extending = false, finished = false;
  let segMs = 0, totalMs = 0, extendMs = 0, lastTs = 0, raf = null, lastTick = null;

  beginRunAudio();
  requestWake();
  registerCleanup(() => { if (raf) cancelAnimationFrame(raf); releaseWake(); clearRunTimeline(); endRunAudio(); closeScreenLock(); });

  // --- scaffold ---
  const segK = el("div.k");
  const segNm = el("div.nm");
  const big = el("div.timer-big.tnum", { text: "0:00" });
  const ring = el("div.timer-ring");
  const totalEl = el("span.tnum");
  const nextEl = el("div.faint.center", { style: "margin-top:8px" });
  const bar = el("div.progress-fill");
  const counter = el("span.badge");
  const targetEl = el("div.hr-target");   // live HR band for the active segment

  const pauseBtn = el("button.btn", { onclick: togglePause });
  const extendBtn = el("button.btn", { onclick: toggleExtend });

  // --- lock-timeline cue scheduling ---
  // Render the upcoming cues (from the NEXT segment onward, + "done") into one
  // continuous clip so they fire if the screen locks. The current segment's cue
  // already played live on enter. Called whenever the plan changes.
  function buildTimeline() {
    if (finished) { clearRunTimeline(); return; }
    const cues = [];
    const seg = segments[idx];
    let t = Math.max(0, (seg ? seg.seconds : 0) - segMs / 1000);   // time until the next segment
    for (let j = idx + 1; j < segments.length; j++) { cues.push({ name: segments[j].cue, atSec: t }); t += segments[j].seconds; }
    cues.push({ name: "done", atSec: t });
    setRunTimeline(cues, t);
  }
  // Decode voice clips + ensure the context is running, then build the timeline.
  async function armTimeline() {
    try { await ensureAudioRunning(); } catch {}
    try { await preloadVoice(); } catch {}
    if (finished) return;
    buildTimeline();
  }

  function paint() {
    clear(container);
    container.appendChild(el("div.routine-head", {}, [
      el("button.btn.ghost", { style: "padding:0", onclick: () => finish() }, "✕ End run"),
      el("span.spacer"), lockButton(), muteToggle(), counter,
    ]));
    container.appendChild(el("div.progress", {}, [bar]));
    container.appendChild(el("div.runseg", {}, [segK, segNm]));
    container.appendChild(el("div.timer-wrap", {}, [ring, big]));
    container.appendChild(targetEl);
    container.appendChild(el("div.run-total", {}, [el("span.lab", { text: "Total" }), totalEl]));
    container.appendChild(nextEl);
    container.appendChild(el("div.ctl-zone", {}, [
      el("div.btn-row", { style: "margin-top:16px" }, [pauseBtn, extendBtn,
        el("button.btn", { onclick: skip }, "Skip ›")]),
    ]));
  }

  function enterSegment(i, opts = {}) {
    if (i >= segments.length) return finish();
    idx = i; segMs = 0; extending = false; lastTick = null;
    const seg = segments[idx];
    segK.textContent = seg.kind.toUpperCase();
    segK.className = "k " + seg.kind;
    segNm.textContent = seg.label;
    counter.textContent = `Segment ${idx + 1}/${segments.length}`;
    ring.className = "timer-ring " + ringClass(seg.kind);
    const next = segments[idx + 1];
    nextEl.textContent = next ? "Next: " + next.label : "Last segment";
    extendBtn.textContent = "Extend";
    // live HR target band — glance to confirm you're actually in the zone
    clear(targetEl);
    const t = seg.target;
    if (t) {
      targetEl.className = "hr-target z" + t.z;
      targetEl.appendChild(el("span.zchip.z" + t.z, { text: "Z" + t.z }));
      targetEl.appendChild(el("span.hr-band.tnum", { text: `${t.loBpm}–${t.hiBpm}` }));
      targetEl.appendChild(el("span.hr-unit", { text: `bpm · RPE ${t.rpe}` }));
    } else {
      targetEl.className = "hr-target";
    }
    haptic(20);
    // Live foreground cue. Suppressed during the post-unlock catch-up (opts.silent)
    // because the lock timeline already voiced those segments while the screen was off.
    if (!opts.silent && !document.hidden) say(seg.cue);
    buildTimeline();   // refresh the lock timeline for the new position
  }

  function render() {
    const seg = segments[idx];
    if (!seg) return;
    const segSec = seg.seconds;
    if (extending) {
      ring.className = "timer-ring extend";
      ring.style.setProperty("--p", "100%");
      big.textContent = "+" + fmt(extendMs / 1000);
    } else {
      const rem = segSec - segMs / 1000;
      ring.className = "timer-ring " + ringClass(seg.kind);
      ring.style.setProperty("--p", `${Math.max(0, Math.min(100, (rem / segSec) * 100))}%`);
      big.textContent = fmt(rem);
      const whole = Math.ceil(rem);
      if (whole !== lastTick) { lastTick = whole; if (!paused && whole <= 3 && whole > 0) cueTick(); }
    }
    bar.style.width = `${Math.round((idx / segments.length) * 100)}%`;
    totalEl.textContent = fmt(totalMs / 1000);
  }

  function loop(now) {
    if (finished) return;
    const dt = lastTs ? now - lastTs : 0;
    lastTs = now;
    // A big gap means JS was frozen (screen locked) and the lock timeline carried
    // the cues — so fast-forward SILENTLY, don't re-announce on unlock.
    const resumed = dt > 1500;
    if (!paused) { segMs += dt; totalMs += dt; if (extending) extendMs += dt; }
    if (!paused && !extending) {
      let guard = 0;
      while (segments[idx] && segMs >= segments[idx].seconds * 1000 && guard++ < 500) {
        const over = segMs - segments[idx].seconds * 1000;
        enterSegment(idx + 1, { silent: resumed });
        if (finished) return;
        segMs = over;
      }
    }
    render();
    raf = requestAnimationFrame(loop);
  }

  function togglePause() {
    paused = !paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    lastTs = 0; // drop the accumulated gap on resume
    if (paused) clearRunTimeline();
    else buildTimeline();   // rebuild the lock timeline from here
  }
  function toggleExtend() {
    if (extending) { extending = false; enterSegment(idx + 1); }
    else { extending = true; extendMs = 0; extendBtn.textContent = "Stop extend"; clearRunTimeline(); }
  }
  function skip() { if (!finished) enterSegment(idx + 1); }

  function finish() {
    if (finished) return;
    finished = true;
    if (raf) cancelAnimationFrame(raf);
    releaseWake();
    clearRunTimeline();
    closeScreenLock();
    if (!document.hidden) say("done");   // foreground; if it ended locked the timeline already said it
    cueRoutineDone();
    const total = Math.round(totalMs / 1000);
    clear(container);
    container.appendChild(el("div.routine-done.center", {}, [
      el("div.tick", { html: "✓" }),
      el("h2", { text: "Run complete" }),
      el("p.dim", { text: `${fmt(total)} moving time` }),
    ]));
    setTimeout(() => { endRunAudio(); onDone && onDone(total); }, 900);
  }

  pauseBtn.textContent = "Pause";
  extendBtn.textContent = "Extend";
  paint();
  enterSegment(0);
  armTimeline();
  raf = requestAnimationFrame(loop);
  return { stop: () => finish() };
}
