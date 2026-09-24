#!/usr/bin/env python3
"""build-voice.py — render the yoga narration to audio clips.

    python tools/build-voice.py [--level advanced] [--only pigeon] [--dry]

WHY PRE-RENDERED AND NOT THE BROWSER'S OWN SPEECH ENGINE. Two hard facts about
iOS Safari, both checked rather than assumed:

  * speechSynthesis.getVoices() returns nothing, so the voice CANNOT be chosen.
    A named, consistent teacher is the entire point here, and a device-dependent
    default voice is not that.
  * Speech stops when the app is backgrounded and does not recover without a
    reload — during a practice, which is precisely when it must not.

Pre-rendered clips also keep the existing behaviour where cues MIX over your
music through the AudioContext instead of seizing the media session, which
on-device speech would have broken.

SIZE. About 2.2 KB per spoken word. Only the practitioner's own level is ever
fetched, so the whole library is roughly 13 MB and a 20-minute practice pulls
about 1.5 MB, cached after the first time.

The voice is en-US-AvaMultilingualNeural, slowed 8%: a yoga cue is not a news
read, but a heavier slowdown flattens the prosody and is what made the first
attempt sound robotic.

Pose names are spoken in ENGLISH ONLY. edge-tts escapes SSML, so <phoneme> tags
never reach the engine and Sanskrit cannot be pronounced correctly; the names are
shown on screen instead. See the naming note in js/yoga/script.js.
"""

import argparse, asyncio, hashlib, json, os, re, subprocess, sys

# Ava Multilingual, a newer model than the first-generation *Neural voices, and
# chosen by ear against Clara and Emma.
#
# RATE IS ONLY -8%. The first render used -18%, which time-stretches the model's
# own output and flattens its prosody — that, as much as the voice, is what made
# it sound robotic. A gentle slowdown reads as unhurried; a heavy one reads as a
# machine.
VOICE = "en-US-AvaMultilingualNeural"
RATE = "-8%"
PITCH = "+0Hz"
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "audio", "yoga")
LEVELS = ["beginner", "advanced", "expert"]


def clip_id(text: str) -> str:
    """Stable filename for an utterance. Content-addressed, so identical lines
    across levels or poses are rendered and stored exactly once."""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


def collect(level: str, only: str | None):
    """Ask the JS script layer what it would say, for every pose, at this level.

    The script lives in JS because the app composes it at runtime; rendering it
    from a duplicated Python copy would guarantee the two drift. So node is the
    source of truth and this file only turns text into audio.
    """
    here = os.path.dirname(__file__)
    js = f"""
      import {{ ASANAS }} from "../js/yoga/asanas.js";
      import {{ entryScript, exitScript, salutationScript, allHoldPhrases, OPENING, SAVASANA_SCRIPT, CLOSING }} from "../js/yoga/script.js";
      const level = {json.dumps(level)};
      const only = {json.dumps(only)};
      // RENDER THE SENTENCES, NOT THE PARAGRAPHS.
      //
      // The first version rendered each composed passage whole, so every
      // combination of frame, side and breath count became its own clip: 5,385
      // per level, and about 646 MB. The passage is built from reusable
      // sentences, so those are what gets rendered, and the player concatenates
      // a handful of them. That is what entryScript's `parts` are for.
      //
      // Clip ids are content-addressed, so a sentence shared between two levels
      // or two poses is rendered exactly once across the whole set.
      const out = [];
      const add = (t) => {{ if (t && t.trim()) out.push(t.trim()); }};
      for (const t of OPENING) add(t);
      for (const t of SAVASANA_SCRIPT) add(t);
      add(CLOSING);
      for (const a of ASANAS) {{
        if (only && a.id !== only) continue;
        const sides = a.bilateral ? ["Left", "Right"] : [null];
        for (const side of sides) {{
          // Frames vary by index and holds by breath count, so sweep both and
          // let the de-duplication collapse everything that repeats.
          for (let i = 0; i < 5; i++) {{
            for (const breaths of [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20]) {{
              const item = {{ asanaId: a.id, side, holdBreaths: breaths, durationSeconds: breaths * 5 }};
              for (const p of entryScript(item, level, i).parts) add(p.text);
            }}
          }}
          for (let i = 0; i < 5; i++) for (const p of exitScript({{ asanaId: a.id }}, level, i).parts) add(p.text);
        }}
      }}
      for (const v of ["A", "B"]) for (let r = 1; r <= 5; r++)
        for (const p of salutationScript(v, r, 5, level).parts) add(p.text);
      // The hold sentences are ENUMERATED, not sampled. Sweeping a hand-picked
      // list of breath counts missed odd counts and every time-based phrasing
      // ("40 seconds", "2 minutes") that yin and restorative produce, so those
      // poses reached the mat with nobody saying how long you were staying.
      for (const t of allHoldPhrases()) add(t);
      console.log(JSON.stringify([...new Set(out)]));
    """
    tmp = os.path.join(here, "_voice_collect.mjs")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(js)
    try:
        res = subprocess.run([_node(), tmp], capture_output=True, text=True, cwd=here, encoding="utf-8")
        if res.returncode != 0:
            print(res.stderr[-2000:], file=sys.stderr)
            raise SystemExit("collect step failed")
        return json.loads(res.stdout.strip().splitlines()[-1])
    finally:
        os.remove(tmp)


def _node() -> str:
    for c in ("node", r"C:\Program Files\nodejs\node.exe"):
        try:
            subprocess.run([c, "--version"], capture_output=True, check=True)
            return c
        except Exception:
            continue
    raise SystemExit("node not found")


async def render(texts, level, dry):
    import edge_tts
    out_dir = os.path.abspath(os.path.join(OUT_DIR, level))
    os.makedirs(out_dir, exist_ok=True)
    manifest, made, skipped, bytes_total = {}, 0, 0, 0
    for i, text in enumerate(texts, 1):
        cid = clip_id(text)
        manifest[cid] = text
        path = os.path.join(out_dir, cid + ".mp3")
        if os.path.exists(path) and os.path.getsize(path) > 0:
            skipped += 1
            bytes_total += os.path.getsize(path)
            continue
        if dry:
            made += 1
            continue
        c = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH)
        await c.save(path)
        made += 1
        bytes_total += os.path.getsize(path)
        if i % 25 == 0 or i == len(texts):
            print(f"  {i}/{len(texts)}  ({bytes_total/1024/1024:.1f} MB)")
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"voice": VOICE, "rate": RATE, "pitch": PITCH, "clips": manifest}, f, indent=0)
    print(f"{level}: {made} rendered, {skipped} already present, "
          f"{len(manifest)} clips, {bytes_total/1024/1024:.1f} MB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--level", choices=LEVELS + ["all"], default="all")
    ap.add_argument("--only", help="a single asana id, for spot-checking a rewrite")
    ap.add_argument("--dry", action="store_true", help="count and size without calling the service")
    a = ap.parse_args()
    for level in (LEVELS if a.level == "all" else [a.level]):
        texts = collect(level, a.only)
        print(f"{level}: {len(texts)} distinct utterances")
        asyncio.run(render(texts, level, a.dry))


if __name__ == "__main__":
    main()
