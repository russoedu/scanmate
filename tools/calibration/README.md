# Calibrating the audit against real documents

The audit's verdict is a decision rule with thresholds in it, and a threshold is
a claim about a corpus: that at this value, altered documents are caught and
genuine ones are not. These two scripts are how that claim gets measured.

They exist because the measurement has to be **repeatable by someone who is not
the person who first ran it**. `packages/scan/documentation/audit.md` records
what the last run found; this records how to run it again, and on another
document.

## Running it

Keep the documents in a folder **outside this repository** - one original PDF
and one or more scans of it:

```bash
node tools/calibration/build-corpus.mjs --documents /path/to/documents
```

```bash
node tools/calibration/run-calibration.mjs
```

The first alters each scanned page three ways and writes a labelled corpus; the
second audits every case once and sweeps the thresholds over what it saw.
`--documents` has no default on purpose. `--original` defaults to `OCF.pdf`, and
every other PDF in the folder is treated as a scan of it.

**Nothing here goes into git**: not the documents, not the corpus, not the
samples. `corpus/` is ignored, and a corpus built somewhere else should stay
somewhere else. The outputs worth keeping are the *numbers*, written up in
`audit.md`.

## The three alterations

Each is made on the **aligned scan itself**, so the paper, the grain, the
lighting and the scanner are identical on both sides of a pair and the only
difference is the alteration. The genuine control is saved by the same path, so
nothing is compared across encodings either.

| | what it is |
|---|---|
| `digit` | One digit in a printed number replaced by another digit cut from the same number - the document's own ink, at its own resolution. The forgery this suite exists to catch. |
| `erased` | A word painted out in the paper's own colour, as correction fluid does. |
| `mark` | A pen stroke added in the margin, 0.4 mm wide whatever the scan's resolution, where the original prints nothing. |

`digit` needs a printed number containing two different digits, so not every
page produces one. That is why 3 scans x 7 pages gives 54 altered documents
rather than 63.

## Audit low, sweep upward

`run-calibration.mjs` audits with `minChangeArea: 0.5` and `minMissingArea: 2`,
below any threshold worth shipping. The pixel comparison reports nothing below
its own thresholds, so a sweep can raise a threshold and know what would have
happened, but can never lower one - it has no record of what it did not report.
Grid values below what the samples ran with are dropped and listed as
unreachable.

## What the last run found

Seventy-five documents, from three scans of one seven-page form at 93, 120 and
144 dpi. **No threshold anywhere on the grid let an altered document pass**, and
every one of the thirteen false reviews was a 93 or 120 dpi page. At 144 dpi the
separation was perfect: seven genuine pages passed with no findings at all, and
all eighteen altered ones were caught by exactly the finding that named what was
done. The full table, the Wilson bounds and what a corpus of one form does *not*
prove are in
[`packages/scan/documentation/audit.md`](../../packages/scan/documentation/audit.md#what-calibration-showed).

The measurement that has not been made: **a second form**. Everything above
holds one document's layout, typeface and paper constant, so the false-accept
bound is a claim about that form. Another form is the next run, and it is the
reason these scripts are here rather than in someone's temp folder.
