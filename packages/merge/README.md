![scanmate merge](./assets/scanmate-merge.svg)

# `@scanmate/merge`

PDFs, images and rasters into one PDF, in the order given and mixed freely.

![three photographed pages and a PDF, merged into one document](./assets/merged.jpg)

*Three photographed pages and a PDF, in one document: the JPEGs embedded as their own bytes, the PDF's pages copied, never re-rendered. Made from the [IRS Form W-9](https://www.irs.gov/pub/irs-pdf/fw9.pdf) (a work of the United States government, in the public domain): filled in as a generator would, printed, signed by hand and scanned crooked.*

## Install

```bash
npm install @scanmate/merge
```

```ts
import { mergeDocuments } from '@scanmate/merge'

// The picture above: three photographed pages, then a PDF, as one document.
const { pdf, pages } = await mergeDocuments(['page-1.jpg', 'page-2.jpg', 'page-3.jpg', 'fw9-issued.pdf'])

// A pipeline's aligned pages as one evidence file:
const evidence = await mergeDocuments(
  aligned.map(p => ({ raster: p.aligned.raster, dpi: p.original.dpi })),
  { metadata: { title: 'Aligned scan' } },
)
```

## What goes in, and how

| Source | Result |
|---|---|
| PDF (path or bytes) | Pages copied, never re-rendered: text layer, vectors and signatures stay intact. Encrypted PDFs are refused with a clear error. |
| JPEG, upright, RGB or grey | Embedded as its own bytes, so it is never compressed twice. |
| PNG | Pixels carried over losslessly. |
| JPEG needing EXIF rotation, CMYK JPEG, TIFF (every page), WebP, HEIF, AVIF, GIF | Decoded (rotation applied, transparency flattened onto white), then encoded once. |
| `Raster`, or `{ raster, dpi, image? }`, i.e. any `PageImage` | Its `image` bytes are embedded when they are PNG or JPEG; otherwise the raster is encoded. |

The type of each source is detected from its content, not its name. A single PDF on its own comes back byte for byte (`passedThrough: true`), unless `metadata` asks for a new file.

## Page size

By default each image page is the image at its resolution. A 2480 × 3508 scan at 300 dpi becomes an A4 page, so a reader that divides pixels by page inches, as `@scanmate/extract` does, gets the scan's real resolution back. Resolution comes from the caller, then the file (if it records at least 100 dpi; 72 and 96 are software defaults), then `imageDpi`. `pageSize: 'a4' | 'letter' | { width, height }` fits the image on paper instead: centred, turned landscape for a landscape image, with an optional `margin`.

| Option | Default | |
|---|---|---|
| `pageSize` | `'image'` | Or `'a4'`, `'letter'`, `{ width, height }` in points. |
| `imageDpi` | `150` | For images that record no resolution, or 72/96. |
| `encoding` | `'png'` | For images that must be re-encoded; `'jpeg'` is much smaller. |
| `quality` | `92` | JPEG quality. |
| `passThrough` | `true` | Return a lone PDF unchanged. |
| `metadata` | none | Title, author, subject, keywords, creator. The producer is always `@scanmate/merge`. |

Each entry in `pages` says which source and source page it came from, how it was embedded, and its size. A source that cannot be used raises a `MergeSourceError` carrying its `index`.

Measured on real scans: three 120-dpi page JPEGs plus a 7-page PDF merged in 20 ms (0.73 MB). Seven aligned pages made a 3.3 MB PNG or 0.74 MB JPEG evidence file.

PDF writing uses `@cantoo/pdf-lib`, the maintained fork of pdf-lib, which is pure JavaScript with nothing to install on the host.

## Drawing on a PDF, not just assembling one

The other thing this package writes is marks. `markPages` draws a set of regions on a PDF as vector rectangles, each with its bleed dashed around it, and hands the PDF back:

```ts
import { markPages } from '@scanmate/merge'

const { pdf, drawn, warnings } = await markPages('issued.pdf', [
  { page: 1, id: 'signature', x: 120, y: 577, width: 262, height: 22 },
], { bleedTop: 2, bleedBottom: 12 })
```

It exists to check that the regions a validation will measure are where the document's fields actually are - most people reach it as `Scanmate.mark` in `@scanmate/scan`, whose README has a worked example on the W-9.

Two things it gets right that a naive version would not. **Rotation and crop box:** a region is in points from the top-left of the page *as displayed*, which is how `@scanmate/extract` reports text, while pdf-lib draws from the bottom-left of the unrotated media box. The conversion between the two is pdf.js's own page transform, ported line for line and inverted, and its spec pins it to values read off real pdf.js for every quarter turn, with and without an offset crop box. **Bleed:** it is resolved by `resolveBleed` from `@scanmate/ink`, the same function the pixel comparison uses, so the band drawn is the band measured.

## How it decides

[`documentation/algorithms.md`](./documentation/algorithms.md) has the algorithms in full: what each step measures, the decision flows, every constant with the measurement behind it, and what the package deliberately does not do.
