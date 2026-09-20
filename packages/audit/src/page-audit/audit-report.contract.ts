import type { DiffOptions, ExpectedChange, PageDiff } from '@scanmate/diff'
import type { ImageFormat, ProgressCallback, Raster, ReadablePage } from '@scanmate/ink'
import type { OcrOptions, PageOcr, TextDifference } from '@scanmate/ocr'

import type { Settlement, SettlementInput } from '../dispute-settlement'
import type { AuditFinding, ExplainedDifference, FindingKind } from '../finding-correlation'

export interface AuditOptions {
  /** Regions where a change is expected - a signature box, a tick box - in points from the top-left. */
  expected?:     readonly ExpectedChange[]
  /** Options for the full reading. The text layer, the recheck and the engine are `@scanmate/ocr`'s. */
  ocr?:          Omit<OcrOptions, 'onProgress'>
  /** Options for the pixel comparison. Rectangles are always in points, so the two comparisons line up. */
  diff?:         Omit<DiffOptions, 'onProgress' | 'units' | 'output' | 'sideBySide'>
  /** How a disagreement between the reading and the pixels is settled. */
  settle?:       Omit<SettlementInput, 'differences' | 'probes' | 'original' | 'scanned' | 'engine' | 'rules'>
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
  /** How each disputed difference was settled, and what each re-read said. */
  settled:        Settlement[]
  /** The original, the aligned scan and the overlay, with the findings drawn. */
  evidenceRaster: Raster
  evidenceImage:  Uint8Array | null
}

/** A page with the verdict on it, and the evidence behind it. */
export type AuditedPage<Page extends ReadablePage = ReadablePage> = Page & { audit: PageAudit }

export interface AuditReport<Page extends ReadablePage = ReadablePage> {
  /** `pass` only when every page passes. */
  verdict:   Verdict
  /** The document's text score, weighted by characters. */
  textScore: number
  /** The pages handed in, each carrying its own verdict as `page.audit`. */
  pages:     Array<AuditedPage<Page>>
  summary: {
    pages:        number
    passed:       number
    /** Findings of each kind across the document. */
    findings:     Partial<Record<FindingKind, number>>
    /** Findings both comparisons saw. */
    corroborated: number
  }
}
