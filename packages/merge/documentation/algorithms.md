# How `@scanmate/merge` decides

One question: **what should each source become, as a page of one PDF?**

It sounds trivial and is not, because every wrong answer costs something later.
Re-encode a JPEG and it loses detail the check needed. Put a photo on a page the
size of its pixel count and every later stage reads its resolution as 72 dpi.
Re-render a PDF and the signatures in it stop being the signatures that were
signed.

![three pages of a form photographed, and the form itself, merged into one document](../assets/merged.jpg)

*Pages of the [IRS Form W-9](https://www.irs.gov/pub/irs-pdf/fw9.pdf) (public
domain) as images, plus the PDF itself, in one file.*

## The shape of it

```mermaid
flowchart TD
  A[source] --> B{what is it,<br/>by content not by name?}
  B -->|PDF| C{the only source,<br/>and no metadata asked for?}
  C -->|yes| D[returned byte for byte<br/>passedThrough]
  C -->|no| E[pages copied, never re-rendered]
  B -->|JPEG, upright, RGB or grey| F[embedded as its own bytes]
  B -->|PNG| G[pixels carried over losslessly]
  B -->|TIFF, WebP, HEIF, AVIF, GIF,<br/>CMYK or rotated JPEG| H[decoded once, rotation applied,<br/>transparency flattened, encoded once]
  B -->|Raster or PageImage| I{already encoded<br/>as PNG or JPEG?}
  I -->|yes| J[those bytes embedded]
  I -->|no| K[encoded once]
  F --> L[page sized from the image's resolution]
  G --> L
  H --> L
  J --> L
  K --> L
  E --> M[one PDF]
  D --> M
  L --> M
```

## Never encode twice

A JPEG that is already upright and RGB is embedded **as its own bytes**. No
decode, no re-encode, no second generation of blocking artefacts over the text
a checker will later try to read. The same holds for a PNG's pixels, and for a
raster that arrives with its encoded bytes alongside it — which is what every
`PageImage` in this pipeline is.

Only what cannot be embedded as it stands is decoded: a JPEG whose EXIF says it
is rotated (the rotation is applied, once), a CMYK JPEG, a TIFF — every page of
it — WebP, HEIF, AVIF, GIF, or a bare raster.

A single PDF on its own comes back **byte for byte**: stored exactly as it was
scanned, signatures and all. Asking for metadata is the one thing that turns
that off, because writing a title means writing a new file.

## Page size carries the resolution

```mermaid
flowchart TD
  A[image] --> B{caller gave a dpi?}
  B -->|yes| C[use it]
  B -->|no| D{the file records one<br/>≥ 100 dpi?}
  D -->|yes| C
  D -->|no| E[imageDpi, 150 by default]
  C --> F{pageSize}
  F -->|image| G[page = pixels ÷ dpi<br/>a 2480×3508 scan at 300 dpi becomes A4]
  F -->|a4 / letter / custom| H[fitted on the sheet, centred,<br/>turned landscape for a landscape image]
```

The default — the page is the image at its resolution — exists so that a reader
who divides pixels by page inches, as `@scanmate/extract` does, gets the scan's
real resolution back. That is the number every later decision depends on:
whether the text can be verified at all, what to render the original at, how
much detail there is to compare.

Files that claim 72 or 96 dpi are ignored (`MIN_RECORDED_DPI` is 100): those are
software defaults, not measurements, and a phone photo carrying "72 dpi" holds
far more than that on the paper.

## Constants

| option | default | |
|---|---|---|
| `pageSize` | `'image'` | Or `'a4'`, `'letter'`, or a size in points. |
| `imageDpi` | `150` | For images that record no usable resolution. |
| `encoding` | `'png'` | For what must be re-encoded; `'jpeg'` is much smaller. |
| `quality` | `92` | JPEG quality. |
| `passThrough` | `true` | A lone PDF comes back unchanged. |
| `metadata` | none | Title, author, subject, keywords, creator. |
| — | `100` dpi | Least recorded resolution that is believed. |

Measured: three 120-dpi page JPEGs plus a 7-page PDF merged in 20 ms (0.73 MB);
seven aligned pages made a 3.3 MB PNG or 0.74 MB JPEG evidence file.

## What it does not do

- It does not reorder anything. Upload order is page order, because that is the
  only order that reconstructs a document someone scanned sheet by sheet.
- It does not OCR, compress for size, or "improve" an image.
- It does not repair a corrupt PDF; an encrypted one is refused with a clear
  error naming which source it was.
