import type { DiffOptions, ExpectedChange, PageDiff } from '@scanmate/diff'
import type { ContentResult, ExpectedContent, FindOptions } from '@scanmate/find'
import type { ImageFormat, ProgressCallback, Raster } from '@scanmate/ink'
import type { OcrOptions, PageOcr, TextDifference } from '@scanmate/ocr'

import type { AuditFinding, ExplainedDifference, FindingKind } from '../finding-correlation'

export interface AuditOptions {
  /** Regions where a change is expected - a signature box, a tick box - in points from the top-left. */
  expected?:     readonly ExpectedChange[]
  /** Content that must be on each page, checked with `@scanmate/find`. */
  content?:      readonly ExpectedContent[]
  /** Options for the full reading. The text layer, the recheck and the engine are `@scanmate/ocr`'s. */
  ocr?:          Omit<OcrOptions, 'onProgress'>
  /** Options for the pixel comparison. Rectangles are always in points, so the two comparisons line up. */
  diff?:         Omit<DiffOptions, 'onProgress' | 'units' | 'output' | 'sideBySide'>
  find?:         FindOptions
  /**
   * A page whose text score falls below this is too unreliable to pass on the
   * findings alone: at low resolution OCR misses changes it should see.
   * Default `0.85`.
   */
  minTextScore?: number
  /** Encoding of the evidence image and of the pixel overlay. `'none'` keeps only rasters. Default `'png'`. */
  output?:       ImageFormat | 'none'
  onProgress?:   ProgressCallback
}

/** `pass`: nothing for anyone to look at. `review`: see `reasons`. */
export type Verdict = 'pass' | 'review'

export interface PageAudit {
  page:           number
  verdict:        Verdict
  /** Why the page needs review, one sentence each; empty on a pass. */
  reasons:        string[]
  /** Everything to look at, text and pixels together. */
  findings:       AuditFinding[]
  /** Reading differences the ink says are not differences: identical print, read wrong. */
  noise:          TextDifference[]
  /** Text differences accounted for by an expected region - kept for transparency, not counted. */
  explained:      ExplainedDifference[]
  /** The full reading of the page: both texts, every measure, every run. */
  text:           PageOcr
  /** The full pixel comparison: expected regions, unexpected and missing ink, the overlay. */
  pixels:         PageDiff
  /** Required content checked on this page. */
  content:        ContentResult[]
  /** The original and the aligned scan side by side, with the findings drawn on both. */
  evidenceRaster: Raster
  evidenceImage:  Uint8Array | null
}

export interface AuditReport {
  /** `pass` only when every page passes. */
  verdict:   Verdict
  /** The document's text score, weighted by characters. */
  textScore: number
  pages:     PageAudit[]
  summary: {
    pages:        number
    passed:       number
    /** Findings of each kind across the document. */
    findings:     Partial<Record<FindingKind, number>>
    /** Findings both comparisons saw. */
    corroborated: number
  }
}
