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

## What is not here

**The session that ties the pipeline together**, and most of what it calls. The
TypeScript package orchestrates PDF rendering and OCR, and neither is ported:
see [`scanmate-extract`][extract] and [`scanmate-ocr`][ocr] for why — pdf.js's
rasteriser and text-layer segmentation, and Tesseract, have no Python equivalent
that could honestly be called a parallel port.

What remains portable, and is not yet done: the image algorithms
(`illumination-correction`, `noise-reduction`, `scan-enhancement`,
`checkbox-reading`, `audit-evidence`, `audit-calibration`), `region-comparison`,
`finding-correlation`, `corpus-calibration`, `audit-reuse`,
`signature-checking`, and `content-search`. About 2,800 of the TypeScript's
6,700 lines.

## Requirements

Python 3.11 or newer, with `scanmate-ink` and `scanmate-ocr`. Fully typed
(PEP 561), `mypy --strict` clean.

[ts]: https://github.com/russoedu/scanmate/tree/main/packages/scan#readme
[extract]: https://github.com/russoedu/scanmate/tree/main/python-packages/scanmate-extract#readme
[ocr]: https://github.com/russoedu/scanmate/tree/main/python-packages/scanmate-ocr#readme
