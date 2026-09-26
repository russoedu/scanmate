"""Writes the three merge fixtures the TypeScript image stack cannot produce.

`make-merge-fixtures.mts` writes the rest. These two are here because
`@scanmate/ink`'s encoder writes neither: it has no CMYK output, and it applies
EXIF rotation on decode rather than recording it. Both are exactly what decides
whether a JPEG is embedded as its own bytes or decoded and re-encoded first, so
both have to exist as inputs - a JPEG embedded raw when it carries an
orientation lands on the page sideways, and nothing about the merge would say
so.

Run once; the output is COMMITTED, like every other parity fixture.

    python tools/parity/fixtures/make-merge-fixtures.py
"""

from pathlib import Path

from PIL import Image

out = Path(__file__).parent / "merge"
out.mkdir(parents=True, exist_ok=True)

# Deterministic content: a fixed gradient, so the bytes are the same every run.
image = Image.new("CMYK", (120, 160))
image.putdata(
    [
        (x * 2 % 256, y % 256, (x + y) % 256, 0)
        for y in range(160)
        for x in range(120)
    ]
)
path = out / "cmyk.jpg"
image.save(path, "JPEG", quality=90)
print(f"cmyk.jpg     {path.stat().st_size:>7} bytes")

# An upright RGB image that CLAIMS to need a quarter turn. Orientation 6 is the
# commonest one a phone writes, and the one a viewer silently acts on.
rotated = Image.new("RGB", (120, 160))
rotated.putdata([(x * 2 % 256, y % 256, (x + y) % 256) for y in range(160) for x in range(120)])
exif = rotated.getexif()
exif[0x0112] = 6
path = out / "rotated.jpg"
rotated.save(path, "JPEG", quality=90, exif=exif)
print(f"rotated.jpg  {path.stat().st_size:>7} bytes")

# A three-frame TIFF, which is what a sheet-fed scanner emits. Every frame must
# become its own page; a port that embedded only the first would lose two
# sheets of a document silently.
frames = [
    Image.new("RGB", (100, 140), (r, 128, 255 - r))
    for r in (0, 96, 192)
]
path = out / "three-pages.tiff"
frames[0].save(path, "TIFF", save_all=True, append_images=frames[1:])
print(f"three-pages  {path.stat().st_size:>7} bytes")
