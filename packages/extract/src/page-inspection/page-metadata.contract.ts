import type { PdfTextRun, ScanmateRect } from '@scanmate/ink'

/**
 * What a PDF page says about itself, without anything being rendered.
 *
 * Every field is here because a later stage uses it: `kind` and `effectiveDpi`
 * decide how to render, `text` gives `@scanmate/ocr` ground truth for a
 * born-digital original, and `embeddedImages` is the evidence behind both.
 */

/**
 * - `vector` - born-digital: text and drawing operators, perhaps a logo.
 * - `scanned` - one bitmap covering the page, and no text: a scan.
 * - `scanned-with-text-layer` - a scan with an OCR layer on top, as many scanners produce.
 * - `empty` - nothing to read at all.
 */
export type PageKind = 'vector' | 'scanned' | 'scanned-with-text-layer' | 'empty'

/** One bitmap painted on the page. */
export interface EmbeddedImage {
  /** Intrinsic pixel size of the image as stored. */
  width:        number
  height:       number
  /** Size it is painted at, in PDF points (1/72 inch). */
  placedWidth:  number
  placedHeight: number
  /** Pixels per inch as painted, per axis. */
  dpiX:         number
  dpiY:         number
  /**
   * `mask` for a one-bit stencil - how bi-level fax-style scans are usually
   * stored - otherwise what pdf.js decoded it to. `null` when pdf.js had not
   * resolved the image; this reaches into pdf.js internals, so it is best-effort.
   */
  colorKind:    'mask' | 'gray-1bpp' | 'rgb-24bpp' | 'rgba-32bpp' | null
}

export interface PageMetadata {
  /** One-based. */
  page:           number
  /** Page size in PDF points (1/72 inch), before rotation. */
  pointWidth:     number
  pointHeight:    number
  /** Clockwise rotation the page asks to be displayed at. Rendering applies it. */
  rotation:       0 | 90 | 180 | 270
  /** The page's MediaBox, in points. */
  mediaBox:       ScanmateRect
  kind:           PageKind
  /**
   * Fraction of the page area covered by painted bitmaps, in `[0, 1]`.
   *
   * This, not the number of images, is what separates a scan from a document
   * with a letterhead logo: measured on a real born-digital order form, the logo
   * covers 1.2% of the page; every page of its scans, 100%.
   */
  imageCoverage:  number
  hasTextLayer:   boolean
  /** The page's own text, with line ends as newlines, or `null` when there is none. */
  text:           string | null
  /**
   * Every run of the text layer, placed on the page as displayed, in points from
   * the top-left. Empty when there is no text layer. Where a value was printed -
   * a total, a signature label - is what regions and searches are built from.
   */
  textItems:      PdfTextRun[]
  characterCount: number
  embeddedImages: EmbeddedImage[]
  /**
   * The page's real resolution when it is a scan: the covering bitmap's pixels
   * over the page's inches. `null` for anything that is not a scan, because a
   * logo's resolution says nothing about the page.
   */
  effectiveDpi:   number | null
}
