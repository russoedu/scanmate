import type { Raster } from '@scanmate/ink'

/**
 * Anything that can become pages of the merged PDF.
 *
 * - a path (`string` or file `URL`) or bytes (`Uint8Array`, `ArrayBuffer`) -
 *   a PDF or any image libvips reads, told apart by content, not by name;
 * - a decoded {@link Raster};
 * - an image with its resolution, `{ raster, dpi }` - which is what every
 *   `PageImage` in the pipeline is, so an aligned or enhanced page goes in as it
 *   is. When it also carries its encoded `image`, those bytes are embedded
 *   rather than encoding the raster again.
 */

/** What a source turned out to be. */
export type SourceKind = 'pdf' | 'image' | 'raster'

/** A source that could not be used, and which one it was. */
export class MergeSourceError extends Error {
  /**
   * @param index - Zero-based position of the source in the list given.
   * @param message - What is wrong with it.
   */
  constructor (readonly index: number, message: string) {
    super(`source ${index + 1}: ${message}`)
    this.name = 'MergeSourceError'
  }
}
