import type { AuditOptions, PageAudit } from '@scanmate/audit'
import type { AlignPagesOptions, AlignResult } from '@scanmate/align'
import type { DiffOptions, ExpectedChange, PageDiff } from '@scanmate/diff'
import type { EnhancePagesOptions, EnhancedImage } from '@scanmate/enhance'
import type { ExtractPairOptions } from '@scanmate/extract'
import type { ExpectedContent, FindOptions, PageFind } from '@scanmate/find'
import type { AlignedPage, ProgressCallback } from '@scanmate/ink'
import type { MergeOptions } from '@scanmate/merge'
import type { OcrEngine, OcrOptions, PageOcr } from '@scanmate/ocr'

import type { ScanmatePage } from '../document-input'

/** A page pair with the scan put back on the original's canvas. */
export type AlignedScanmatePage = ScanmatePage & AlignedPage<AlignResult>

/** ...and with a cleaned copy alongside. */
export type EnhancedScanmatePage = AlignedScanmatePage & { enhanced: EnhancedImage }

/**
 * Whichever page set a reader works on.
 *
 * Both satisfy `ReadablePage`, which is what lets `ocr()` and `audit()` take
 * either without a cast - and what lets a caller enhance before or after
 * aligning and have the types still line up.
 */
export type ReadableScanmatePage = AlignedScanmatePage & { enhanced?: EnhancedImage }

/**
 * How much of each stage's pixels to keep once a later stage has consumed them.
 *
 * Memoising is the point of this class and also its largest risk: a twenty-page
 * A4 pair at 300 dpi holds the original, the scan, the alignment, perhaps an
 * enhanced copy, the overlay and the evidence page, each four bytes a pixel -
 * several gigabytes before anything has gone wrong.
 *
 * `'all'` keeps everything, which is right for one page and for exploring.
 * `'reports'` drops rasters a downstream stage has already read, keeping the
 * numbers, the boxes and the encoded images. Use it for anything long.
 */
export type KeepPolicy = 'all' | 'reports'

export interface ScanmateOptions {
  /** Regions where a change is expected. The default for `diff()` and `audit()`. */
  expected?:   readonly ExpectedChange[]
  /** Content that must be present. The default for `find()`. */
  content?:    readonly ExpectedContent[]
  /** Every stage's events, on one callback. Never part of a stage's fingerprint. */
  onProgress?: ProgressCallback
  /** An engine to use and leave running. A session never terminates one it did not create. */
  engine?:     OcrEngine
  /** How much pixel data to keep between stages. Default `'all'`. */
  keep?:       KeepPolicy

  merge?:   Omit<MergeOptions, 'onProgress'>
  extract?: Omit<ExtractPairOptions, 'onProgress'>
  align?:   Omit<AlignPagesOptions, 'onProgress'>
  enhance?: Omit<EnhancePagesOptions, 'onProgress'>
  ocr?:     Omit<OcrOptions, 'onProgress' | 'engine'>
  diff?:    Omit<DiffOptions, 'onProgress'>
  find?:    FindOptions
  audit?:   Omit<AuditOptions, 'onProgress' | 'expected' | 'ocr' | 'diff'>
}

/** Everything the session knows about one page, joined by page number. */
export interface ScanmatePageReport {
  page:    number
  aligned: AlignedScanmatePage
  text?:   PageOcr
  diff?:   PageDiff
  find?:   PageFind
  audit?:  PageAudit
}
