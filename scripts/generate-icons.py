#!/usr/bin/env python3
"""Draw the Cheklst app icons (PNG) to match web/icon.svg. Needs Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw
WEB = Path(__file__).resolve().parents[1] / 'web'
ACCENT, PAPER = (74, 85, 201), (245, 246, 250)
def icon(size):
    s = size / 512
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=112 * s, fill=ACCENT)
    d.rounded_rectangle([126 * s, 108 * s, 386 * s, 404 * s], radius=36 * s, fill=PAPER)
    d.line([(180 * s, 254 * s), (231 * s, 305 * s), (334 * s, 194 * s)], fill=ACCENT, width=round(30 * s), joint='curve')
    for x, y in [(180, 254), (231, 305), (334, 194)]:
        r = 15 * s; d.ellipse([x * s - r, y * s - r, x * s + r, y * s + r], fill=ACCENT)
    return img
for n in (192, 512):
    icon(n).save(WEB / f'icon-{n}.png', optimize=True)
print('Wrote icon-192.png and icon-512.png')
