import type { ProgressCallback } from '@scanmate/ink'

import type { PageSize } from '../page-placement'
import type { SourceKind } from '../source-reading'

export interface MergeOptions {
  /**
   * Opens an encrypted PDF source that needs a password to be read. The usual
   * encrypted PDF - a signed or permission-restricted document, locked with an
   * owner password alone - needs none and is decrypted as it is copied. The
   * same password is tried on every encrypted source.
   */
  password?:    string
  /** Size of each image page: the image at its resolution (`'image'`, the default), or a paper size to fit it in. */
  pageSize?:    PageSize
  /** Points of white kept around an image on a paper-size page. Default `0`. */
  margin?:      number
  /** Resolution for an image that does not say, or says 72 or 96. Default `150`. */
  imageDpi?:    number
  /**
   * How to encode an image that cannot be embedded as it is - any format but
   * JPEG and PNG, a JPEG that needs its EXIF rotation applied, a raster.
   * `'png'` (the default) is lossless: a scan should not gain compression
   * artefacts on its way into evidence. `'jpeg'` is a fraction of the size.
   */
  encoding?:    'png' | 'jpeg'
  /** JPEG quality, 1-100, when `encoding` is `'jpeg'`. Default `92`. */
  quality?:     number
  /**
   * A single PDF on its own comes back byte for byte - stored exactly as
   * scanned, signatures and all. Default `true`. Setting `metadata` turns it
   * off, since that means writing a new file.
   */
  passThrough?: boolean
  /** Information dictionary for the merged file. The producer is always `@scanmate/merge`. */
  metadata?:    { title?: string, author?: string, subject?: string, keywords?: string[], creator?: string }
  onProgress?:  ProgressCallback
}

/** How a page got into the merged file. */
export type Embedding = 'pdf-page' | 'jpeg' | 'png' | 'encoded-png' | 'encoded-jpeg'

export interface MergedPage {
  /** One-based, in the merged file. */
  page:       number
  /** One-based position of the source it came from, in the list given. */
  source:     number
  /** One-based page within that source - above one for a PDF or a multi-page TIFF. */
  sourcePage: number
  kind:       SourceKind
  /**
   * `'jpeg'` is the source's own bytes and `'png'` its pixels, losslessly; the
   * `encoded-` ones were decoded and encoded again.
   */
  embedding:  Embedding
  /** Page size in points. */
  width:      number
  height:     number
  /** Resolution the image was placed at; `null` for a PDF page. */
  dpi:        number | null
}

export interface MergeResult {
  pdf:           Uint8Array
  pageCount:     number
  pages:         MergedPage[]
  /** The single PDF given was returned unchanged. */
  passedThrough: boolean
}
