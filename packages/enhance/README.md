![scanmate enhance](./assets/scanmate-enhance.svg)

# `@scanmate/enhance`

Scans cleaned for reading: even lighting, lighter paper, darker ink, and speckle removed where a page is measurably noisy. Pages below 300 dpi are enlarged to 300 first, since that is the resolution OCR reads best at.

![the same lines off the scan, and off the enhanced copy](./assets/enhanced.jpg)

*The same lines read off the scan, and off the enhanced copy: even lighting, white paper, darker ink. Made from the [IRS Form W-9](https://www.irs.gov/pub/irs-pdf/fw9.pdf) (a work of the United States government, in the public domain): filled in as a generator would, printed, signed by hand and scanned crooked.*

## Install

```bash
npm install @scanmate/enhance @scanmate/align
```

```ts
import { enhancePages, enhanceScan } from '@scanmate/enhance'

// A pipeline stage: aligned pages in, each with a cleaned copy alongside.
const pages = await enhancePages(alignedPages)
pages[0].aligned.raster    // left above: the scan as it was aligned
pages[0].enhanced.raster   // right: the same lines cleaned, at 300 dpi on the original's canvas
pages[0].enhanced.applied  // what was done: clamp points, whether it despeckled, measured noise

// Or one image: a raster, bytes or a path.
const { raster, dpi } = await enhanceScan('fw9-returned.jpg')
```

## How it works

Each pixel is divided by an estimate of the paper behind it, a box mean over a window about 1/16 of the page, which no stroke can fill. That flattens shadows, tinted stock and uneven lighting. The result is then stretched linearly between a black point and a white point. In `color` mode each channel is divided by its own background, which corrects the white balance while a blue pen stays blue.

## Defaults, and how they were chosen

Defaults were measured by OCR word recall against the text layer on 21 pages of three real scans (93, 120 and 144 dpi):

| After enlarging to 300 dpi | 120 dpi | 93 dpi | 144 dpi |
|---|---|---|---|
| no enhancement | 0.827 | 0.397 | 0.960 |
| **automatic clamp points (default)** | 0.794 | **0.448** | **0.971** |
| fixed points 0.05 / 0.92 | 0.814 | 0.449 | 0.938 |
| fixed points, always despeckle | 0.806 | 0.429 | 0.936 |

Despeckling at the scans' own resolution, before enlarging, was far worse: 0.141 against 0.392 at 93 dpi. A 3×3 median erases strokes that are only one or two pixels wide. So `despeckle` is `'auto'` by default: it runs only when a page's measured noise (Immerkær's estimator) is above `despeckleThreshold`.

What `'auto'` clamp points really do: the white point is where the brightest 1% of pixels start and the black point is where the darkest 1% end, each within fixed bounds. On a real text page they settle at those bounds (0.4 and 1.1), so paper comes out light grey (about 220) rather than white, and ink comes out deeper. That setting read best. For pure white paper, pass a fixed `whitePoint` below 1.

The window also picks up large dark areas, such as a solid header bar or shaded table rows, and leaves soft halos around them. The measurements above include that effect.

| Option | Default | |
|---|---|---|
| `targetDpi` | `300` | Enlarge to this when below it, never reduce. `null` keeps the resolution. |
| `whitePoint` / `blackPoint` | `'auto'` | Or a share of the local background. |
| `mode` | `'color'` | `'grayscale'` is about twice as fast. |
| `despeckle` | `'auto'` | `true`, `false`, or measure first. |
| `despeckleThreshold` | `0.01` | Noise level, on the 0–1 grey scale, above which `'auto'` despeckles. |
| `despeckleRadius` | `1` | 3×3 window. |
| `backgroundFraction` | `1/16` | Background window, as a share of the shorter side. |
| `sharpen` | `false` | `{ sigma, amount? }`: an unsharp mask on the enlarged, levelled page. `@scanmate/scan` chooses it per document by measurement. |
| `output` | `'png'` | Encoding of `image`; `'none'` skips it. |
| `source` (`enhancePages`) | `'aligned'` | Or `'scanned'`, the scan as it came. |

A cleaned page keeps its canvas: enlarged by `scale`, a region in PDF points still lands at `points * dpi / 72`.

## How it decides

[`documentation/algorithms.md`](./documentation/algorithms.md) has the algorithms in full: what each step measures, the decision flows, every constant with the measurement behind it, and what the package deliberately does not do.
