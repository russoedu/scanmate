import type { ScanmateRect } from '@scanmate/ink'
import type { NormaliseOptions } from '@scanmate/ocr'

/** Text that must be on a page of the returned document - the brief's `{ page, content }`. */
export interface ExpectedContent {
  /** One-based page number in the original. */
  page:    number
  content: readonly string[]
}

export interface FindOptions {
  /** Least similarity for a match, 0-1. Default `0.85`; figures must match their digits exactly whatever this is. */
  minScore?:  number
  /** Normalisation, the same as `@scanmate/ocr` applied - default its own. */
  normalise?: NormaliseOptions
}

/**
 * - `in-place`: found where the original prints it, the scan's reading of that
 *   place agreeing.
 * - `on-page`: found in the scan's text of the page, but not where the original
 *   puts it, or the original does not print it at all.
 * - `none`: not found on the page.
 */
export type FoundBy = 'in-place' | 'on-page' | 'none'

/** One place the original prints the content, and whether the scan reads it there. */
export interface Occurrence {
  /** Where, in points from the top-left. */
  box:     ScanmateRect
  /** The scan's reading of that place contains it. */
  intact:  boolean
  /** That reading, widened to whole words, when intact. */
  excerpt: string | null
}

export interface ContentResult {
  content:           string
  /** Present on the scanned page. */
  found:             boolean
  /**
   * Present at every place the original prints it - the strongest evidence
   * there is. An amount printed twice, altered once, is still found (the other
   * copy is genuine) but not identifiable.
   */
  identifiable:      boolean
  foundBy:           FoundBy
  /** Similarity of the best match on the page, 0-1; `0` when even figures could not be matched. */
  score:             number
  /** The scan's text that matched, widened to whole words; `null` when nothing did. */
  excerpt:           string | null
  /** The original prints it on this page. */
  printedInOriginal: boolean
  /** Where the original first prints it, in points from the top-left; `null` when it does not. */
  box:               ScanmateRect | null
  /** Every place the original prints it, in page order, each checked in the scan. */
  occurrences:       Occurrence[]
  /** Every page of the scan whose text contains it - one other than `page` means pages moved. */
  foundOnPages:      number[]
}

export interface PageFind {
  page:     number
  content:  ContentResult[]
  allFound: boolean
  /** Why a page could not be searched: it was not in the OCR report. */
  warnings: string[]
}

export interface FindReport {
  /** Every expected content was found on its page. */
  allFound:        boolean
  /** Every expected content was found where the original prints it. */
  allIdentifiable: boolean
  pages:           PageFind[]
}
