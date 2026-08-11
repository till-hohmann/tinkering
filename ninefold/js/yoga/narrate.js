// yoga/narrate.js — plays the teacher's voice during a practice.
//
// Clips are pre-rendered per sentence (tools/build-voice.py) and named by a hash
// of their text, so the runtime does not need a lookup table: it hashes the
// sentence the script layer produced and fetches that file. A sentence shared
// between two poses or two levels is one file, fetched once.
//
// WHY NOT THE BROWSER'S SPEECH ENGINE. iOS Safari returns nothing from
// getVoices(), so the voice cannot be chosen — and a named, consistent teacher
// is the whole point. It also stops speaking when the app is backgrounded and
// does not recover without a reload. Both checked, neither acceptable during a
// practice.
//
// PLAYBACK GOES THROUGH THE SHARED AudioContext, which is what keeps the cues
// MIXING over your music instead of seizing the media session. That behaviour
// took real work to get right for the run player and would have been thrown away
// by using speechSynthesis here.

import { speakClip, audioAvailable } from "../components/sound.js";
import { APP_VERSION } from "../version.js";

const BASE = "./audio/yoga";
/** clipId -> decoded AudioBuffer. Small; a practice touches ~120 of them. */
const cache = new Map();
/** clipId -> in-flight fetch, so a repeated line doesn't fetch twice. */
const inflight = new Map();
let manifestLevel = null;
let available = null;      // Set of clip ids the render actually produced

/** Same hash the render pipeline uses (SHA-1, first 16 hex chars). */
async function clipId(text) {
  const buf = new TextEncoder().encode(text.trim());
  const digest = await crypto.subtle.digest("SHA-1", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/**
 * Load the manifest for a level. Returns false when narration has not been
 * rendered for it — in which case the player runs silent rather than broken,
 * which is the correct degradation: the practice still works, it just has no
 * teacher.
 */
export async function loadNarration(level) {
  if (manifestLevel === level && available) return true;
  try {
    // ⚠ VERSIONED, AND NOT force-cache. THE SAME TRAP, THE SAME FILE NAME, TWICE.
    //
    // js/version.js already carries the post-mortem: `img/exercises/manifest.json`
    // keeps its name across releases, so a stale copy was served for a build that
    // had shipped 72 new renders and every anatomy card silently fell back. This
    // is that bug again. `cache: "force-cache"` PINS whatever was fetched first —
    // including, on a device that opened the app before the audio was deployed, a
    // 404. Narration would then be permanently "unavailable" on that device, the
    // player would fall through to the legacy cue chain, and the practice would
    // open by saying "stretch" over a seated centering. Which is exactly what was
    // reported from the mat.
    //
    // The CLIPS keep force-cache and should: their filenames are a hash of their
    // own contents, so the URL changes whenever the audio does. Only this
    // manifest is unhashed, so only this one needs the version.
    const res = await fetch(`${BASE}/${level}/manifest.json?v=${APP_VERSION}`);
    if (!res.ok) { available = null; return false; }
    const m = await res.json();
    available = new Set(Object.keys(m.clips || {}));
    manifestLevel = level;
    return true;
  } catch { available = null; return false; }
}

export const narrationReady = () => !!available;

async function fetchClip(level, id) {
  if (cache.has(id)) return cache.get(id);
  if (inflight.has(id)) return inflight.get(id);
  const p = (async () => {
    try {
      const res = await fetch(`${BASE}/${level}/${id}.mp3`, { cache: "force-cache" });
      if (!res.ok) return null;
      const buf = await speakClip.decode(await res.arrayBuffer());
      if (buf) cache.set(id, buf);
      return buf;
    } catch { return null; }
    finally { inflight.delete(id); }
  })();
  inflight.set(id, p);
  return p;
}

/**
 * Warm the clips a passage needs WITHOUT playing them. Called as a pose is
 * entered for the pose AFTER it, so the voice never waits on the network mid-
 * practice — the one thing that would make it feel broken.
 */
export async function prefetch(level, parts) {
  if (!available || manifestLevel !== level) return;
  for (const p of parts || []) {
    const id = await clipId(p.text);
    if (available.has(id)) fetchClip(level, id);
  }
}

let sequenceToken = 0;
/** Stop whatever is currently being said. */
export function stopNarration() { sequenceToken++; speakClip.stopAll(); }

/**
 * Speak a passage, one sentence-clip after another.
 *
 * Sequential rather than concatenated so it can be INTERRUPTED cleanly: skip,
 * back, pause and the wall-clock catch-up all need the teacher to stop talking
 * about a pose you are no longer in. Each clip checks the token it started with
 * and bails if the practice has moved on.
 */
export async function speak(level, parts, { gap = 0.25 } = {}) {
  // The membership set belongs to ONE level. Testing a beginner sentence against
  // the advanced manifest would quietly skip every line as "never rendered".
  if (!available || manifestLevel !== level || !audioAvailable()) return;
  const token = ++sequenceToken;
  for (const p of parts || []) {
    if (token !== sequenceToken) return;
    const id = await clipId(p.text);
    if (!available.has(id)) continue;           // never rendered — skip it silently
    const buf = await fetchClip(level, id);
    if (!buf || token !== sequenceToken) continue;
    await speakClip.play(buf, gap);
    if (token !== sequenceToken) return;
  }
}
