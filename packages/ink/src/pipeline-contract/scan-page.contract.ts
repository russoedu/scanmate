import type { Matrix3 } from '../plane-geometry'
import type { Raster } from '../raster-codec'
import type { TextRun } from './text-run.contract'

/**
 * The shapes the pipeline stages hand one another.
 *
 * They live here rather than beside whichever stage produces them so that no
 * stage has to import another to accept its output: `@scanmate/align` accepts
 * what `@scanmate/extract` produces without depending on it, and `diff` and `ocr`
 * accept what `align` produces the same way. Each stage consumes the previous
 * one's output structurally, which is what lets an orchestrator later be a plain
 * pipe rather than a layer of adapters.
 */

/** One side of a page pair: the pixels, and what the producer knew about them. */
export interface PageImage {
  raster: Raster
  /** `raster` encoded, or `null` when the producer skipped encoding. */
  image:  Uint8Array | null
  width:  number
  height: number
  /** Resolution the raster was produced at, or `null` when nothing said - a bare image file. */
  dpi:    number | null
}

/** A page of the original and the matching page of what came back. */
export interface ScanPage {
  /** One-based page number in the original. */
  page:     number
  original: PageImage
  scanned:  PageImage
}

/**
 * What a downstream stage needs from an alignment.
 *
 * `@scanmate/align`'s `AlignResult` carries this and a good deal more; any
 * stage that only needs the aligned pixels and the transform asks for this, so
 * it stays independent of the aligner that produced them.
 */
export interface AlignedImage extends PageImage {
  /** Maps original coordinates to scanned coordinates. */
  matrix:     Matrix3
  /** Maps scanned coordinates back to original coordinates. */
  inverse:    Matrix3
  /** How far to trust the alignment, in `[0, 1]`. */
  confidence: number
}

/** A {@link ScanPage} with the scan put back on the original's canvas. */
export interface AlignedPage<Aligned extends AlignedImage = AlignedImage> extends ScanPage {
  aligned: Aligned
}

/**
 * A page a reader can work on: aligned, optionally cleaned, and optionally
 * carrying the original's own text layer.
 *
 * Only the original's text layer is ever used. A scan's own text layer is
 * ignored, deliberately - hidden or stale text must not vouch for what the
 * paper shows.
 */
export type ReadablePage = AlignedPage & {
  enhanced?: PageImage
  metadata?: { original?: { textItems?: readonly TextRun[] | null } }
}
