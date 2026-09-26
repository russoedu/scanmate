# scanmate-merge

Many files in, one PDF out: PDFs, images and rasters, in the order given, mixed
freely.

A **parallel port** of [`@scanmate/merge`][ts], not a replacement for it. The
TypeScript remains the reference — with one boundary, stated below, that this
package cannot cross and does not pretend to.

```sh
pip install scanmate-merge
```

```python
from scanmate_merge import merge_documents

result = merge_documents(["scan1.jpg", "contract.pdf", "scan2.png"])
result.page_count
result.pages[0].embedding   # 'jpeg' - the source's own bytes, not re-compressed
```

## What it preserves

- **A PDF's pages are copied, not re-rendered**, so their text layer, vectors
  and any signatures stay as they were.
- **A JPEG is embedded as its own bytes** — RGB or grey, no EXIF rotation
  pending — so a scan is not compressed a second time on its way into evidence.
- **A PNG's pixels are carried over losslessly.** Not the PNG *file*: a PDF
  cannot hold one, so the pixels go in deflated, which is what the TypeScript
  does too.
- Anything else is decoded — EXIF rotation applied, transparency flattened onto
  white, every page of a multi-page TIFF — and encoded **once**.

**A single PDF on its own comes back byte for byte.** Re-saving a signed PDF
breaks its signature, and a PDF "merged" alone has nothing to merge, so it is
not touched at all. Asking for metadata turns that off, because writing metadata
means writing a new file, and the result says which happened.

## The parity boundary

Every other package in this port is held to the TypeScript bit for bit. This one
cannot be, and the reason is not a shortcut: **two PDF writers lay out objects,
streams and the cross-reference table differently**, so two valid merges of the
same sources are never the same file. pdf-lib and `pypdf` are different writers.

So parity here is held at the level that actually means something:

| Held exactly | Not held |
| --- | --- |
| page count, and which source each page came from | the produced PDF's bytes |
| how each page was embedded (`jpeg`, `png`, `encoded-png`, …) | object numbering, stream order |
| every page's size in points, and the dpi it was placed at | compression details |
| whether a single PDF passed through untouched | |
| page geometry: `place_image`, `resolve_dpi`, the viewport transforms | |
| `mark_pages`' count and its warning sentences, verbatim | |

That is the same boundary [`scanmate-ink`][ink] already draws around
`resampleRaster` and `blurRaster`: where two engines cannot agree by
construction, say so rather than write a golden nobody can meet.

What the produced file *is* checked for: that it is a readable PDF, that its
pages are the sizes the result reports, that a JPEG went in as `/DCTDecode` and
a PNG's pixels as `/FlateDecode`, and that marking a page adds to its content
rather than replacing it.

## Marking a page

`mark_pages` draws each expected field on the original, with its bleed around
it — a way to see whether the positions a validation will use are where the
fields actually are, before anything is measured with them.

```python
from scanmate_merge import PageMark, mark_pages

result = mark_pages(pdf, [PageMark(page=1, x=72, y=520, width=180, height=36, id="signature")])
result.warnings   # a mark on a page that does not exist, or one past the edge
```

Drawn as vectors on the document itself, so it stays sharp at any zoom. The
coordinates are measured from the **top-left of the page as displayed**, with
`/Rotate` and the crop box applied — the same frame `scanmate-extract` reports
text in, so a list measured there can be drawn here unchanged. Getting between
that frame and the PDF's own is pdf.js's `PageViewport` transform, ported line
for line and inverted; it is exact, and it is where a "close enough" port would
give false confidence on exactly the rotated and cropped pages that most need
checking.

## Two departures from the TypeScript

**Nothing is `async`.** `mergeDocuments`, `markPages` and `readSource` are, for
file reads and libvips; this reads files synchronously, as the rest of the
Python port does.

**`MergeOptions` and `MarkOptions` are dataclasses**, not object literals, so
`page_size`, `image_dpi` and `pass_through` are snake_case keyword arguments.

## Requirements

Python 3.11 or newer, and `scanmate-ink`. Fully typed (PEP 561), `mypy --strict`
clean. PDF reading and writing is [`pypdf`][pypdf].

[ts]: https://github.com/russoedu/scanmate/tree/main/packages/merge#readme
[ink]: https://github.com/russoedu/scanmate/tree/main/python-packages/scanmate-ink#readme
[pypdf]: https://pypdf.readthedocs.io/
