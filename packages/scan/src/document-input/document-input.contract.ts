import type { ScanPage, ScanmateBinarySource, ScanmateSource } from '@scanmate/ink'

/**
 * What a side of the comparison can be: one document, or several things to be
 * assembled into one first.
 *
 * An array is merged into a single PDF before anything else happens. That is
 * the shape a returned document usually arrives in - eight photographs of a
 * signed contract - and making the caller merge them first would defeat the
 * point of a facade.
 */
export type ScanmateDocument = ScanmateBinarySource | readonly ScanmateSource[]

/**
 * A page pair, however it was produced: from two PDFs, or from two images.
 *
 * `metadata` is `null` on a side that was not a PDF, which keeps the shape the
 * same whatever the caller passed - the alternative is a public type that
 * changes with the input, and every consumer branching on it.
 */
export interface ScanmatePage extends ScanPage {
  /** The page this pairs with in the scanned document; equals `page` under index pairing. */
  scannedPage: number
  metadata:    { original: PageMetadataOrNull, scanned: PageMetadataOrNull }
}

/** Whatever the PDF said about itself, or `null` when the side was an image. */
export type PageMetadataOrNull = { [key: string]: unknown } | null

/** What resolving the inputs produced, plus anything the caller may want back. */
export interface ResolvedDocument {
  pages:    ScanmatePage[]
  /** Pages with no partner on the other side. */
  unpaired: { original: number[], scanned: number[] }
  /** The merged PDF for a side that was given as an array, else `null`. */
  merged:   { original: Uint8Array | null, scanned: Uint8Array | null }
  /**
   * Set when the two sides are of different kinds - a PDF against a photograph.
   * `dpi: 'match'` needs both sides to be PDFs, so the pair is rendered at the
   * original's own resolution instead, and the two are not directly comparable
   * in the way a matched pair is.
   */
  warning:  string | null
}

export { type PageImage } from '@scanmate/ink'
