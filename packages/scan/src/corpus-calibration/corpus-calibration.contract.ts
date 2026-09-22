import type { AuditReport } from '../page-audit'
import type { CalibrationGrid, CalibrationLabel, CalibrationReport, CalibrationSample } from '../audit-calibration'
import type { ExpectedChange } from '../change-detection'
import type { ReadablePage } from '@scanmate/ink'

import type { ScanmateDocument } from '../document-input'
import type { ScanmateOptions } from '../session-contract'

/** One document in a labelled corpus: what was issued, what came back, and what it is known to be. */
export interface CalibrationCase extends CalibrationLabel {
  original:  ScanmateDocument
  scanned:   ScanmateDocument
  /** This document's own expected regions, when they differ from the options'. */
  expected?: readonly ExpectedChange[]
  /**
   * Settings for this document alone, over the run's: which pages to take, a
   * resolution, a different tolerance. Each stage's bag is merged with the
   * run's rather than replacing it, so naming one option keeps the rest.
   *
   * A corpus is rarely uniform - documents differ in length, in resolution, in
   * which page carries the signature - and a case that could not say so would
   * have to be audited in a run of its own, with its own engine.
   */
  options?:  Omit<ScanmateOptions, 'engine' | 'onProgress'>
}

export interface CalibrateOptions extends ScanmateOptions {
  /** The thresholds to try. Default: the audit's own, and a few steps either side. */
  grid?:   CalibrationGrid
  /**
   * Called as each document is done, with its sample - to save as you go, so a
   * run of hours that stops at document 40 does not have to start again.
   */
  onCase?: (done: { index: number, id: string, sample: CalibrationSample }) => void | Promise<void>
}

export interface CorpusCalibration {
  /** One per document, in the corpus's order. Plain data: save them and sweep again with `calibrateAudit`. */
  samples: CalibrationSample[]
  report:  CalibrationReport
}

/** What `calibrateCorpus` needs from a session, so it can run without importing the class that calls it. */
export interface AuditingSession {
  audit:   () => Promise<AuditReport<ReadablePage>>
  dispose: () => Promise<void>
}
