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
    from PIL import Image, ImageEnhance
except ImportError:
    sys.exit("Pillow is required:  pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "img" / "exercises"
ANATOMY_JS = ROOT / "js" / "exercise-anatomy.js"
ASANAS_JS = ROOT / "js" / "yoga" / "asanas.js"

SIZE = 1024
QUALITY = 82


def expected_ids():
    """Exercise ids that have a muscle attribution — i.e. deserve a render."""
    src = ANATOMY_JS.read_text(encoding="utf-8")
    body = src.split("export const EXERCISE_ANATOMY = {", 1)[1]
    body = body.split("\n};", 1)[0]
    # top-level keys only (two-space indent); nested m(...) calls are deeper
    return [m.group(1) for m in re.finditer(r"^  ([a-z0-9_]+):", body, re.M)]


def asana_ids():
    """Every pose in the yoga library, read from its A("id", ...) entries.

    ⚠ THE TWO SETS OF RENDERS ARE NOT THE SAME KIND OF PICTURE, and everything
    below turns on knowing which is which. A strength render is a two-panel
    composite — a dark gym demo beside a muscle chart. A yoga render is a single
    full-frame photograph of one pose in a bright room.

    Run a yoga frame through the composite handling and find_divider() picks the
    darkest column of an ordinary photograph, which is nothing at all: warrior II
    came out with her outstretched arm cropped off at the wrist, and the
    brightness lift meant for a near-black gym washed a warm studio flat.
    """
    src = ASANAS_JS.read_text(encoding="utf-8")
    return [m.group(1) for m in re.finditer(r'^  A\("([a-z0-9_]+)"', src, re.M)]


THUMB = 512


def find_divider(im):
    """x of the gutter between the demo photo and the muscle panel.

    The renders are two-panel composites and the split is NOT in a fixed place —
    measured across the set it wanders between 0.60 and 0.69 of the width. So it
    is found per image: the gutter is the darkest full-height column in the band
    where it could plausibly sit. A fixed crop clipped the lifter's head on some
    and left a slice of muscle chart on others.
    """
    w, h = im.size
    rows = range(0, h, 40)
    best_x, best_v = None, None
    for x in range(int(w * 0.52), int(w * 0.78)):
        v = sum(sum(im.getpixel((x, y))) for y in rows)
        if best_v is None or v < best_v:
            best_v, best_x = v, x
    return best_x


def convert_thumb(png: Path, single_panel: bool = False) -> Path:
    """The DEMO half alone, square, for tiles and list rows.

    The full composite is right for the anatomy card, where it's read at 340px+.
    At the 40-74px an exercise row gives it, the two panels together are mush —
    so lists get the photograph only, cropped square around the lifter.

    A SINGLE-PANEL RENDER IS TAKEN AS IT IS. It is already one square photograph
    of the whole pose, so there is no half to find and nothing to improve: the
    thumbnail is a resize. Anything else here would be cropping and retouching a
    picture that arrived finished.
    """
    out = png.with_name(png.stem + ".thumb.webp")
    if single_panel:
        with Image.open(png) as im:
            im = im.convert("RGB")
            w, h = im.size
            side = min(w, h)
            im = im.crop(((w - side) // 2, (h - side) // 2,
                          (w - side) // 2 + side, (h - side) // 2 + side))
            im.resize((THUMB, THUMB), Image.LANCZOS).save(out, "WEBP", quality=80, method=6)
        return out
    with Image.open(png) as im:
        im = im.convert("RGB")
        w, h = im.size
        # step inside the gutter: cropping exactly on it leaves a bright seam
        # from the muscle panel's edge along the right of the thumbnail
        demo = im.crop((0, 0, max(1, find_divider(im) - int(w * 0.012)), h))
        dw, dh = demo.size
        side = min(dw, dh)
        left = (dw - side) // 2
        demo = demo.crop((left, 0, left + side, side)).resize((THUMB, THUMB), Image.LANCZOS)
        # The renders are dark gym scenes and the app's surfaces are near-black,
        # so at the 40-70px a list row gives them they sink into the background.
        # A modest lift is the difference between "a photo" and "a dark smudge";
        # the full-size composite is left alone, where the contrast is correct.
        demo = ImageEnhance.Brightness(demo).enhance(1.18)
        demo = ImageEnhance.Contrast(demo).enhance(1.06)
        demo.save(out, "WEBP", quality=80, method=6)
    return out


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

    poses = set(asana_ids())
    pngs = sorted(IMG_DIR.glob("*.png"))
    for png in pngs:
        single = png.stem in poses
        out = convert(png)
        th = convert_thumb(png, single_panel=single)
        kind = "pose " if single else "lift "
        print(f"  {kind}{png.name:34s} -> {out.stat().st_size/1024:5.0f} KB  + thumb {th.stat().st_size/1024:4.0f} KB")

    ids = sorted(p.stem for p in IMG_DIR.glob("*.webp") if not p.stem.endswith(".thumb"))
    (IMG_DIR / "manifest.json").write_text(
        json.dumps({"ids": ids}, indent=2) + "\n", encoding="utf-8"
    )

    # Two libraries share this directory and this manifest, so they are reported
    # separately — a run that shipped every lift and no pose used to read as a
    # clean run with 110 lines of "not in exercise-anatomy.js" under it.
    want, shipped = expected_ids(), set(ids)
    missing = [i for i in want if i not in shipped]
    missing_poses = [i for i in sorted(poses) if i not in shipped]
    unknown = [i for i in ids if i not in set(want) and i not in poses]

    print(f"\n{len([i for i in ids if i not in poses])}/{len(want)} lift renders"
          f" and {len([i for i in ids if i in poses])}/{len(poses)} pose renders"
          f" -> img/exercises/manifest.json")
    if unknown:
        print("\nin neither library (typo in the filename?):")
        for i in unknown:
            print(f"  {i}")
    if missing:
        print(f"\nlifts still to generate ({len(missing)}):")
        for i in missing:
            print(f"  {i}")
    if missing_poses:
        print(f"\nposes still to generate ({len(missing_poses)}):")
        for i in missing_poses:
            print(f"  {i}")


if __name__ == "__main__":
    main()
