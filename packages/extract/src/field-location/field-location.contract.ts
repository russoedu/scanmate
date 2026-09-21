import type { NormaliseOptions, PageRegion, ScanmateRect, TextRun } from '@scanmate/ink'

/** Where a field sits relative to a corner of its anchor, in points; positive is right and down. */
export interface FieldOffset {
  dx:     number
  dy:     number
  width:  number
  height: number
}

/**
 * Which corner of the anchor the offsets are measured from.
 *
 * A field to the right of its label is best measured from the label's right
 * edge: measured from the left, its position would move whenever the label's
 * wording or type did.
 */
export type AnchorCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

/** One anchor, and the fields placed from it. */
export interface FieldSpec {
  /**
   * The label to find, as the document prints it. It may wrap onto a following
   * line, and may be part of a longer run of text - it is matched word for word,
   * never inside a word, so `'Date'` does not find `'Update'`.
   */
  anchor:      string
  /** The fields, by id. Each id must be unique across every spec. */
  fields:      Readonly<Record<string, FieldOffset>>
  /**
   * `'unique'` (the default): the anchor must occur exactly once in the pages
   * searched, or nothing is placed. A number picks that occurrence, one-based,
   * counted through the document in page order.
   */
  occurrence?: 'unique' | number
  /** Only search this page. By default the whole document is searched. */
  page?:       number
  /** The corner the offsets are measured from. Default `'top-left'`. */
  from?:       AnchorCorner
}

export interface LocateOptions {
  /** How text is made comparable before matching. The suite's default is used when unset. */
  normalise?:     NormaliseOptions
  /** Runs whose tops differ by at most this many points are on one line. Default `2`. */
  lineTolerance?: number
  /**
   * How far below a line the next may start and still continue an anchor, as a
   * share of that line's height. Default `1.8`: a label wrapped onto the next
   * line qualifies, a paragraph further down does not.
   */
  lineSpacing?:   number
}

/** A page's text, and how large the page is as displayed. */
export interface LocatablePage {
  page:      number
  width:     number
  height:    number
  textItems: readonly TextRun[]
}

/** One place an anchor was found. */
export interface AnchorMatch {
  /** The box around the words that spell it, joined across runs and lines. */
  box:       ScanmateRect
  /**
   * Whether an edge of the box was placed by estimate. A run's words are not
   * measured one by one, so where an anchor starts or ends inside a run, that
   * edge is placed in proportion to its characters - close, but only exact
   * where the anchor starts and ends with the runs themselves.
   */
  estimated: boolean
}

/** The anchor a spec settled on. */
export interface LocatedAnchor extends AnchorMatch {
  anchor: string
  page:   number
}

export type LocationProblem = { kind: 'anchor-missing', anchor: string } |
  { kind: 'anchor-ambiguous', anchor: string, occurrences: number } |
  { kind: 'occurrence-missing', anchor: string, occurrence: number, occurrences: number } |
  { kind: 'duplicate-id', id: string } |
  { kind: 'not-finite', id: string, page: number } |
  { kind: 'off-page', id: string, page: number } |
  { kind: 'overlap', ids: [string, string], page: number }

export interface LocatedFields {
  /** Every field placed, ready for `Scanmate.mark` and as an audit's `expected` regions. */
  regions:  PageRegion[]
  /** Where each anchor was found. */
  anchors:  LocatedAnchor[]
  /** Everything wrong. An empty list means the regions can be trusted. */
  problems: LocationProblem[]
}
