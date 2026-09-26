# scanmate-scan

The pure computation under the ScanMate pipeline.

A **parallel port** of [`@scanmate/scan`][ts] — of the parts of it that can be
one. This is the first increment: the two slices that depend on nothing.

```sh
pip install scanmate-scan
```

```python
from scanmate_scan import best_match

best_match("Initial Subscription Term", "The lnitial Subscription Terrn begins")
# ApproximateMatch(start=4, end=29, distance=2, score=0.92)
```

## Approximate search

Sellers' algorithm: edit distance where the match may start and end anywhere in
the text. An exact `in` would call a perfectly good scan incomplete for one
misread letter; this finds it and says how far off it was.

**Figures are held to more than closeness.** A match containing digits must
contain the same digits, in order, and must not run into more digits on either
side — so `1,250.00` is *not* found inside `11,250.00`, and `7,250.00` is not an
approximate `1,250.00`. One digit apart is 87% similar and completely wrong.

**A lone letter is an identifier** the same way — the "A" of "Schedule A", the
"B" of "Option B" — and must be there as a word of its own. One letter in ten is
90% similar, which is why closeness alone will not do.

Offsets are **UTF-16 code units**, as JavaScript's string indices are, so a
caller gets the same span in both ports. They differ from Python character
offsets only outside the Basic Multilingual Plane — and where they differ, a
Python string must not be sliced with them directly.

## The session cache

`fingerprint` turns an option bag into a stable key: sorted keys, `None` elided
so a setting left at its default and one passed explicitly are the same
settings, and anything that cannot be compared by value — an engine, a
predicate, a page of pixels — compared by **identity**. Two calls passing the
same engine agree; two passing equivalent-looking engines do not, which is the
safe direction, because a false miss costs time and a false hit returns the
wrong answer.

The one thing **not** held to the TypeScript is the key's *spelling*. It carries
identity counters, which are per-process by definition, and the TypeScript sorts
keys with `localeCompare` rather than by code point. A cache key never crosses
between the two languages, so an identical string would buy nothing. What is
held is the contract the key exists for: equal settings give equal keys,
different settings give different ones — and that is what the tests check.

`StageCache` is internal here exactly as it is in the TypeScript. Its one rule
worth knowing: **a stage that re-runs drops everything downstream of it.**
Aligning with a different model invalidates the diff measured on the old
alignment, and the audit built on both.

## Despeckling and noise

A **median** filter, unlike the mean the background is estimated with, rejects
the isolated specks a scanner leaves instead of smearing them into their
neighbours - which, once contrast is stretched, is how a speck fuses into a thin
stroke and a `1` becomes an `l`.

```python
from scanmate_scan import despeckle, estimate_noise_sigma

cleaned = despeckle(page.pixels, page.width, page.height, radius=1)
estimate_noise_sigma(grey)   # ~0 for a clean render, far higher for a photocopy
```

Two details the whole image hangs on, and both are pinned: alpha is **copied,
never filtered**, because a median of the alpha channel would invent edges where
a page is transparent; and a window clipped at the border may hold an even
count, where the middle taken is the **upper** one - a mean-based median would
be half a level out on every edge pixel.

`estimate_noise_sigma` is Immerkaer (1996): the mean absolute response of a
Laplacian-difference kernel, scaled so Gaussian noise of standard deviation
sigma scores sigma. Text and edges occupy a small share of a page and noise is
everywhere, so on a document the noise dominates.

## Levelling and contrast

Scanned and photographed pages come back with shadows, yellowed or grey paper and
washed-out text. Dividing each pixel by an estimate of the paper behind it - a
wide box mean, which no stroke is big enough to move - flattens the lighting and
leaves the ink; a linear stretch between the black and white points then clamps
paper towards white and ink towards black. In colour mode each channel is divided
by its own background, which corrects the white balance while a blue pen stays
blue.

```python
from scanmate_scan import EnhanceOptions, SharpenOptions, enhance_raster

result = enhance_raster(page)                                  # every default
result.applied.white_point, result.applied.despeckled           # what it chose

enhance_raster(page, EnhanceOptions(white_point=0.95))          # fix one point
enhance_raster(page, EnhanceOptions(sharpen=SharpenOptions(sigma=2)))
```

Read what `"auto"` actually does, because it is **not** "paper to white". Paper is
nearly all of a page and noise spreads it both ways, so its brightest 1% sit
above 1 and the white point lands on its 1.1 bound; ink is a few percent of a
text page, so the black point lands low. `"auto"` is therefore a gentle stretch
that leaves paper light grey - kept because on OCR word recall it beat fixed
points that do whiten the paper. For white paper, pass a fixed `white_point`
below 1.

Two roundings sit side by side here, and either would be right on most pixels on
its own: the contrast stretch rounds a half **up** (`Math.round`), while the
unsharp mask writes into a `Uint8ClampedArray`, which rounds a half **to even**.
Both are pinned, and the tests compare the whole enhanced page as a sha256 over
every byte rather than sampling it, because sampling is exactly how a
one-rule-for-both port passes.

`sharpen_raster` is **absent**: it is the same unsharp mask with the blur done by
libvips, and `blur_raster` is absent from `scanmate-ink` for the reason that
package's README gives. `sharpen` here uses the box-blur mask, which is the one
the sharpening was tuned with.

## What is not here

**The session that ties the pipeline together**, and most of what it calls. The
TypeScript package orchestrates PDF rendering and OCR, and neither is ported:
see [`scanmate-extract`][extract] and [`scanmate-ocr`][ocr] for why — pdf.js's
rasteriser and text-layer segmentation, and Tesseract, have no Python equivalent
that could honestly be called a parallel port.

What remains portable, and is not yet done: the rest of the image algorithms
(`scan-enhancement`, `checkbox-reading`, `audit-evidence`,
`audit-calibration`), `region-comparison`, `finding-correlation`,
`corpus-calibration`, `audit-reuse`, `signature-checking`, and
`content-search`. About 2,400 of the TypeScript's 6,700 lines.

## Requirements

Python 3.11 or newer, with `scanmate-ink` and `scanmate-ocr`. Fully typed
(PEP 561), `mypy --strict` clean.

[ts]: https://github.com/russoedu/scanmate/tree/main/packages/scan#readme
[extract]: https://github.com/russoedu/scanmate/tree/main/python-packages/scanmate-extract#readme
[ocr]: https://github.com/russoedu/scanmate/tree/main/python-packages/scanmate-ocr#readme
