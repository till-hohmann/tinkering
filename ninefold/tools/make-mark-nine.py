#!/usr/bin/env python3
"""make-mark-nine.py — dev tool. Swaps the collegiate S in the logo mark for a 9
drawn in the SAME face, and writes icons/mark-source.png (the input make-icons.py
composites onto the app tile).

    python tools/make-mark-nine.py            -> icons/mark-source.png
    python tools/make-mark-nine.py --compare  -> also icons/concepts/s-vs-9.png

The ring and the two "45" plate marks are Till's approved artwork and are left
BYTE-IDENTICAL: only the glyph area is repainted. The 9 is reconstructed to the S's
own measurements, taken off the source image rather than guessed:

    glyph box   x 96..235, y 64..268     (140 x 205)
    stroke      37 px
    chamfer     21 px at 45 degrees on every outer corner

That chamfer is what makes the face read as collegiate, so the 9 carries it on
every outer corner too. The leg's foot uses a smaller cut (14) for the simple
reason that two 21s on a 37-wide bar would meet in the middle and round the
terminal off entirely.
"""
import os, sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "icons")
SRC = os.path.join(ICONS, "mark-source.png")

SS = 4                        # supersample factor — polygons have hard edges
TILE = (10, 10, 10, 255)      # the mark's own background, sampled from the source
MINT = (47, 230, 166, 255)

# Measured off the S, not invented. See the docstring.
X0, X1 = 96, 235
Y0, Y1 = 64, 268
STROKE = 37
CHAMFER = 21
FOOT_CUT = 14

BOWL_BOTTOM = Y0 + 134        # bowl 134 tall -> a 66x60 counter, near-square like the S's
COUNTER = (X0 + STROKE, Y0 + STROKE, X1 - STROKE, BOWL_BOTTOM - STROKE)
COUNTER_CUT = 14              # counters are chamfered too, but more tightly


def chamfered(x0, y0, x1, y1, tl=0, tr=0, br=0, bl=0):
    """Rectangle with 45-degree corner cuts — the collegiate corner."""
    return [
        (x0 + tl, y0), (x1 - tr, y0), (x1, y0 + tr), (x1, y1 - br),
        (x1 - br, y1), (x0 + bl, y1), (x0, y1 - bl), (x0, y0 + tl),
    ]


def draw_nine(size_box):
    """The glyph on its own transparent layer, at supersampled scale."""
    layer = Image.new("RGBA", size_box, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    s = lambda v: v * SS

    # bowl — outer corners cut, except bottom-right where the leg continues down
    d.polygon([(s(x), s(y)) for x, y in
               chamfered(X0, Y0, X1, BOWL_BOTTOM, tl=CHAMFER, tr=CHAMFER, bl=CHAMFER, br=0)], fill=MINT)
    # leg — full height on the right; top corner shared with the bowl, foot cut
    d.polygon([(s(x), s(y)) for x, y in
               chamfered(X1 - STROKE, Y0, X1, Y1, tl=0, tr=CHAMFER, br=FOOT_CUT, bl=FOOT_CUT)], fill=MINT)
    # counter — punched back out to the tile colour, keeping the same corner logic
    d.polygon([(s(x), s(y)) for x, y in
               chamfered(*COUNTER, tl=COUNTER_CUT, tr=COUNTER_CUT, br=COUNTER_CUT, bl=COUNTER_CUT)],
              fill=(0, 0, 0, 0))
    return layer


def build(compare=False):
    base = Image.open(SRC).convert("RGBA")
    W, H = base.size

    # Repaint ONLY the glyph area. The rectangle clears the S with a margin and
    # still sits inside the ring and clear of both "45"s — verified below.
    clear = (X0 - 4, Y0 - 4, X1 + 4, Y1 + 4)
    out = base.copy()
    ImageDraw.Draw(out).rectangle(clear, fill=TILE)

    glyph = draw_nine((W * SS, H * SS)).resize((W, H), Image.LANCZOS)
    out.alpha_composite(glyph)

    if compare:
        sheet = Image.new("RGBA", (W * 2 + 30, H), (14, 15, 18, 255))
        sheet.alpha_composite(base, (0, 0))
        sheet.alpha_composite(out, (W + 30, 0))
        os.makedirs(os.path.join(ICONS, "concepts"), exist_ok=True)
        sheet.convert("RGB").save(os.path.join(ICONS, "concepts", "s-vs-9.png"))
        print("compare ->", os.path.join("icons", "concepts", "s-vs-9.png"))
    return out


def check_clear_area():
    """The repaint rectangle must not touch the ring or either 45."""
    import numpy as np
    a = np.array(Image.open(SRC).convert("RGBA"))
    bright = (a[:, :, 1].astype(int) > 120) & (a[:, :, :3].astype(int).sum(2) > 200)
    H, W = bright.shape
    cx, cy = W / 2, H / 2
    yy, xx = np.mgrid[0:H, 0:W]
    glyph_only = bright & (np.hypot(xx - cx, yy - cy) < 118)
    box = np.zeros_like(bright)
    box[Y0 - 4:Y1 + 5, X0 - 4:X1 + 5] = True
    stray = bright & box & ~glyph_only
    print(f"  pixels cleared that are not the S: {int(stray.sum())} (must be 0)")
    return int(stray.sum()) == 0


if __name__ == "__main__":
    assert check_clear_area(), "the clear rectangle would damage the ring or a 45"
    img = build(compare="--compare" in sys.argv)
    if "--dry-run" not in sys.argv:
        img.save(SRC)
        print("wrote", os.path.join("icons", "mark-source.png"))
