import type { ScanmateRect } from '../plane-geometry'
import type { Bleed } from '../region-bleed'

/**
 * A named rectangle on a named page of the original: where a field is.
 *
 * In points, from the top-left of the page as displayed - the coordinates
 * `@scanmate/extract` reports text in, with the page's rotation and crop box
 * already applied.
 *
 * One shape for the whole journey a field makes: located from its label by
 * `@scanmate/extract`, drawn on the original by `@scanmate/merge` to be checked
 * by eye, and measured as an expected change by the pixel comparison and
 * The audit. Each hands it to the next as it is, so there is nothing to
 * convert between them and no place for a field to move on the way.
 *
 * A region may carry its own bleed - `bleed`, or a side of it - which wins
 * over the bleed the comparison or the marking was given. A signature box can
 * ask for twenty points below while the date beside it keeps the default.
 */
export interface PageRegion extends ScanmateRect, Bleed {
  /** One-based page number in the original. */
  page: number
  /** What the field is - `'signature'`, `'date'` - unique among the regions of one document. */
  id:   string
}
