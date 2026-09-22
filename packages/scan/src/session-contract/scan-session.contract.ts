import type { AuditOptions, PageAudit } from '../page-audit'
import type { AlignPagesOptions, AlignResult } from '@scanmate/align'
import type { Checkbox } from '../checkbox-reading'
import type { DiffOptions, ExpectedChange, PageDiff } from '../change-detection'
import type { EnhancePagesOptions, EnhancedImage } from '../scan-enhancement'
import type { ExtractPairOptions } from '@scanmate/extract'
import type { ExpectedContent, FindOptions, PageFind } from '../content-search'
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

/*
 * There is deliberately no `keep` option here.
 *
 * One shipped in 0.2.0 and 0.2.1: typed, exported, and documented as the answer
 * to the memory warning - and read by nothing, so a caller who set it believed
 * they had bounded their memory and had not. An option that is accepted and
 * ignored is worse than one that is absent, so it is gone rather than left
 * standing as a promise.
 *
 * Dropping consumed rasters is not a small change either, and the reason is
 * this suite's own shape: every stage takes pages and hands pages back, so each
 * cached report *carries* the page objects and through them their pixels. The
 * reports and the rasters are not separable the way such an option implies.
 * Freeing them means `PageImage.raster` becoming nullable in `@scanmate/ink`,
 * which every package and every consumer would then have to narrow - including
 * the ones that never asked for it.
 *
 * What bounds memory today is a session per range of pages. See the README.
 */

export interface ScanmateOptions {
  /** Regions where a change is expected. The default for `diff()` and `audit()`. */
  expected?:   readonly ExpectedChange[]
  /** Boxes to read as ticked or not. The default for `checkboxes()` and `audit()`. */
  checkboxes?: readonly Checkbox[]
  /** Content that must be present. The default for `find()`. */
  content?:    readonly ExpectedContent[]
  /** Every stage's events, on one callback. Never part of a stage's fingerprint. */
  onProgress?: ProgressCallback
  /** An engine to use and leave running. A session never terminates one it did not create. */
  engine?:     OcrEngine
  /**
   * How the reading path prepares its pages. `'auto'` (the default) reads one
   * page each way and keeps whichever agreed with the original most; `'none'`
   * reads the aligned pages as they are.
   *
   * Either way it leaves the evidence alone: `diff()` and the glyph check read
   * the aligned page and never this one.
   */
  prepare?:    'auto' | 'none'

  merge?:   Omit<MergeOptions, 'onProgress'>
  extract?: Omit<ExtractPairOptions, 'onProgress'>
  align?:   Omit<AlignPagesOptions, 'onProgress'>
  enhance?: Omit<EnhancePagesOptions, 'onProgress'>
  ocr?:     Omit<OcrOptions, 'onProgress' | 'engine'>
  diff?:    Omit<DiffOptions, 'onProgress'>
  find?:    FindOptions
  audit?:   Omit<AuditOptions, 'onProgress' | 'expected' | 'checkboxes' | 'ocr' | 'diff'>
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
