![scanmate audit](./assets/scanmate-audit.svg)

# `@scanmate/audit`

The final audit of a returned document. Every page is read in full and compared pixel by pixel. The two results are merged into one list of findings and a verdict, with a side-by-side image as evidence.

![the evidence page: original and returned scan side by side, findings drawn on both](./assets/evidence.jpg)

*The evidence page: the original and the returned scan side by side, every finding drawn on both halves. Green a field filled in, orange the room a signature is given to stray, red text that reads differently. Made from the [IRS Form W-9](https://www.irs.gov/pub/irs-pdf/fw9.pdf) (a work of the United States government, in the public domain): filled in as a generator would, printed, signed by hand and scanned crooked.*

## Install

```bash
npm install @scanmate/audit @scanmate/extract @scanmate/align
```

```ts
import { extractPair } from '@scanmate/extract'
import { alignPages } from '@scanmate/align'
import { auditPages } from '@scanmate/audit'

const { pages } = await extractPair({ original: 'contract.pdf', scanned: 'returned.pdf' })
const audit = await auditPages(await alignPages(pages), {
  expected: [{ page: 6, id: 'customer-signature', x: 82, y: 223, width: 480, height: 40 }],
  content:  [{ page: 1, content: ['The Resistance', '27,211,380.00'] }],
})

audit.verdict                  // 'pass' | 'review'
audit.pages[0].reasons         // why, one sentence each
audit.pages[0].findings        // text and pixel findings, merged by place
audit.pages[0].evidenceImage   // original and scan side by side, findings drawn on both
audit.pages[0].text            // the full OCR comparison (@scanmate/ocr)
audit.pages[0].pixels          // the full pixel comparison (@scanmate/diff)
```

## Why both

Each comparison is blind where the other sees:

| Change | Reading (`@scanmate/ocr`) | Pixels (`@scanmate/diff`) |
|---|---|---|
| A digit altered: 1,250.00 → 7,250.00 | ✓ figures must match exactly | ✗ the new glyph stays within the tolerance band |
| A signature, a stamp, a tick | ✗ not writing | ✓ ink where none was |
| An expected field left empty or blacked out | - | ✓ |
| A paragraph removed | ✓ runs missing | ✓ ink lost |
| Required content in the wrong place | ✓ via `@scanmate/find` | - |

So both run. Findings at the same place become one finding marked **corroborated**, for example a stray mark that also reads as words. A required value that reads wrong is a single finding, not two. Text differences that an expected region explains are set aside in `explained`, not reported: a signature read as "Ae dhe", or the "Signature" label written across. So are words over something the original prints as an image, such as a logo.

A page **passes** only when it has no findings and its text score is high enough to trust that (`minTextScore`, 0.85). A 93-dpi scan can read so poorly that silence proves nothing; such a page goes to review and says why.

## Findings

| Kind | Meaning |
|---|---|
| `unexpected-mark` | Ink added where nothing was expected. |
| `missing-ink` | Printed ink the scan lost. |
| `text-changed` / `text-missing` / `text-added` | The reading disagrees with the original where the pixels saw nothing. |
| `expected-empty` / `expected-overfilled` | An expected region left empty, or covered rather than filled in. |
| `content-missing` / `content-not-identifiable` | Required content not on its page, or not at every place the original prints it. |

Each finding carries its position in points, a one-sentence summary, and its evidence (`text`, `pixels`).

## The evidence image

The original and the aligned scan side by side, with the same boxes on both halves:

- **green**: expected region filled in
- **amber**: expected region left empty, or blacked out
- **magenta**: unexpected mark
- **blue**: printed ink lost
- **red**: text reading differently, or required content out of place

Corroborated findings are drawn twice as thick.

## Options

| Option | Default | |
|---|---|---|
| `expected` | none | Regions where a change is expected, in points (`resolveRegions` in `@scanmate/find` builds them from anchors). |
| `content` | none | Content that must be on each page. |
| `ocr` | `@scanmate/ocr` defaults | Engine, languages and cache, the recheck, thresholds. Pass `ocr.engine` to share one engine across audits. |
| `diff` | `@scanmate/diff` defaults | Tolerances, minimum areas, form-line handling. Rectangles are always in points. |
| `find` | `@scanmate/find` defaults | `minScore`, normalisation. |
| `minTextScore` | `0.85` | Below this, a page's text is too unreliable for it to pass. |
| `output` | `'png'` | Encoding of the evidence image and the pixel overlay; `'none'` keeps only rasters. |
| `onProgress` | none | Receives `ocr`, `diff` and `audit` stage events. |

## How it decides

[`documentation/algorithms.md`](./documentation/algorithms.md) has the algorithms in full: what each step measures, the decision flows, every constant with the measurement behind it, and what the package deliberately does not do.
