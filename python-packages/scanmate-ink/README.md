# scanmate-ink

The pixel and geometry kernel behind ScanMate: raster codec, ink separation,
warps, homographies, FFT and the pipeline contracts.

A **parallel port** of [`@scanmate/ink`][ts], not a replacement for it. The
TypeScript remains the reference, and the only useful definition of "correct"
for this package is that it produces the same numbers — bit for bit — as the
TypeScript it parallels.

```sh
pip install scanmate-ink
```

```python
from scanmate_ink import decode_image, ink_map, to_grayscale

page = decode_image("form.png")
ink = ink_map(to_grayscale(page))
```

HEIF — what a phone camera emits — needs a separate decoder wheel, so it is
opt-in rather than a hard dependency of the numeric core:

```sh
pip install 'scanmate-ink[heif]'
```

## What "parallel port" means here

Every numeric result is held to the TypeScript's own output by goldens generated
from the real `@scanmate/ink` build. The comparison is `==`, not "close": a port
that is right to six places and wrong in the last bit produces a different
sample, and every downstream result diverges from there.

Three things genuinely differ between the two runtimes, none of them anybody's
bug, and each is measured and pinned separately rather than folded into one
tolerance:

| | Disagreement |
| --- | --- |
| `sin(±π/4)` | 1 ULP, MSVC's libm vs glibc's |
| `Math.hypot` vs `math.hypot` | 16% of inputs — hence `scanmate_ink.hypot` |
| `Math.round` vs `round` | every half-way case — hence `js_round` |

Two exports of the TypeScript are **deliberately absent**: `resampleRaster` and
`blurRaster` go through libvips, and Pillow's LANCZOS disagrees with libvips'
lanczos3 on 78.8% of pixels while libvips' blur is an integer approximation of a
Gaussian. A Python "equivalent" would be a different operation wearing the same
name. `resize_gray` and `box_blur_raster` are ScanMate's *own* resampler and
blur, are ported, and are bit-exact.

## Requirements

Python 3.11 or newer. Fully typed (PEP 561), `mypy --strict` clean.

[ts]: https://github.com/russoedu/scanmate/tree/main/packages/ink#readme
