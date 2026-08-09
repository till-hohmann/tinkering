#!/usr/bin/env python3
"""make-icons.py — dev tool. Renders the Ninefold app icons (PNG + SVG) from the
chosen logo mark (the collegiate "9" inside a 45-plate timer ring; the 9 is
drawn by tools/make-mark-nine.py into icons/mark-source.png). The mark is composited onto a
near-black tile and scaled to fill almost the whole square (small margins).
Re-run if the mark or fill changes:  python tools/make-icons.py
"""
import os, base64
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "icons")

# Dark background + bright subject stays legible under iOS Light/Dark/Tinted icon
# modes. The mark's own crop is on this exact tone, so compositing is seamless.
TILE = (13, 13, 15, 255)        # #0d0d0f — the supplied artwork's own tile tone
# The source is now a FINISHED, full-bleed icon rather than a bare mark, so it is
# used at full size: scaling it to 95% would ring it with 5% of tile that doesn't
# quite match, and the artwork already carries its own margin. Its rounded corners
# were squared off first — iOS masks its own, and baked-in corners get rounded
# twice, which reads as a dark rim.
REGULAR_FILL = 1.0
# The glyph occupies ~84% of the source, so the whole square is inset to keep it
# inside the maskable safe circle.
MASKABLE_FILL = 0.80

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
    #
    # Downscaled to 512 first. The source is a 1254px master and embedding it whole
    # made a 1.4 MB SVG — which sits in the service worker's precache, so every
    # install paid for it on first load to render an icon nothing displays above
    # 512. Re-encoded through an in-memory buffer so no intermediate file is left.
    import io as _io
    _buf = _io.BytesIO()
    MARK.resize((512, 512), Image.LANCZOS).save(_buf, format="PNG", optimize=True)
    b64 = base64.b64encode(_buf.getvalue()).decode("ascii")
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
