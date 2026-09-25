# scanmate-align

Put a scanned or photographed page back onto the original it came from: deskew,
rescale and register, trying transform models until one is good enough.

A **parallel port** of [`@scanmate/align`][ts], not a replacement for it. The
TypeScript remains the reference, and the only useful definition of "correct"
for this package is that it produces the same numbers — bit for bit — as the
TypeScript it parallels.

```sh
pip install scanmate-align
```

```python
from scanmate_align import align_scan

result = align_scan("page1.png", "returned.jpg")
print(result.confidence, result.diagnostics.selected_model, result.transform.rotation_deg)
```

`result.raster` sits on the original's canvas, at the original's width and
height, so every coordinate known from the PDF still means what it meant.

## Why it exists

Two questions about a returned form are easy to answer once the scan sits
exactly on top of the original, and near-impossible before:

1. *Was anything in the printed text changed?* Run OCR on both and diff — which
   only works if the two are the same page at the same size.
2. *Was the box at `(x, y)` signed?* That is a question about a fixed rectangle,
   and a fixed rectangle only means something once both images agree on where
   `(x, y)` is.

## How it works

```text
decode → ink → coarse guess → rough warp → features →┬→ RANSAC(similarity) → score →┐
              (scale/skew)                  (ORB)    ├→ RANSAC(affine)     → score →┼→ warp
                                                     └→ RANSAC(homography) → score →┘
```

The coarse guess exists to make the feature stage possible at all: binary
descriptors compare fixed pixel offsets, so they only match between images at
comparable scale — and nothing in a JPEG tells you what dpi it was scanned at.

Everything left of the fork happens once, and it is nearly all of the cost. The
sweep tries models cheapest first, stops as soon as one is good enough, and a
more complex model must *earn* its extra parameters by a margin: a homography
fitted to a flat page bends slightly to follow the page's own noise and would
otherwise win every time.

If no model finds a consensus — a nearly blank form has few corners to find —
the coarse estimate is returned on its own and `method` says so.

## One difference from the TypeScript

`alignScan` is `async`; `align_scan` is not. That asynchrony is about libvips on
libuv's threadpool, not about the algorithm — between decode and encode the
TypeScript is as CPU-bound and single-threaded as this. Python's codec is Pillow
and synchronous, so an `async def` here would be a coroutine that never yields.

The departure is in the calling convention only. Every number is the
TypeScript's, held there by goldens generated from the real build — including a
**byte-identical** warped raster on every case.

## Requirements

Python 3.11 or newer, and `scanmate-ink`. Fully typed (PEP 561), `mypy --strict`
clean.

[ts]: https://github.com/russoedu/scanmate/tree/main/packages/align#readme
