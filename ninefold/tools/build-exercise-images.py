#!/usr/bin/env python3
"""build-exercise-images.py — turn the raw Nano Banana renders into the set the
app ships, and write the manifest it resolves against.

Drop the PNGs from tools/illustration-prompts.md into img/exercises/ using the
`file:` names from the prompt pack, then run this. It writes a square 1024px
webp beside each PNG plus manifest.json, and reports which exercises are still
missing a render so the library can be worked through in batches.

    python tools/build-exercise-images.py

Requires Pillow (pip install pillow). The PNGs are the masters — they stay on
disk and are gitignored (too large for the repo); the webps and manifest.json
ARE committed. A re-crop must never mean regenerating an image.
"""
import json
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required:  pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "img" / "exercises"
ANATOMY_JS = ROOT / "js" / "exercise-anatomy.js"

SIZE = 1024
QUALITY = 82


def expected_ids():
    """Exercise ids that have a muscle attribution — i.e. deserve a render."""
    src = ANATOMY_JS.read_text(encoding="utf-8")
    body = src.split("export const EXERCISE_ANATOMY = {", 1)[1]
    body = body.split("\n};", 1)[0]
    # top-level keys only (two-space indent); nested m(...) calls are deeper
    return [m.group(1) for m in re.finditer(r"^  ([a-z0-9_]+):", body, re.M)]


def convert(png: Path) -> Path:
    """Square-crop from the centre, resize to SIZE, write webp."""
    out = png.with_suffix(".webp")
    with Image.open(png) as im:
        im = im.convert("RGB")
        w, h = im.size
        if w != h:
            side = min(w, h)
            left, top = (w - side) // 2, (h - side) // 2
            im = im.crop((left, top, left + side, top + side))
        if im.size[0] != SIZE:
            im = im.resize((SIZE, SIZE), Image.LANCZOS)
        im.save(out, "WEBP", quality=QUALITY, method=6)
    return out


def main():
    if not IMG_DIR.exists():
        IMG_DIR.mkdir(parents=True)
        print(f"created {IMG_DIR.relative_to(ROOT)} — drop the renders in and re-run")
        return

    pngs = sorted(IMG_DIR.glob("*.png"))
    for png in pngs:
        out = convert(png)
        kb = out.stat().st_size / 1024
        print(f"  {png.name:34s} -> {out.name:34s} {kb:6.0f} KB")

    ids = sorted(p.stem for p in IMG_DIR.glob("*.webp"))
    (IMG_DIR / "manifest.json").write_text(
        json.dumps({"ids": ids}, indent=2) + "\n", encoding="utf-8"
    )

    want = expected_ids()
    missing = [i for i in want if i not in set(ids)]
    unknown = [i for i in ids if i not in set(want)]

    print(f"\n{len(ids)}/{len(want)} renders shipped -> img/exercises/manifest.json")
    if unknown:
        print("\nnot in exercise-anatomy.js (typo in the filename?):")
        for i in unknown:
            print(f"  {i}")
    if missing:
        print(f"\nstill to generate ({len(missing)}):")
        for i in missing:
            print(f"  {i}")


if __name__ == "__main__":
    main()
