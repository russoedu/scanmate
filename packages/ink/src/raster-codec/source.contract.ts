import type { Raster } from './raster.model'

/**
 * What a stage will take in.
 *
 * Three unions used to say almost this, one per package, and they disagreed for
 * no reason anyone could defend: the image one refused a `URL`, the PDF one
 * refused a decoded raster, and the merge one accepted everything. A caller had
 * to know which stage wanted which, which is exactly the friction a shared
 * contract exists to remove.
 *
 * Two names now. {@link ScanmateBinarySource} is bytes, or where to find them,
 * and is what anything reading a document format asks for. {@link ScanmateSource}
 * adds pixels already in hand, for the stages that work on images.
 */

/**
 * Bytes, or where to find them: a path, a `file:` or `http:` URL, or the bytes
 * themselves.
 */
export type ScanmateBinarySource = string | URL | Uint8Array | ArrayBuffer

/**
 * A decoded image, with whatever is known about the paper it came from.
 *
 * `dpi` sets the page size when the image becomes a PDF page; without it the
 * page is sized by a default. `image` lets an encoder skip re-encoding bytes
 * that are already PNG or JPEG.
 */
export interface ImageWithResolution {
  raster: Raster
  /** Pixels per inch, which sets the page size; `null` or absent when unknown. */
  dpi?:   number | null
  /** The raster already encoded - PNG or JPEG bytes are embedded as they are. */
  image?: Uint8Array | null
}

/**
 * Anything a stage can take in: a file, bytes, or pixels already in hand.
 *
 * A PDF is a {@link ScanmateBinarySource} and nothing more - a raster is not a
 * PDF, and the stages that open documents say so in their signatures.
 */
export type ScanmateSource = ScanmateBinarySource | Raster | ImageWithResolution
