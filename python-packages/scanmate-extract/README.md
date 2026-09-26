# scanmate-extract

The decisions a PDF extraction pipeline makes: which pages, which pairs, at what
resolution, and where a form's fields are.

A **parallel port** of [`@scanmate/extract`][ts] — of the half of it that *can*
be one. Every value here is held to the TypeScript's own output, exactly.

```sh
pip install scanmate-extract
```

```python
from scanmate_extract import pair_dpi, resolve_fields, select_pages

select_pages("1-3,5", 8)                 # [1, 2, 3, 5]
pair_dpi(original, scanned, "match")     # a resolution for each side
resolve_fields(pages, specs)             # field regions, from the labels a form prints
```

## What this package deliberately does not do

**It does not render PDFs, and it does not read their text layers.**

Those are the two things pdf.js does that no Python engine does the same way:

- **Rasterising** a page through pdf.js onto a canvas produces particular
  pixels. pdfium produces different ones. Not worse — different.
- **Segmenting a text layer** into runs is pdf.js's own: where one run ends and
  the next begins, and the per-font ascent/descent metrics that give each run
  its height, are decisions pdf.js makes. Another engine returns a different
  *set of runs*, not the same runs with different numbers.

So `render_page`, `read_text_layer`, `inspect_page`, `inspect_document`,
`extract_pages`, `extract_pair`, `locate_fields` and `open_pdf` are **absent on
purpose**, and `test_package_surface.py` says so in a table that fails if a new
export upstream lands in neither list. That is the same position
[`scanmate-ink`][ink] takes on `resampleRaster` and `blurRaster`: where two
engines cannot agree by construction, say so rather than ship something that
wears the name without keeping the promise.

## What it does do, exactly

Everything that is a *decision* rather than an engine's output — which is most
of the interesting logic, and all of the logic that is easy to get subtly wrong:

| | |
| --- | --- |
| `select_pages` | `"1-3,5,8-"` and page lists, sorted, deduplicated, bounds-checked |
| `plan_pairs` | which scanned page goes with which original, and what is left over |
| `classify_page` | scan, born-digital, scan-with-OCR-layer, or blank |
| `native_dpi` · `page_dpi` · `pair_dpi` | what resolution to render at |
| `locate_anchor` · `resolve_fields` · `place_field` | where a form's fields are |

### The resolution policy is the subtle one

`"match"` renders the original at the scan's resolution **measured on the paper
it shows**, not the resolution the scan claims of itself. A 3024-pixel photo of
an A4 sheet stored one pixel per point says *72 dpi*; on the sheet it holds
*345*. So the original renders at 345 and the photo at its own pixels, never
resampled, leaving the scale to alignment.

That is an answer to a measurement rather than a guess: on real scans at 93, 120
and 144 dpi, matching beat every fixed choice from 150 to 300 — on alignment
confidence, on overlap, on time, and on false "changes" at stroke edges, which
at 300 dpi reached 0.18% of the page on a 93 dpi scan and were zero at matched
dpi.

### Field location works on text you already have

`resolve_fields` takes pages' text runs, so it runs on text extracted by
whatever you like — that is *why* it stays exact while reading a text layer does
not. A generated document's fields move with its content; what does not move is
a field's place beside its label, so each field is an offset from an anchor and
the anchor is found in the text.

Anchors join across runs and across a wrapped line, are matched whole-word with
edge punctuation set aside (`"Date"` never finds `"Update"`), and read correctly
on quarter-turned runs. Where an anchor starts or ends *inside* a run the box is
placed in proportion to its characters and reported as `estimated`, because a
run's words are not measured one by one.

## Requirements

Python 3.11 or newer, and `scanmate-ink`. Fully typed (PEP 561), `mypy --strict`
clean. No PDF engine, because it opens no PDFs.

[ts]: https://github.com/russoedu/scanmate/tree/main/packages/extract#readme
[ink]: https://github.com/russoedu/scanmate/tree/main/python-packages/scanmate-ink#readme
