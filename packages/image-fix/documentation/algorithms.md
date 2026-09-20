# `@scanmate/image-fix` — where the algorithms went

This package is **deprecated**. It was the first version of all of this: one
package that aligned a scan onto a page and reported which known rectangles had
gained ink. It is kept so existing installs keep working, and it now re-exports
the packages that replaced it.

Every algorithm it used to carry is documented where it now lives:

| what you came for | where it is now |
|---|---|
| ink separation, warps, matrices, correlation | [`@scanmate/ink`](../../ink/documentation/algorithms.md) |
| the coarse estimate, ORB, RANSAC, model choice | [`@scanmate/align`](../../align/documentation/algorithms.md) |
| region comparison, connected components, the overlay | [`@scanmate/diff`](../../diff/documentation/algorithms.md) |

What is new since the split, and only in the new packages:

- pages come from PDFs, paired, and rendered at the scan's own resolution
  ([`@scanmate/extract`](../../extract/documentation/algorithms.md));
- the text is read and compared run by run, and printed figures are matched
  glyph by glyph ([`@scanmate/ocr`](../../ocr/documentation/algorithms.md));
- required content is checked where the document prints it
  ([`@scanmate/find`](../../find/documentation/algorithms.md));
- the reading and the ink are merged into one verdict with its evidence
  ([`@scanmate/audit`](../../audit/documentation/algorithms.md)).

Nothing here is maintained. Move across; the [README](../README.md) maps every
old export to its new home.
