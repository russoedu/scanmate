# The content search

*Part of [`@scanmate/scan`](../README.md). Before 0.18.0 this was the separate package the content search, now deprecated.*

Checks whether the content that must be on each page is there, and whether it's where the original puts it.

## Install

```bash
npm install @scanmate/scan @scanmate/ocr
```

```ts
import { ocrPages } from '@scanmate/ocr'
import { findContent } from '@scanmate/scan'

const report = await ocrPages(alignedPages)
// The reading hands its pages back, and the search takes them straight.
const found = findContent(report.pages, [
  { page: 1, content: ['Vector Supply Company, Inc.', 'Account 4412-9087-3355'] },
])

found.allFound                    // every item present on its page
found.allIdentifiable             // every item present where the original prints it
found.pages[0].find.content[1]    // { found, identifiable, foundBy, score, excerpt, box, occurrences, foundOnPages }
found.warnings                    // content expected on a page that was not given
```

## How it decides

1. **Where the original prints it.** The content is located in the original's text, which is exact, at every place it occurs.
2. **Whether the scan reads it there.** At each of those places, the scan's reading (as `@scanmate/ocr` read it, including its recheck) is searched for the content. If it's found at every place, the content is **identifiable**. If an amount is printed twice and one copy was altered, it's still found, because the other copy is genuine, but it isn't identifiable, and `occurrences` shows which copy changed.
3. **Otherwise, anywhere on the page.** Content that moved, or that the original never printed (a handwritten note, for example), is found `on-page`.
4. **Which pages.** Every page of the scan is searched, so `foundOnPages` shows a clause that moved to another page.

The search is approximate (Sellers' algorithm), so OCR's slips in words are forgiven, up to `minScore` (0.85). Two things are never forgiven:

- **Figures:** a match must carry exactly the same digits, and can't run into further digits, so `1,250.00` isn't found inside `11,250.00`.
- **Lone letters:** "Schedule A" isn't "Schedule B".

On two real scans of an order form (120 and 144 dpi), every one of 7 amounts with a single digit forged was reported as not identifiable. On the unaltered 144-dpi scan, every required value was found in place.

## Field regions moved to `@scanmate/extract`

Placing field boxes from the labels a document prints used to live here, as `resolveRegions`. It reads only the original's text layer and never a scan, so it now lives with that text layer in `@scanmate/extract`, as `locateFields` - with labels that wrap across lines, whole-word matching, every page searched at once, and page numbers on the regions it returns. Reaching it there no longer loads the OCR engine.

## How it decides

[`content-search.md`](./content-search.md) has the algorithms in full: what each step measures, the decision flows, every constant with the measurement behind it, and what the package deliberately does not do.
