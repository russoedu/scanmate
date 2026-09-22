import type { FindingKind } from '../finding-correlation'

/** One page of an audit, as the evidence cover lists it. */
export interface SummarisedPage {
  page:       number
  verdict:    'pass' | 'review'
  reasons:    string[]
  textScore:  number
  /** Characters the page's text score was measured over: what a document's score is weighted by. */
  characters: number
}

/**
 * An audit reduced to what its evidence cover says - no pixels, no readings.
 *
 * Small and plain, so a long document audited a batch at a time can keep one
 * per batch, join them with `combineSummaries`, and have one cover written for
 * the whole of it.
 */
export interface EvidenceSummary {
  /** `pass` only when every page passes. */
  verdict:      'pass' | 'review'
  /** The document's text score, weighted by characters. */
  textScore:    number
  findings:     Partial<Record<FindingKind, number>>
  /** Findings both the reading and the pixel comparison saw. */
  corroborated: number
  pages:        SummarisedPage[]
}
