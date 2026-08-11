// routine.js — Tabata-style timed routine engine (requirements §6).
// runRoutine(container, routineDef, program, { onComplete, title }) renders the
// engine into `container` and calls onComplete({completed}) when finished/exited.
//
// Continuous run: transition countdown -> item timer -> next, automatically.
// Bilateral items run twice (Left/Right). Rounds repeat the whole list.
// Checklist items are tap-to-complete and can be mixed with timed items.
//
// LOCKED-SCREEN SUPPORT (same approach as runplayer.js): iOS freezes JS and
// SUSPENDS Web Audio when the screen locks, so timer-driven cues stop and the step
// never advances. The engine is WALL-CLOCK based — one rAF loop accumulates real
// elapsed time and, on unlock, fast-forwards through every step that lapsed while
// frozen. Foreground cues are spoken live via say(); for the locked case it keeps a
// "lock timeline" (buildTimeline -> setRunTimeline) — the upcoming voice cues
// rendered into ONE continuous clip that sound.js plays through a media element at
// the moment of locking (the only thing that survives a lock). Checklist items are
// a BARRIER: the Done-tap time isn't predictable, so the timeline stops at the next
// checklist and resumes once it's completed.

import { el, clear, haptic, registerCleanup } from "../ui.js";
import { illustration } from "../illustrations.js";
import { cueTick, cueItemStart, cueItemEnd, cueRoutineDone, say, muteToggle,
  beginRunAudio, endRunAudio, setRunTimeline, clearRunTimeline, preloadVoice, ensureAudioRunning,
  cueInhale, cueExhale } from "../components/sound.js";
import { lockButton, closeScreenLock } from "../components/screenlock.js";
import { breathsRemaining, breathPhaseAt, isInhale, breathSwell } from "../yoga/breath.js";
import { loadNarration, narrationReady, speak, prefetch, stopNarration, resumeNarration,
  stageNarration, resetNarration } from "../yoga/narrate.js";

let wakeLock = null;
async function requestWake() {
  try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch {}
}
function releaseWake() { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; }

// --- SVG text (immune to iOS standalone-PWA font boosting; see setName) -----
const FONT_STACK = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif`;
let mctx = null;
function measureText(text, size, weight) {
  if (!mctx) mctx = document.createElement("canvas").getContext("2d");
  mctx.font = `${weight} ${size}px ${FONT_STACK}`;
  return mctx.measureText(text).width;
}
// Split at the space nearest the middle so a wrapped title reads as two
// balanced centred lines (deterministic — WE do the layout, not the browser).
function splitBalanced(text) {
  const mid = text.length / 2;
  let best = null;
  for (let i = text.indexOf(" "); i !== -1; i = text.indexOf(" ", i + 1))
    if (best === null || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
  return best === null ? [text] : [text.slice(0, best), text.slice(best + 1)];
}
const SVG_NS = "http://www.w3.org/2000/svg";
export function svgText(text, { size = 20, weight = 800, maxLines = 1, maxWidth = 340 } = {}) {
  let lines = [String(text)];
  if (maxLines > 1 && measureText(lines[0], size, weight) > maxWidth) lines = splitBalanced(lines[0]);
  const pad = 7, lineH = Math.ceil(size * 1.25);
  const w = Math.ceil(Math.max(...lines.map((l) => measureText(l, size, weight)))) + pad * 2;
  const h = lineH * lines.length + 4;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  // width capped at the natural size; a narrower screen scales the whole svg
  // (and its text) down proportionally — shrink, never clip.
  svg.style.cssText = `display:block;margin:0 auto;width:min(100%,${w}px);height:auto`;
  lines.forEach((l, i) => {
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", w / 2);
    t.setAttribute("y", (i + 1) * lineH - size * 0.22);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", size);
    t.setAttribute("font-weight", weight);
    t.setAttribute("font-family", FONT_STACK);
    t.setAttribute("fill", "currentColor");
    t.textContent = l;
    svg.appendChild(t);
  });
  return svg;
}

// Expand a routine definition into a flat list of steps.
//
// TRANSITIONS ARE PER-ITEM, falling back to the routine's own default. The
// mobility routine wants one number for everything; a yoga flow does not. A
// vinyasa's linked movements have NO transition at all — "one breath, one
// movement" is the definition of the thing, and a five-second pause to "get into
// position" between the halves of a sun salutation breaks it — while a change
// from standing to a propped floor shape needs longer than either.
function buildSteps(def) {
  const steps = [];
  const rounds = def.rounds || 1;
  const fallback = def.transitionSeconds != null ? def.transitionSeconds : 5;
  const transFor = (it) => (it.transitionSeconds != null ? it.transitionSeconds : fallback);
  for (let r = 1; r <= rounds; r++) {
    for (const it of def.items) {
      if (it.once && r > 1) continue; // intro items (e.g. HR-down walk) play once, not every round
      if (it.mode === "checklist") {
        steps.push({ type: "checklist", item: it, round: r });
      } else {
        const sides = it.bilateral ? ["Left", "Right"] : [null];
        for (const side of sides) {
          const trans = transFor(it);
          if (trans > 0) steps.push({ type: "transition", item: it, side, seconds: trans, round: r });
          steps.push({ type: "timed", item: it, side, seconds: it.durationSeconds, round: r });
        }
      }
    }
  }
  return { steps, rounds };
}

// stretch holds get the spoken "stretch" cue; dynamic items (cardio, swings,
// circles) just get the start beep so we never mis-announce them.
// Adductors and dead hangs were missing: both are timed holds you can fail —
// exactly what the end-hold button is for — and neither name contains the word
// "stretch". Everything still excluded here is dynamic work on a fixed clock
// (an easy jog, leg swings, ankle rolls), where "how long did you hold it" is
// not a meaningful question.
const STRETCH_RE = /hamstring|quad|glute|hip_flex|chest|lat|tspine|calf|calv|stretch|figure|doorway|worlds_greatest|adductor|butterfly|dead[_ ]?hang/i;
export const isStretch = (item) => STRETCH_RE.test(item.id || "") || /stretch/i.test(item.name || "");

// AN ITEM MAY STATE ITS CUE KIND INSTEAD OF BEING GUESSED AT.
//
// The regex above works because the mobility routine's ids are English words
// describing body parts. No asana name will ever match it — "Utthita
// Trikonasana" contains none of those strings — so every pose in a yoga flow
// would have been announced with the beep meant for dynamic warm-up work. Rather
// than extend the regex with 110 Sanskrit names, an item can now say what it is:
//
//   "hold"  — a shape you settle into and can fail to maintain (the "stretch" cue)
//   "flow"  — a linked movement, one breath one movement (no spoken cue at all,
//             because announcing every step of a sun salutation is chatter)
//   "rest"  — savasana and the like: no cue, nothing to announce
//
// Items with no `cueKind` fall back to the regex, so the mobility routine and the
// warm-ups are untouched.
export function cueKindOf(item) {
  if (item && item.cueKind) return item.cueKind;
  return isStretch(item) ? "hold" : "dynamic";
}

// The breath arithmetic lives in yoga/breath.js — pure, DOM-free and tested.
// Re-exported here because this is where callers expect to find it.
export { breathsRemaining, breathPhaseAt, isInhale, breathSwell } from "../yoga/breath.js";

// Each warm-up / cool-down movement gets its own movement-figure tile — the same
// glowing, tinted-tile illustration the main lifts use — resolved from its id.
function stepFigure(item) {
  return { anat: false, node: illustration(item.illustrationId || item.id) };
}

function labelFor(step) {
  if (!step) return null;
  const name = step.item.name;
  return step.side ? `${name} — ${step.side}` : name;
}
function nextActiveLabel(steps, fromIdx) {
  for (let i = fromIdx + 1; i < steps.length; i++) {
    if (steps[i].type === "timed" || steps[i].type === "checklist") return labelFor(steps[i]);
  }
  return "Finish";
}

export function runRoutine(container, def, program, opts = {}) {
  const { onComplete, title } = opts;
  const { steps, rounds } = buildSteps(def);
  let idx = 0, segMs = 0, curExtra = 0;        // current step, ms elapsed in it, +15s additions
  let paused = false, extending = false, extendStart = 0, extendRaf = null;
  let finished = false;
  let raf = null, lastTs = 0, lastTick = null;

  beginRunAudio();   // manage the audio session; the lock timeline carries cues if the screen locks
  requestWake();
  registerCleanup(() => {
    if (raf) cancelAnimationFrame(raf);
    if (extendRaf) cancelAnimationFrame(extendRaf);
    clearRunTimeline(); releaseWake(); endRunAudio(); closeScreenLock(); resetNarration();
  });

  function fmt(s) {
    const m = Math.floor(s / 60), sec = s % 60;
    return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : String(sec);
  }
  const curDur = () => (steps[idx] ? (steps[idx].seconds || 0) + curExtra : 0);

  // --- DOM scaffold (built once; countdown text updated in place) ---
  const big = el("div.timer-big.tnum", { text: "0" });
  // ⚠ THE SIDE GOES ON THE NAME, NOT ON A ROW OF ITS OWN.
  //
  // It used to sit in its own centred row above the title, which cost 37px
  // (29 tall plus an 8px margin) on every bilateral pose — and most poses are
  // bilateral. On a 375x667 phone that alone pushed the player 34px past one
  // screen, so you had to scroll to reach Pause while holding pigeon. The
  // screen was only ever measured on the FIRST step, which is seated centering:
  // not bilateral, so the row was collapsed and the fit looked fine.
  //
  // "Pyramid — Left" in the title is also simply better: it is the phrasing the
  // "Next:" line already uses, and the side is more prominent there, not less.
  const nameEl = el("h2.center.routine-name", { style: "margin:6px 0 2px" });
  const sanskritEl = el("p.faint.center.sanskrit", { style: "margin:0 0 4px;display:none" });
  const cueEl = el("p.note.center", { style: "min-height:1.2em;padding:0 12px" });
  // THE MODIFICATION IS ALWAYS ON SCREEN, never behind a tap.
  // Accessibility is the whole brand of the practices people actually finish, and
  // the one thing a home practitioner cannot do is ask. A way into the pose that
  // you have to go looking for is a way into the pose you do not take.
  const easierEl = el("p.faint.center.easier", { style: "margin:6px 12px 0;display:none" });
  const illo = el("div.routine-illo");
  const nextEl = el("div.faint.center", { style: "margin-top:8px" });
  const unitEl = el("div.faint.center.breathunit", { style: "margin-top:-4px;display:none" });
  const roundEl = el("span.badge");
  const bar = el("div.progress-fill");
  const ring = el("div.timer-ring");
  // THE BREATHING ORB — what a breath-paced hold gets instead of a countdown.
  //
  // A depleting ring is a clock with a nicer hat: it tells you how much of the
  // pose is left, which is the one thing a breath-counted hold is deliberately
  // NOT about. The orb is something to breathe WITH — it swells through the
  // inhale, settles through the exhale, and the guide circle behind it is where
  // a full breath reaches. The number in the middle still counts the breaths.
  const orbGuide = el("div.breath-guide");
  const orb = el("div.breath-orb");

  const pauseBtn = el("button.btn", {}, "Pause");
  const extendBtn = el("button.btn", { onclick: () => toggleExtend() }, "Extend");
  pauseBtn.onclick = () => {
    if (extending) return;
    const step = steps[idx];
    if (!step || step.type === "checklist") return;
    paused = !paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    lastTs = 0;                       // drop the gap accumulated while paused
    if (paused) clearRunTimeline(); else buildTimeline();

    // PAUSE MEANS PAUSE, INCLUDING THE VOICE. It kept talking through a pause,
    // which is wrong on its face — you paused for a reason, and being lectured
    // about hip alignment while you answer the door is the opposite of what the
    // button is for.
    //
    // RESUME CONTINUES THE PASSAGE, it does not restart it. The first version
    // re-said the pose from its name down, which on a long hold meant hearing
    // the entire entry a second time to recover the one sentence you missed.
    // narrate.js keeps the sentence that was cut; this picks up from it.
    if (narrate) {
      if (paused) stopNarration();
      else resumeNarration();
    }
  };

  // --- hold tracking (opts.trackHolds — the mobility progression engine) -----
  // Records the ACTUAL seconds each timed hold lasted, keyed by step index so a
  // redo (‹ Back) overwrites cleanly: full completions log the full duration
  // (incl. +15s / Extend time), "End hold" and Skip log the elapsed time at the
  // press. The engine consumes the worst side per exercise to progress targets
  // honestly instead of assuming every hold was made.
  const trackHolds = !!opts.trackHolds;
  // WHICH steps offer "end hold". Mobility tracks every timed item; a warm-up
  // tracks only its stretches, because "how long did you hold it" is not a
  // question an easy jog or a set of leg swings is answering.
  const tracked = (step) => trackHolds && step && step.type === "timed"
    && (!opts.trackWhen || opts.trackWhen(step.item));
  const holdRecords = {};   // stepIdx -> { id, side, targetSec, heldSec }
  function recordHold(heldSec) {
    const step = steps[idx];
    if (!tracked(step)) return;
    holdRecords[idx] = { id: step.item.id, side: step.side || null,
      targetSec: step.seconds, heldSec: Math.round(Math.max(0, heldSec)) };
  }
  const holdList = () => Object.values(holdRecords);
  const endHoldBtn = el("button.btn.block.endhold", { style: "display:none;margin-bottom:10px",
    onclick: () => {
      const step = steps[idx];
      if (!step || step.type !== "timed") return;
      recordHold(extending ? curDur() + (performance.now() - extendStart) / 1000 : segMs / 1000);
      extending = false;
      goto(idx + 1);
    } }, "✋ End hold — log my time");

  const controls = el("div", { style: "margin-top:14px" }, [
    endHoldBtn,
    el("div.btn-row", {}, [pauseBtn, extendBtn]),
    el("div.btn-row", { style: "margin-top:10px" }, [
      el("button.btn", { onclick: () => goto(idx - 1) }, "‹ Back"),
      el("button.btn", { onclick: () => { if (steps[idx] && steps[idx].type !== "checklist" && !extending) { curExtra += 15; buildTimeline(); } } }, "+15s"),
      el("button.btn", { onclick: () => { recordHold(segMs / 1000); goto(idx + 1); } }, "Skip ›"),
    ]),
  ]);

  function paint() {
    clear(container);
    container.appendChild(el("div.routine-head", {}, [
      el("button.btn.ghost", { style: "padding:0", onclick: () => cleanup(false) }, "✕ End"),
      el("span.spacer"),
      lockButton(),
      muteToggle(),
      roundEl,
    ]));
    container.appendChild(el("div.progress", {}, [bar]));
    container.appendChild(illo);
    container.appendChild(nameEl);
    container.appendChild(sanskritEl);
    container.appendChild(cueEl);
    container.appendChild(easierEl);
    container.appendChild(el("div.timer-wrap", {}, [ring, orbGuide, orb, big]));
    container.appendChild(unitEl);
    container.appendChild(nextEl);
  }

  function setIllo(item) {
    clear(illo);
    const f = stepFigure(item);
    illo.classList.toggle("anat", f.anat);   // wider, auto-height layout for the body map
    illo.appendChild(f.node);
  }

  // --- iOS-proof text rendering (FINAL fix, 2026-07-23) ---------------------
  // Root-caused from an on-device screenshot at v122: in the standalone PWA,
  // iOS scales text AFTER layout (font boosting) — the line never re-wraps, it
  // just paints wider than the screen and the centered overflow clips on BOTH
  // sides ("t into posit"). Layout metrics claim it fits, so no CSS wrap rule or
  // JS measurement can even SEE the problem. Fix: render the step title, cue and
  // next-up lines as SVG TEXT — font boosting does not apply inside SVG, the
  // viewBox scales like an image, and the glyphs physically cannot escape it.
  function setName(text) { clear(nameEl); nameEl.appendChild(svgText(text, { size: 20, weight: 800, maxLines: 2 })); }
  function setCue(text) { clear(cueEl); if (text) cueEl.appendChild(svgText(text, { size: 14, weight: 500, maxLines: 2, maxWidth: 320 })); }
  function setNext(text) { clear(nextEl); nextEl.appendChild(svgText(text, { size: 14, weight: 500, maxLines: 1 })); }
  function setSanskrit(text) {
    clear(sanskritEl);
    sanskritEl.style.display = text ? "" : "none";
    if (text) sanskritEl.appendChild(svgText(text, { size: 12, weight: 500, maxLines: 1, maxWidth: 320 }));
  }
  function setEasier(text) {
    clear(easierEl);
    easierEl.style.display = text ? "" : "none";
    if (text) easierEl.appendChild(svgText("Easier: " + text, { size: 12, weight: 500, maxLines: 2, maxWidth: 320 }));
  }

  // --- lock-timeline cue scheduling (fires while the screen is locked) ---
  // The voice clip a step announces, or null for steps that use a tone (dynamic
  // warm-up items) — those aren't in the timeline (a tone isn't a voice clip).
  function voiceCue(step) {
    if (!step) return null;
    if (step.type === "transition") return "position";
    if (step.type === "timed" && isStretch(step.item)) return "stretch";
    return null;
  }
  // Render the voice cues for the upcoming timed/transition steps — from the NEXT
  // step up to the next checklist barrier — into one clip that plays if the
  // screen locks. The current step's cue already played live on enter. A checklist
  // is a barrier: nothing to play, so clear the timeline until Done.
  function buildTimeline() {
    if (finished) { clearRunTimeline(); return; }
    const cur = steps[idx];
    if (!cur || cur.type === "checklist") { clearRunTimeline(); return; }
    const cues = [];
    let t = Math.max(0, curDur() - segMs / 1000);   // time until the next step
    for (let j = idx + 1; j < steps.length; j++) {
      const s = steps[j];
      if (s.type === "checklist") break;     // barrier: can't predict the Done tap
      const c = voiceCue(s); if (c) cues.push({ name: c, atSec: t });
      t += (s.seconds || 0);
    }
    if (cues.length) setRunTimeline(cues, t); else clearRunTimeline();
  }
  // Decode the voice clips + ensure the context is running, then build the timeline.
  async function armTimeline() {
    try { await ensureAudioRunning(); } catch {}
    try { await preloadVoice(); } catch {}
    if (finished) return;
    buildTimeline();
  }

  // --- breath pacing (yoga) --------------------------------------------------
  // A yoga hold is counted in BREATHS, not seconds — five breaths in triangle,
  // not twenty-five seconds in triangle — so on a breath-paced item the big
  // number counts breaths down and a soft rising/falling tone marks each one.
  //
  // Driven from the SAME wall-clock accumulator as everything else rather than
  // from its own interval. That is what makes it survive a pause (segMs simply
  // stops), a +15s, an Extend, and the screen going off and coming back: an
  // independent timer would drift out of step with the pose it is pacing, which
  // is worse than no pacer at all.
  // THE TEACHER'S VOICE. opts.narrate = { level, entryFor(step), exitFor(step) }
  // supplied by the yoga session view; absent for the mobility routine and the
  // warm-ups, which keep their own short cues.
  const narrate = opts.narrate || null;
  let narrationOn = false;
  if (narrate) loadNarration(narrate.level).then((ok) => {
    narrationOn = ok;
    // THE MANIFEST IS A FETCH; STEP 0 IS NOT.
    //
    // enterStep(0) runs synchronously at startup, so the first pose was reached
    // before this resolved — the narrator wasn't "on" yet, the step fell through
    // to the legacy cue chain, and the practice opened by announcing "stretch"
    // over a seated centering. Speak it now that we can, provided the practice
    // is still sitting on the pose that missed out.
    if (ok && !finished && spokenPose === null) {
      const step = steps[idx];
      if (step && (step.type === "transition" || step.type === "timed")) sayEntry(step, { catchUp: true });
    }
  });
  let saidExitFor = -1;
  // Which pose the narrator is currently talking about. A transition and its
  // hold are ONE pose, so this is what stops the entry passage being restarted
  // (or cut off mid-sentence) when the hold begins.
  let spokenPose = null;
  const poseKeyOf = (step) =>
    step && step.item ? (step.item.itemId || step.item.id) + "|" + (step.side || "") : null;
  /** Say the right half for this step. The single place that decides. */
  function sayEntry(step, { catchUp = false } = {}) {
    if (!narrate || !narrationOn || !step) return;
    const key = poseKeyOf(step);
    if (key !== spokenPose) { stopNarration(); spokenPose = key; saidArriveAt = null; saidExitFor = -1; }
    // WHILE PAUSED, STAGE IT — DON'T SAY IT. Skipping to another pose with the
    // practice paused still lands you on a pose, and that pose's guidance is
    // what Resume owes you; speaking it now would make the pause button mean
    // "pause everything except the talking".
    const say = (parts) => {
      if (!parts || !parts.length) return false;
      if (paused) stageNarration(narrate.level, parts);
      else speak(narrate.level, parts);
      return true;
    };
    if (step.type === "transition") {
      if (say(narrate.arriveFor(step, idx))) saidArriveAt = key;
      return;
    }
    // A catch-up on a hold gets the WHOLE passage: the moving half was never
    // said, so starting at the alignment cues would skip the pose's own name.
    say((!catchUp && saidArriveAt === key)
      ? narrate.settleFor(step, idx)
      : narrate.entryFor(step, idx));
  }
  // Which pose has already had its "moving into X, do this to get there" half
  // spoken during the transition, so the hold picks up from the refinements.
  let saidArriveAt = null;

  const breathSeconds = def.breathSeconds || 0;
  const isBreathPaced = (step) => !!(breathSeconds && step && step.type === "timed"
    && step.item.breathPaced && step.item.holdBreaths);
  let lastHalf = -1;
  // How far the orb travels between the bottom of an exhale and the top of an
  // inhale, as a fraction of the guide circle. Not 0→1: an orb that vanishes at
  // the end of every exhale reads as the pacer stopping, and one that fills the
  // guide exactly leaves nothing to breathe toward.
  const ORB_MIN = 0.42, ORB_MAX = 0.97;
  function startBreathPacer(step) {
    lastHalf = -1;
    const on = isBreathPaced(step);
    unitEl.style.display = on ? "" : "none";
    if (on) unitEl.textContent = step.item.holdBreaths === 1 ? "breath" : "breaths";
    // The orb and the ring are alternatives, never both.
    orb.style.display = on ? "" : "none";
    orbGuide.style.display = on ? "" : "none";
    ring.style.display = on ? "none" : "";
    if (on) orb.style.setProperty("--s", String(ORB_MIN));
  }
  /**
   * Drive the orb from the same clock the audio pacer uses, so the swell and the
   * breath sound cannot drift apart. The curve itself is in yoga/breath.js with
   * the rest of the breath arithmetic, where it is testable — rAF does not run
   * in a hidden preview, so anything left in here can only be read back.
   */
  function paintOrb(elapsedSec) {
    const swell = breathSwell(elapsedSec, breathSeconds);
    orb.style.setProperty("--s", (ORB_MIN + (ORB_MAX - ORB_MIN) * swell).toFixed(3));
    orb.classList.toggle("out", !isInhale(breathPhaseAt(elapsedSec, breathSeconds)));
  }
  function paceBreath(step, elapsedSec) {
    if (!isBreathPaced(step) || paused) return;
    const half = breathPhaseAt(elapsedSec, breathSeconds);
    if (half === lastHalf) return;
    const first = lastHalf === -1;
    lastHalf = half;
    // Don't fire a burst of cues catching up after the screen was off.
    if (first && elapsedSec > breathSeconds) return;
    if (isInhale(half)) cueInhale(breathSeconds / 2); else cueExhale(breathSeconds / 2);
  }

  // --- per-frame display (driven by the wall-clock loop) ---
  function render() {
    const step = steps[idx];
    if (!step || step.type === "checklist" || extending) return;
    const dur = curDur();
    const elapsed = segMs / 1000;
    const rem = Math.max(0, dur - elapsed);
    if (isBreathPaced(step)) {
      // Count the breaths, not the clock. Ceil so it reads "5" for the whole of
      // the first breath and only turns over when that breath is done.
      big.textContent = String(breathsRemaining(rem, breathSeconds));
      paceBreath(step, elapsed);
      // Frozen while paused: an orb still breathing at you through a pause is
      // the same mistake as the voice still talking through one.
      if (!paused) paintOrb(elapsed);
    } else {
      big.textContent = fmt(Math.ceil(rem));
    }
    ring.style.setProperty("--p", `${Math.max(0, Math.min(100, dur > 0 ? (rem / dur) * 100 : 0))}%`);
    ring.classList.toggle("transition", step.type === "transition");
    // "One more breath, then we move on" — spoken as the LAST breath begins, so
    // it lands while there is still a breath to take rather than as a farewell.
    if (narrate && narrationOn && step.type === "timed" && !paused && idx !== saidExitFor
        && breathSeconds && rem > 0 && rem <= breathSeconds * 1.15 && dur > breathSeconds * 2) {
      saidExitFor = idx;
      const parts = narrate.exitFor(step, idx);
      if (parts) speak(narrate.level, parts);
    }
    const whole = Math.ceil(rem);
    // The 3-2-1 tick is for a clock. On a breath-paced hold it fights the pacer,
    // and "hurry up" is the opposite of what the last breath of a pose wants.
    if (whole !== lastTick) {
      lastTick = whole;
      if (!paused && step.type === "timed" && !isBreathPaced(step) && whole <= 3 && whole > 0) cueTick();
    }
    bar.style.width = `${Math.round((idx / steps.length) * 100)}%`;
  }

  // --- enter a step: set up chrome + fire its start cue ---
  function enterStep(i, stepOpts = {}) {
    if (i >= steps.length) return done();
    idx = i; segMs = 0; curExtra = 0; lastTick = null;
    extending = false; if (extendRaf) { cancelAnimationFrame(extendRaf); extendRaf = null; }
    extendBtn.textContent = "Extend";
    ring.classList.remove("extend");
    const step = steps[idx];

    roundEl.textContent = rounds > 1 ? `Round ${step.round}/${rounds}` : (title || "Routine");
    // ⚠ ON A TRANSITION, LOOK PAST THE POSE YOU ARE ENTERING. A transition step
    // is immediately followed by its OWN timed step, so scanning from here found
    // the very thing the cue line above is already announcing — the screen read
    // "Next: Easy cardio" in the middle and "Next: Easy cardio" again at the
    // bottom, at the exact moment it is meant to be telling you two different
    // things. Starting one later skips the paired hold and names what actually
    // follows it.
    setNext("Next: " + nextActiveLabel(steps, step.type === "transition" ? idx + 1 : idx));
    setIllo(step.item);
    setCue(step.item.cue || "");
    setSanskrit(step.type === "transition" ? "" : (step.item.sanskrit || ""));
    setEasier(step.type === "transition" ? "" : (step.item.easier || ""));

    if (step.type === "checklist") {
      ring.style.display = "none"; big.style.display = "none";
      orb.style.display = "none"; orbGuide.style.display = "none";
      setName(labelFor(step));
      renderChecklistControls();
      clearRunTimeline();              // barrier — waits for the Done tap
      return;
    }

    ring.style.display = ""; big.style.display = "";
    if (step.type === "transition") { setName("Get into position"); setCue("Next: " + labelFor(step)); }
    else setName(labelFor(step));
    renderTimedControls();

    // Live foreground cue. Suppressed on the post-unlock catch-up (opts.silent),
    // since the lock timeline already voiced those steps while the screen was off.
    endHoldBtn.style.display = tracked(step) ? "" : "none";
    const sayLive = !stepOpts.silent && !document.hidden;
    const kind = cueKindOf(step.item);
    // WITH A NARRATOR, SHE IS THE CUE. The old behaviour borrowed the warm-up's
    // "stretch" clip for every pose, which announced "stretch" over a warrior.
    //
    // AND SHE SPEAKS DURING THE TRANSITION, not once you are already in the pose.
    // "Get into position" is precisely the window where being told how to get
    // into position is useful; saying it after you have arrived is instructions
    // for something you have already done. The hold then begins with the pose
    // already explained, and the voice carries on into it if there is more to
    // say — which is what a teacher does.
    //
    // Keyed on the POSE, not the step: a transition and its hold are one pose,
    // so the narration starts at the transition and is NOT restarted or cut off
    // when the hold begins.
    // THE PASSAGE IS SPLIT ACROSS THE TWO STEPS, the way a teacher splits it:
    //
    //   transition  "Now we're moving into pigeon. Bring your right shin
    //                forward..."          — said WHILE you move
    //   hold        "Angle the front shin. Hips square..."
    //                                     — said once you are in the shape
    //
    // Playing the whole passage at the transition would not fit: a transition is
    // four to twelve seconds and the passage is twenty-five, so the alignment
    // cues would land long after you had settled. Playing it all at the hold was
    // the old behaviour, and told you how to get into a pose you were already in.
    //
    // GATED ON `narrate`, NOT ON `narrationOn`. The manifest is a fetch and step
    // zero is not, so gating on "the narrator has loaded" let the first pose fall
    // through to the legacy chain below and open the practice by saying
    // "stretch". A configured narrator owns the cues from the first frame, even
    // in the moment before she can speak; the catch-up above fills that gap.
    if (narrate && (step.type === "transition" || step.type === "timed")) {
      if (!stepOpts.silent) sayEntry(step);
      else { spokenPose = poseKeyOf(step); saidArriveAt = null; saidExitFor = -1; }
      haptic(step.type === "transition" ? 10 : 15);
      // Warm the NEXT pose's clips while this one runs, so the voice never waits
      // on the network in the middle of a practice.
      if (narrationOn) {
        const nx = steps[idx + 1] && steps[idx + 1].type === "transition" ? steps[idx + 2] : steps[idx + 1];
        if (nx && nx.type === "timed") prefetch(narrate.level, narrate.entryFor(nx, idx + 1) || []);
      }
    }
    else if (step.type === "transition") { if (sayLive && !narrate) say("position"); haptic(10); }
    else if (kind === "hold") { if (sayLive) say("stretch"); haptic(20); }
    else if (kind === "flow") { haptic(10); }        // linked movement: no announcement
    else if (kind === "rest") { /* savasana — nothing at all */ }
    else { if (sayLive) cueItemStart(); haptic(20); }
    startBreathPacer(step);
    buildTimeline();   // refresh the lock timeline for the new position
    render();
  }

  function renderTimedControls() {
    container.querySelectorAll(".ctl-zone").forEach((n) => n.remove());
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    container.appendChild(el("div.ctl-zone", {}, [controls]));
  }
  function renderChecklistControls() {
    container.querySelectorAll(".ctl-zone").forEach((n) => n.remove());
    container.appendChild(el("div.ctl-zone", {}, [
      el("button.btn.primary.big.block", { style: "margin-top:14px", onclick: () => goto(idx + 1) }, "✓ Done"),
      el("div.btn-row", { style: "margin-top:10px" }, [
        el("button.btn", { onclick: () => goto(idx - 1) }, "‹ Back"),
        el("button.btn", { onclick: () => goto(idx + 1) }, "Skip ›"),
      ]),
    ]));
  }

  // --- the wall-clock loop: accumulate real time, fast-forward lapsed steps ---
  function loop(now) {
    if (finished) return;
    const dt = lastTs ? now - lastTs : 0;
    lastTs = now;
    // A big gap means JS was frozen (screen locked) and the lock timeline carried
    // the cues — so fast-forward SILENTLY, don't re-announce on unlock.
    const resumed = dt > 1500;
    const step = steps[idx];
    if (!paused && !extending && step && step.type !== "checklist") {
      segMs += dt;
      let guard = 0;
      // advance through every timed/transition step that elapsed (handles a long
      // gap while the screen was locked); stop at a checklist barrier or the end.
      while (steps[idx] && steps[idx].type !== "checklist" && segMs >= curDur() * 1000 && guard++ < 2000) {
        const over = segMs - curDur() * 1000;
        recordHold(curDur());   // completed in full (incl. +15s extras)
        if (steps[idx].type === "timed" && !resumed && !document.hidden) { cueItemEnd(); haptic(30); }
        enterStep(idx + 1, { silent: resumed });
        if (finished) return;
        segMs = over;
      }
    }
    if (!finished) { render(); raf = requestAnimationFrame(loop); }
  }

  // --- extend the current timed segment open-endedly (counts up) ---
  function extFmt(s) { const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}:${String(sec).padStart(2, "0")}`; }
  function toggleExtend() {
    const step = steps[idx];
    if (!step || step.type !== "timed") return;
    if (extending) { recordHold(curDur() + (performance.now() - extendStart) / 1000); goto(idx + 1); }   // "Stop extend" -> next segment
    else startExtend();
  }
  function startExtend() {
    extending = true;
    clearRunTimeline();
    extendStart = performance.now();
    extendBtn.textContent = "Stop extend";
    pauseBtn.textContent = "Pause";
    ring.classList.remove("transition");
    ring.classList.add("extend");
    ring.style.setProperty("--p", "100%");
    // Extending is open-ended time, not breaths — the amber ring is the whole
    // signal that the clock has stopped counting down, so it has to be visible
    // even on a hold that was showing the orb.
    orb.style.display = "none"; orbGuide.style.display = "none";
    ring.style.display = "";
    const eloop = () => {
      if (!extending) return;
      big.textContent = "+" + extFmt((performance.now() - extendStart) / 1000);
      extendRaf = requestAnimationFrame(eloop);
    };
    eloop();
  }

  // --- manual navigation ---
  function goto(next) {
    if (next < 0) next = 0;
    if (next >= steps.length) return done();
    // A deliberate jump re-announces, even to the pose we were just in — that is
    // what "‹ Back" is FOR when you missed what she said.
    spokenPose = null;
    saidArriveAt = null;
    paused = false; pauseBtn.textContent = "Pause"; lastTs = 0;
    enterStep(next);   // says the new step's cue live + refreshes the lock timeline
  }

  function done() {
    if (finished) return;
    finished = true;
    if (raf) cancelAnimationFrame(raf);
    clearRunTimeline();
    closeScreenLock();
    releaseWake();
    endRunAudio();
    resetNarration();
    cueRoutineDone();
    clear(container);
    const msg = rounds > 1 ? `Complete (${rounds} rounds)` : "Complete";
    const doneTitle = el("h2");
    doneTitle.appendChild(svgText((title || "Routine") + " " + msg.toLowerCase(), { size: 19, weight: 700, maxLines: 2 }));
    container.appendChild(el("div.routine-done.center", {}, [
      el("div.tick", { html: "✓" }),
      doneTitle,
    ]));
    setTimeout(() => onComplete && onComplete({ completed: true, holds: holdList() }), 800);
  }

  function cleanup(completed) {
    if (finished) return;
    finished = true;
    if (raf) cancelAnimationFrame(raf);
    if (extendRaf) cancelAnimationFrame(extendRaf);
    clearRunTimeline();
    closeScreenLock();
    releaseWake();
    endRunAudio();
    resetNarration();
    onComplete && onComplete({ completed, holds: holdList() });
  }

  paint();
  enterStep(0);
  armTimeline();
  raf = requestAnimationFrame(loop);
  return { stop: () => cleanup(false) };
}
