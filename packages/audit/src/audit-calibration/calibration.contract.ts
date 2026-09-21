import type { FindingKind } from '../finding-correlation'

/** What a returned document is known to be, by someone who checked it by hand. */
export interface CalibrationLabel {
  /** Names the document in the report: a file name, a case number. */
  id:      string
  /**
   * `true`: the returned document says what was issued, and should pass.
   * `false`: it was altered - a figure changed, a page swapped, a mark added -
   * and must be sent for review.
   */
  genuine: boolean
}

/** One finding, reduced to what a threshold can decide about it. */
export interface SampledFinding {
  kind:    FindingKind
  /** Changed ink, in mm2, for a mark added or ink lost; `null` for anything else. */
  inkArea: number | null
  /** The reading saw something here too. A mark carrying words is never dropped for its size. */
  hasText: boolean
}

export interface SampledPage {
  page:      number
  /** The page's text score, as the audit measured it. */
  textScore: number
  findings:  SampledFinding[]
  /** What the audit decided, at the thresholds it ran with. */
  verdict:   'pass' | 'review'
}

/**
 * One audited document, reduced to what calibration needs: a few numbers per
 * page. Plain data, so a corpus audited once - hours of reading - can be saved
 * as JSON and swept again with other thresholds in milliseconds.
 */
export interface CalibrationSample extends CalibrationLabel {
  pages: SampledPage[]
  /**
   * The area thresholds the audit ran with. A mark smaller than these was never
   * reported, so a sweep can raise them but never lower them.
   */
  floor: { minChangeArea: number, minMissingArea: number }
}

export interface CalibrationThresholds {
  /** A page whose text score falls below this goes to review. */
  minTextScore:   number
  /** Least added ink, in mm2, that sends a page to review. */
  minChangeArea:  number
  /** Least lost ink, in mm2, that sends a page to review. */
  minMissingArea: number
}

/** The values to try for each threshold; every combination is tried. */
export interface CalibrationGrid {
  minTextScore?:   readonly number[]
  minChangeArea?:  readonly number[]
  minMissingArea?: readonly number[]
}

/** How one set of thresholds does on the corpus, counted by document. */
export interface CalibrationPoint {
  thresholds:       CalibrationThresholds
  /** Altered documents these thresholds would pass: the costly mistake. */
  falseAccepts:     string[]
  /** Genuine documents these thresholds would send to review. */
  falseReviews:     string[]
  /** `null` when the corpus has no document of that kind to measure it on. */
  falseAcceptRate:  number | null
  falseReviewRate:  number | null
  /**
   * The most each rate could plausibly be, given how few documents measured it:
   * the upper end of its 95% Wilson interval. No false accept in 20 altered
   * documents still allows 16%; it takes about 75 to bring that under 5%.
   */
  falseAcceptUpper: number | null
  falseReviewUpper: number | null
}

export interface CalibrationReport {
  documents:   { genuine: number, altered: number }
  /** Every combination tried: fewest false accepts first, then fewest false reviews. */
  points:      CalibrationPoint[]
  /**
   * The point with no false accept and the fewest false reviews, or `null` if
   * every point passes some altered document. Chosen on this corpus, so it
   * flatters itself: confirm it on documents it was not chosen on.
   */
  best:        CalibrationPoint | null
  /** Grid values below what some sample's audit ran with, which a sweep cannot reach. */
  unreachable: Partial<CalibrationGrid>
}
