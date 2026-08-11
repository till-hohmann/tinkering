// sound.js — WebAudio cues + spoken voice commands.
//
// Voice commands are short pre-recorded clips played through the AudioContext
// (NOT speechSynthesis, which would grab the media session and pause the music).
//
// CUES PLAY WHEN THE SCREEN IS ON; the music is never disturbed.
//   "ambient" (default) -> our cues MIX over Spotify/Apple Music; the music keeps
//                 playing untouched.
//   "loud"    (Settings opt-in) -> "playback": cues are always audible even on the
//                 mute switch, but the music pauses — for running without music.
//
// LOCKED SCREEN: an installed iOS web app FREEZES its JavaScript and SUSPENDS Web
// Audio the moment the screen is hard-locked, and the only audio that survives a
// lock (an already-playing media element) seizes the session and pauses the music.
// So reliable cues + music while hard-locked is not possible in a PWA — we don't
// fight it. The app holds a screen wake-lock during a workout, so the screen stays
// on (and cues keep firing) unless you press the power button. Earlier versions
// tried to force playback / play a media element on lock; that only killed the
// music and never delivered locked cues, so it's been removed.

import { el } from "../ui.js";

let ctx = null;
let enabled = true;
let mode = "mix";
let keepAlive = null;           // silent looping source that keeps the iOS audio session alive
const RAW = new Map();          // clip name -> ArrayBuffer (prefetched over network)
const buffers = new Map();      // clip name -> decoded AudioBuffer
let voiceLoading = null;

const VOICE_CLIPS = ["position", "stretch", "easy-jog", "speed-up", "slow-down", "cool-down", "done"];

try { const s = localStorage.getItem("fit-sound"); if (s != null) enabled = s !== "0"; } catch {}
try { const m = localStorage.getItem("fit-audiomode"); if (m) mode = m; } catch {}

// Warm the network cache immediately (decoding needs a user-gesture-unlocked ctx).
VOICE_CLIPS.forEach(async (name) => {
  try { const r = await fetch(`./audio/${name}.wav`); if (r.ok) RAW.set(name, await r.arrayBuffer()); } catch {}
});

let runActive = false;          // a guided run/routine is in progress (keeps the ctx warm)
// "ambient" blends our cues over the music (music keeps playing); "loud" pins
// "playback" (always audible, but pauses the music). We never force playback on
// lock — it only killed the music and couldn't deliver locked cues anyway.
function baseType() { return mode === "loud" ? "playback" : "ambient"; }
function setSessionType(t) { try { if (navigator.audioSession) navigator.audioSession.type = t; } catch {} }
function applySession() { setSessionType(baseType()); }

// A silent, perpetually-looping source keeps the iOS audio session alive so the
// context never gets suspended during long quiet stretches (e.g. a 30-min walk
// with no cues) — which previously killed every cue that followed.
function startKeepAlive() {
  if (!ctx || keepAlive) return;
  try {
    const buf = ctx.createBuffer(1, Math.max(1, Math.round(ctx.sampleRate * 0.5)), ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(ctx.destination);
    src.start();
    keepAlive = src;
  } catch {}
}

// Retained as no-ops so the run player and routine engine don't need to special-
// case the locked screen. (We don't attempt cues while hard-locked — see the
// header note: iOS can't deliver them to a frozen PWA without killing the music.)
export function setRunTimeline() {}
export function clearRunTimeline() {}

export function unlockAudio() {
  try {
    applySession();
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state !== "running") ctx.resume();
    beepRaw(1, 0.01, 0.0001); // near-silent blip fully unlocks iOS
    startKeepAlive();
    preloadVoice();
  } catch {}
}

// Re-wake the Web Audio context when the app/screen comes back to the foreground.
try {
  document.addEventListener("visibilitychange", () => { if (!document.hidden) resumeAudio(); });
} catch {}

// These live in localStorage because they're read SYNCHRONOUSLY at import, before
// any database is open — but localStorage is in no backup, so a wipe silently
// reset them and a run started playing cues out loud over someone's music. They
// are now mirrored into a synced pref as well: localStorage stays the fast local
// copy, the pref is the durable one, and boot reconciles the two.
function persistAudio() {
  try {
    localStorage.setItem("fit-sound", enabled ? "1" : "0");
    localStorage.setItem("fit-audiomode", mode);
  } catch {}
  // Fire-and-forget: these setters are synchronous by contract and a settings
  // toggle must never wait on a database write.
  import("../store.js").then((s) => s.setAudioPrefs({ enabled, mode })).catch(() => {});
}

/** Adopt restored settings. Does NOT re-persist — the caller is the backup. */
export function applyAudioPrefs(p) {
  if (!p || typeof p !== "object") return false;
  if (typeof p.enabled === "boolean") enabled = p.enabled;
  if (p.mode === "loud" || p.mode === "mix") mode = p.mode;
  try {
    localStorage.setItem("fit-sound", enabled ? "1" : "0");
    localStorage.setItem("fit-audiomode", mode);
  } catch {}
  try { applySession(); } catch {}
  return true;
}

export function setSoundEnabled(on) {
  enabled = !!on;
  persistAudio();
}
export function isSoundEnabled() { return enabled; }

export function getAudioMode() { return mode; }
export function setAudioMode(m) {
  mode = m === "loud" ? "loud" : "mix";
  persistAudio();
  applySession();
}

// --- voice commands ------------------------------------------------------
export function preloadVoice() {
  if (!ctx) return Promise.resolve();
  voiceLoading = Promise.all(VOICE_CLIPS.map(async (name) => {
    if (buffers.has(name)) return;
    try {
      let ab = RAW.get(name);
      if (!ab) { const r = await fetch(`./audio/${name}.wav`); if (!r.ok) return; ab = await r.arrayBuffer(); RAW.set(name, ab); }
      buffers.set(name, await ctx.decodeAudioData(ab.slice(0))); // slice: keep RAW for retries
    } catch {}
  }));
  return voiceLoading;
}

// Nudge the context awake (e.g. when a routine starts after a long run, where
// iOS may have suspended/interrupted it and there's no fresh tap to unlock).
export function resumeAudio() {
  try { applySession(); if (ctx && ctx.state !== "running") ctx.resume(); startKeepAlive(); } catch {}
}

// Await the context actually reaching "running" before a caller relies on it —
// ctx.resume() is async, so checking audioReady() too soon can miss.
const audioReady = () => !!ctx && ctx.state === "running";
export async function ensureAudioRunning() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state !== "running") await ctx.resume();
  } catch {}
  return audioReady();
}

// Bracket a guided run/routine: keep the context warm so cues fire promptly while
// the screen is on (the wake-lock keeps it on during the workout).
export function beginRunAudio() {
  runActive = true;
  try { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  applySession();
  try { if (ctx && ctx.state !== "running") ctx.resume(); } catch {}
  startKeepAlive();
}
export function endRunAudio() { runActive = false; applySession(); }

// Speak a command clip (e.g. "speed-up"). No-op when muted. Falls back to a tone
// (and kicks off a load) if the clip isn't decoded yet, so a cue is never missed.
// If the context isn't running (suspended/interrupted after a long run), resume
// it FIRST and play once it's live — otherwise the buffer plays into a dead ctx.
export function say(name, { gain = 1.4 } = {}) {
  if (!enabled || !ctx) return;
  applySession();
  const play = () => {
    const buf = buffers.get(name);
    if (!buf) { preloadVoice(); tone(760, 0.16, 0.25); return; }
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    g.gain.value = gain;
    src.buffer = buf;
    src.connect(g).connect(ctx.destination);
    try { src.start(); } catch {}
  };
  if (ctx.state !== "running") { ctx.resume().then(play).catch(() => {}); }
  else play();
}

// Unlock + speak a sample, for the Settings "Test" button. Forces always-audible
// playback for the test (so it's never swallowed by the iOS mute switch like the
// default "mix"/ambient mode is) and falls back to a tone if a clip won't decode.
export async function testAudio() {
  const prevMode = mode, wasEnabled = enabled;
  mode = "loud"; enabled = true;            // applySession() (called by unlock/say) now picks "playback"
  try {
    unlockAudio();                          // create/resume ctx under this user gesture
    try { await preloadVoice(); } catch {}
    await new Promise((r) => setTimeout(r, 80));   // let the context settle
    say("speed-up", { gain: 1.6 });
  } finally {
    enabled = wasEnabled;
    setTimeout(() => { mode = prevMode; applySession(); }, 1500);  // restore the user's mode after it plays
  }
}

// --- tonal cues ----------------------------------------------------------
function beepRaw(freq, dur, gainVal) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.type = "sine";
  gain.gain.value = gainVal;
  osc.connect(gain).connect(ctx.destination);
  const t = ctx.currentTime;
  osc.start(t);
  gain.gain.setValueAtTime(gainVal, t);
  gain.gain.exponentialRampToValueAtTime(0.00001, t + dur);
  osc.stop(t + dur + 0.02);
}

function tone(freq, dur = 0.12, vol = 0.25) {
  if (!enabled || !ctx) return;
  if (ctx.state === "suspended") ctx.resume();
  beepRaw(freq, dur, vol);
}

export const cueTick = () => tone(660, 0.08, 0.18);
export const cueItemStart = () => tone(880, 0.12, 0.22);
export const cueItemEnd = () => tone(520, 0.16, 0.22);
export const cueRoutineDone = () => { tone(660, 0.12); setTimeout(() => tone(990, 0.2), 130); };

// --- breath pacer (yoga) ---------------------------------------------------
// A hold in yoga is counted in BREATHS, not seconds, so the player needs to mark
// the breath rather than the clock.
//
// Deliberately much quieter and lower than the interval cues, and a long soft
// swell rather than a beep: this fires every few seconds for minutes at a time,
// and anything with an attack on it becomes unbearable by the third pose. Rising
// tone on the inhale, falling on the exhale — the pitch IS the instruction, so
// it works with the eyes closed, which is the point.
//
// No locked-screen handling is needed or attempted. The routine engine holds a
// screen wake-lock for the whole practice, and this file's header explains why
// cues to a hard-locked PWA are not a thing we chase.
function swell(from, to, dur, vol) {
  if (!enabled || !ctx) return;
  if (ctx.state === "suspended") ctx.resume();
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.linearRampToValueAtTime(to, t + dur);
    // fade in and out symmetrically — no click, no attack
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  } catch {}
}
export const cueInhale = (dur = 2) => swell(196, 262, Math.max(0.6, dur * 0.9), 0.09);
export const cueExhale = (dur = 2) => swell(262, 175, Math.max(0.6, dur * 0.9), 0.075);

// --- reusable mute button ------------------------------------------------
const SPK_ON = "M4 9v6h4l5 5V4L8 9H4Z M16 8a4 4 0 0 1 0 8 M18.5 5.5a8 8 0 0 1 0 13";
const SPK_OFF = "M4 9v6h4l5 5V4L8 9H4Z M16 9l5 6 M21 9l-5 6";

export function muteToggle(onChange) {
  const ns = "http://www.w3.org/2000/svg";
  const btn = el("button.btn.ghost.icbtn", { "aria-label": "Toggle audio cues" });
  function paint() {
    btn.innerHTML = "";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "line");
    svg.style.width = svg.style.height = "24px";
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", enabled ? SPK_ON : SPK_OFF);
    svg.appendChild(p);
    btn.appendChild(svg);
    btn.style.color = enabled ? "var(--text)" : "var(--text-faint)";
  }
  btn.onclick = () => { setSoundEnabled(!enabled); paint(); onChange && onChange(enabled); };
  paint();
  return btn;
}
