![scanmate scan](./assets/scanmate-scan.svg)

# `@scanmate/scan`

One class over the whole pipeline: hand it the document you issued and the one that came back, and ask it questions.

![one session: the scan as it came, aligned, enhanced, and the overlay](./assets/stages.jpg)

*One page through one session, top to bottom: the returned scan as it arrived - crooked and offset - then put back on the original's canvas, then cleaned for reading, then the overlay of the two, violet where the ink differs. Made from the [IRS Form W-9](https://www.irs.gov/pub/irs-pdf/fw9.pdf) (a work of the United States government, in the public domain): filled in as a generator would, printed, signed by hand and scanned crooked.*

```bash
npm install @scanmate/scan
```

```ts
import { Scanmate } from '@scanmate/scan'

const scan = new Scanmate('fw9-issued.pdf', 'fw9-returned.pdf', {
  // The W-9's signature row, measured off the form in points from the page's top-left.
  expected: [
    { page: 1, id: 'signature', x: 120, y: 577, width: 262, height: 22 },
    { page: 1, id: 'date',      x: 404, y: 577, width: 171, height: 22 },
  ],
})

const report = await scan.audit()
report.verdict                     // 'pass' | 'review'
report.pages[0].audit.reasons      // why, one sentence each
report.pages[0].audit.evidenceImage   // original, scan and overlay, findings drawn
report.pages[0].aligned.raster     // the page itself is still there

await scan.dispose()
```

## What it does for you

**Every method runs what it needs.** `diff()` on a fresh session extracts and aligns first. Each stage is remembered, so the next question costs only the new work, and asking the same one twice costs nothing:

```ts
await scan.align()      // extracts, then aligns
await scan.diff()       // reuses the alignment
await scan.align()      // free
```

Change an option and that stage runs again, dropping whatever was computed from its old answer. Per-call options merge over the constructor's, which is handy for trying something:

```ts
await scan.align({ model: 'homography' })   // realigns, and the old diff is dropped
```

**One OCR engine for the session.** `ocrPages` and `auditPages` each start a tesseract worker when they are not given one, and a language model is tens of megabytes into a fresh WASM heap. The session makes one, hands it to every stage that reads, and terminates it in `dispose()` - and never terminates an engine you supplied yourself.

**Nothing loads until it is used.** The stages are pulled in with dynamic imports, so a session that only aligns never evaluates tesseract, never reads a language model, never loads a PDF library:

```
two images in, align only  ->  @scanmate/scan, @scanmate/ink, @scanmate/align, sharp
```

That is measured, not asserted: a test spawns a child process with a module hook that logs every specifier Node resolves, and fails if any of the other stages appear.

`sharp` is the floor. Every stage stands on `@scanmate/ink`, which loads libvips when it loads, so there is no pure-JavaScript path.

## The methods

| method | returns | consumes |
|---|---|---|
| `pages(options?)` | page pairs | the constructor's inputs |
| `align(options?)` | the scan on the original's canvas | `pages` |
| `enhance(options?)` | a cleaned copy alongside | `align` - **never implicit** |
| `ocr(options?)` | how closely the text matches | `enhance` if it ran, else `align` |
| `diff(expected?, options?)` | what changed, and whether it should have | `align` |
| `find(content?, options?)` | whether required content is there | `ocr` |
| `audit(options?)` | the verdict, with its evidence | `enhance` if it ran, else `align` |
| `report()` | everything known, joined by page | whatever has run |
| `dispose()` | — | — |

Results are also readable **synchronously**, as `undefined` until the stage has settled. They never start work:

```ts
scan.alignedPages      // undefined until align() has finished
scan.unpaired          // pages the scan lost, which nothing downstream reports
scan.mergedPdf         // the merged bytes, when a side was given as an array
scan.loaded            // which stage packages have loaded
```

## Inputs

Either side may be a path, a `URL`, bytes, a decoded raster - or an **array** of those, which is merged into one PDF first. That is how a returned document usually arrives: eight photographs of a signed contract.

```ts
new Scanmate('fw9-issued.pdf', ['page-1.jpg', 'page-2.jpg', 'page-3.jpg'])
```

Whether a side is a PDF is decided by its first five bytes, not its file extension. Two images never open a PDF library at all.

One caveat worth knowing: `dpi: 'match'` - rendering both sides at the scan's own measured resolution, which is what makes them directly comparable - needs both sides to be documents. Give it a PDF against a photograph and it renders at the original's resolution instead, and says so in `scan.warning`.

## Two orderings worth knowing

**Audit first is cheaper.** `auditPages` runs the reading and the pixel comparison itself and keeps both on its report, so the session hands them back rather than computing them twice:

```ts
await scan.audit()     // reads and compares
await scan.ocr()       // free
await scan.diff()      // free
```

The reverse order still pays twice. That is a gap in `auditPages` - it has no way to accept a reading it was already given - and closing it in this class would mean forking the verdict logic, which is worse.

One exception: audit runs its diff with no side-by-side and drops the masks, so `diff({ sideBySide: true })` after an audit genuinely re-runs rather than handing you a `null` where you asked for a picture.

## Memory

Remembering every stage is the point of the class and also its largest risk. A twenty-page A4 pair at 300 dpi holds the original, the scan, the alignment, perhaps an enhanced copy, the overlay and the evidence page - four bytes a pixel each, several gigabytes before anything has gone wrong.

So: **`Scanmate` is a short-lived per-document object, not a service singleton.** One per document, `dispose()` when done. A long-lived instance in a request handler is a leak.

## This is the convenient door, not the only one

Every stage is still its own package and still worth using directly - `alignPages`, `diffPages`, `ocrPages`, `auditPages` and the rest take plain arguments and return plain results. Reach for this class when you want the pipeline; reach for a stage when you want that stage.

## How it decides

The stages make the decisions; this package only sequences them - and each documents its own reasoning, with the measurements behind every constant, in its own `documentation/algorithms.md`.

[`documentation/algorithms.md`](./documentation/algorithms.md) covers the sequencing itself: what runs in what order, what is remembered and when it is dropped, exactly what loads for a given call, how one OCR engine is shared, and why an audit makes the next three questions free.
