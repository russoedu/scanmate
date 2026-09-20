![scanmate audit](./assets/scanmate-audit.svg)

# `@scanmate/audit`

The final audit of a returned document. Every page is read in full and compared pixel by pixel. The two results are merged into one list of findings and a verdict, with a side-by-side image as evidence.

![the evidence page: the original, the returned scan and the overlay side by side, findings drawn on each](./assets/evidence.jpg)

*The evidence page: the original, the returned scan and the overlay of the two, with the same places boxed on each. The original asks the questions in blue; the scan answers each in the colour of its verdict - green filled in, red changed, pink the room a signature is given to stray, olive a disagreement nothing could settle; the overlay shows violet where the ink differs and grey where it agrees, so a red box can be checked rather than taken on trust. One red box: the account number, one printed digit replaced by another. Made from the [IRS Form W-9](https://www.irs.gov/pub/irs-pdf/fw9.pdf) (a work of the United States government, in the public domain): filled in as a generator would, printed, signed by hand and scanned crooked.*

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
})

audit.verdict                  // 'pass' | 'review'
audit.pages[0].reasons         // why, one sentence each
audit.pages[0].findings        // text and pixel findings, merged by place
audit.pages[0].noise           // read differently, printed identically - not reported
audit.pages[0].settled         // how each disagreement was settled, and what each re-read said
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

So both run. Findings at the same place become one finding marked **corroborated**, for example a stray mark that also reads as words. A required value that reads wrong is a single finding, not two. Text differences that an expected region explains are set aside in `explained`, not reported: a signature read as "Ae dhe", or the "Signature" label written across. So are words over something the original prints as an image, such as a logo.

A page **passes** only when it has no findings and its text score is high enough to trust that (`minTextScore`, 0.85). A 93-dpi scan can read so poorly that silence proves nothing; such a page goes to review and says why.

## Findings

| Kind | Meaning |
|---|---|
| `unexpected-mark` | Ink added where nothing was expected. |
| `missing-ink` | Printed ink the scan lost. |
| `text-changed` / `text-missing` / `text-added` | The reading disagrees with the original where the pixels saw nothing. |
| `expected-empty` / `expected-overfilled` | An expected region left empty, or covered rather than filled in. |
| `text-unsettled` | The reading disagrees, the ink at that run is identical, and re-reading both sides could not settle it. |

Each finding carries its position in points, a one-sentence summary, and its evidence (`text`, `pixels`).

## The evidence image

Three panels with the same places boxed on each: the original, which says **where** the question is; the aligned scan, which says **what** the answer is; and the overlay of the two, which says **why** - violet where the ink of the two differs, grey where they agree.

The overlay carries no verdicts of its own: what passed and what failed is the middle panel's job. It is worth knowing what it cannot show - a printed digit replaced by another of the same size moves about 0.1 mm² of ink, nearly all of it inside the band that forgives misregistration, so a forged figure appears there as grey. That is exactly why the glyph check exists, and why a finding does not depend on the pixels agreeing.

| | on the original | on the scan |
|---|---|---|
| **blue** | every place being asked about | |
| **green** | | a field that was filled in |
| **red** | | a field left empty or covered, or a figure that changed |
| **pink** | | the band where ink still counts as a field's |
| **orange** | | ink added where nothing was expected |
| **cyan** | printed ink the scan lost | the same place, where it is not |
| **olive** | | read differently, ink identical, nothing could settle it |

Corroborated findings are drawn twice as thick, and a legend runs along the foot (`legend: false` turns it off).

## When the two disagree

OCR misreads small, faint and sideways print constantly - `W-9` comes back as `W 2] 9`, `I am` as `1am` - so a reading that disagrees with the original is not by itself a change. Nor is it nothing. Rather than let one comparison overrule the other, the disagreement is settled:

1. **The glyph check.** If the printed run's ink was matched against the original's own glyphs and found to be *other* glyphs, that was seen rather than read. Changed.
2. **The ink at that run.** If 0.3 mm² or more moved there, changed.
3. **Match the run's glyphs, letters and digits alike,** against the faces the page itself prints. Every glyph the one printed? Then the pages carry the same characters and the reading was simply wrong. A glyph that fails to match does *not* condemn the run: over 327 runs of four real documents that call was wrong about one time in eighty, which is fine for dismissing an argument and disgraceful for starting one.
4. **Read both sides again, and compare them with each other.** Three passes over the original's crop and the scan's. If the two read alike, the pages carry the same glyphs however wrongly they were read - a systematic misreading misreads the original exactly as it misreads the scan, so it cancels. Not reported; it lands in `noise`.
5. **Otherwise, unsettled** - reported as `text-unsettled`, in its own colour.

Disagreement between the two sides never condemns a run on its own. The original is a clean render and the scan has been printed, posted and scanned, so it reads worse by nature; treating that as evidence turns ordinary degradation into an accusation.

On the returned W-9 above, ten disagreements: six settled as misreadings, three unsettled, and one changed - the forged digit.

```ts
audit.pages[0].settled[0]   // { verdict: 'misread', because: 'both-sides-alike', readings: { original, scanned } }
```

## Required content is asked separately

`auditPages` compares a returned copy with the one that was issued. Whether the issued copy says what it was *supposed* to say is a different question, and no comparison of two copies can answer it - issue a different form, return a faithful scan of it, and every check here passes. Ask `@scanmate/find` directly, of the reading this returns:

```ts
import { findContent } from '@scanmate/find'

const found = findContent(audit.pages[0].text, [{ page: 1, content: ['Account 4412-9087-3355'] }])
```

## Options

| Option | Default | |
|---|---|---|
| `expected` | none | Regions where a change is expected, in points (`resolveRegions` in `@scanmate/find` builds them from anchors). |
| `ocr` | `@scanmate/ocr` defaults | Engine, languages and cache, the recheck, thresholds. Pass `ocr.engine` to share one engine across audits. |
| `diff` | `@scanmate/diff` defaults | Tolerances, minimum areas, form-line handling. Rectangles are always in points. |
| `settle` | `quorum: 2`, three passes | How a disagreement between the reading and the pixels is settled. |
| `minTextScore` | `0.85` | Below this, a page's text is too unreliable for it to pass. |
| `output` | `'png'` | Encoding of the evidence image and the pixel overlay; `'none'` keeps only rasters. |
| `onProgress` | none | Receives `ocr`, `diff` and `audit` stage events. |

## How it decides

[`documentation/algorithms.md`](./documentation/algorithms.md) has the algorithms in full: what each step measures, the decision flows, every constant with the measurement behind it, and what the package deliberately does not do.
