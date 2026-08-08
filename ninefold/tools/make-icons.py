#!/usr/bin/env python3
"""make-icons.py — dev tool. Renders the Strong app icons (PNG + SVG) from the
chosen logo mark (the collegiate "S" inside a 45-plate timer ring), cropped from
Till's approved design into icons/mark-source.png. The mark is composited onto a
near-black tile and scaled to fill almost the whole square (small margins).
Re-run if the mark or fill changes:  python tools/make-icons.py
"""
import os, base64
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "icons")

# Dark background + bright subject stays legible under iOS Light/Dark/Tinted icon
# modes. The mark's own crop is on this exact tone, so compositing is seamless.
TILE = (10, 10, 10, 255)        # #0a0a0a — matches the source mark's background
REGULAR_FILL = 0.95             # mark spans ~95% of the tile — small margins
MASKABLE_FILL = 0.74            # tucked inside the maskable safe zone

MARK = Image.open(os.path.join(ICONS, "mark-source.png")).convert("RGBA")


def render(size, fill):
    img = Image.new("RGBA", (size, size), TILE)   # full-bleed tile, no transparent corners
    m = int(round(size * fill))
    mark = MARK.resize((m, m), Image.LANCZOS)
    off = (size - m) // 2
    img.alpha_composite(mark, (off, off))
    return img


def main():
    render(192, REGULAR_FILL).save(os.path.join(ICONS, "icon-192.png"))
    render(512, REGULAR_FILL).save(os.path.join(ICONS, "icon-512.png"))
    render(180, REGULAR_FILL).save(os.path.join(ICONS, "apple-touch-icon.png"))
    render(512, MASKABLE_FILL).save(os.path.join(ICONS, "maskable-512.png"))

    # icon.svg — the manifest/link SVG. Embeds the same mark as a data-URI so it
    # renders the exact raster on a matching tile at any size.
    with open(os.path.join(ICONS, "mark-source.png"), "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    w = round(512 * REGULAR_FILL, 1)
    off = round((512 - w) / 2, 1)
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">'
        '<rect width="512" height="512" fill="#0a0a0a"/>'
        f'<image x="{off}" y="{off}" width="{w}" height="{w}" '
        f'href="data:image/png;base64,{b64}"/>'
        '</svg>'
    )
    with open(os.path.join(ICONS, "icon.svg"), "w", encoding="utf-8") as f:
        f.write(svg)

    print("icons written:", sorted(os.listdir(ICONS)))


if __name__ == "__main__":
    main()
