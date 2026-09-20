![scanmate audit](./assets/scanmate-audit.svg)

# `@scanmate/audit`

The final audit of a returned document. Every page is read in full and compared pixel by pixel. The two results are merged into one list of findings and a verdict, with a side-by-side image as evidence.

![the evidence page: the original, the returned scan and the overlay side by side, findings drawn on each](./assets/evidence.jpg)

*The evidence page: the original, the returned scan and the overlay of the two, with the same places boxed on each. The original asks the questions in blue; the scan answers each in the colour of its verdict - green filled in, red changed, pink the room a signature is given to stray; the overlay shows violet where the ink differs and grey where it agrees, so a red box can be checked rather than taken on trust. The account number is the only finding: one printed digit replaced by another. Made from the [IRS Form W-9](https://www.irs.gov/pub/irs-pdf/fw9.pdf) (a work of the United States government, in the public domain): filled in as a generator would, printed, signed by hand and scanned crooked.*

## Install

```bash
npm install @scanmate/audit @scanmate/extract @scanmate/align
```

```ts
import { extractPair } from '@scanmate/extract'
import { alignPages } from '@scanmate/align'
import { auditPages } from '@scanmate/audit'

const { pages } = await extractPair({ original: 'fw9-issued.pdf', scanned: 'fw9-returned.pdf' })
const audit = await auditPages(await alignPages(pages), {
  // The W-9's signature row, measured off the form in points from the page's top-left.
  expected: [
    { page: 1, id: 'signature', x: 120, y: 577, width: 262, height: 22 },
    { page: 1, id: 'date',      x: 404, y: 577, width: 171, height: 22 },
  ],
  content: [{ page: 1, content: ['Vector Supply Company, Inc.', 'Account 4412-9087-3355'] }],
})

audit.verdict                  // 'pass' | 'review'
audit.pages[0].reasons         // why, one sentence each
audit.pages[0].findings        // text and pixel findings, merged by place
audit.pages[0].evidenceImage   // original, scan and overlay side by side, findings drawn on each
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

Three panels with the same places boxed on each: the original, which says **where** the question is; the aligned scan, which says **what** the answer is; and the overlay of the two, which says **why** - violet where the ink of the two differs, grey where they agree.

The overlay carries no verdicts of its own: what passed and what failed is the middle panel's job. It is worth knowing what it cannot show - a printed digit replaced by another of the same size moves about 0.1 mm² of ink, nearly all of it inside the band that forgives misregistration, so a forged figure appears there as grey. That is exactly why the glyph check exists, and why a finding does not depend on the pixels agreeing.

| | on the original | on the scan |
|---|---|---|
| **blue** | every place being asked about | required content that reads correctly |
| **green** | | a field that was filled in |
| **red** | | a field left empty or covered, content or a figure that changed |
| **pink** | | the band where ink still counts as a field's |
| **orange** | | ink added where nothing was expected |
| **cyan** | printed ink the scan lost | the same place, where it is not |

Corroborated findings are drawn twice as thick, and a legend runs along the foot (`legend: false` turns it off).

## A reading is not a change until the ink agrees

OCR misreads small, faint and sideways print constantly - `W-9` comes back as `W 2] 9` - and a reader's disagreement is not evidence that the paper differs. So every text difference the pixels did not already account for is measured at its own box: if the ink there is identical (under 0.3 mm² added or lost), the characters are identical however they were read, and the difference is set aside as `noise` rather than reported.

A figure the print check matched against the original's own glyphs and found to be *different* glyphs is exempt: that one was seen, not read.

```ts
audit.pages[0].findings   // what is actually wrong
audit.pages[0].noise      // read differently, printed identically
```

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
