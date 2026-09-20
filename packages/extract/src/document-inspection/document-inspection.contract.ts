import type { ScanmateRect } from '@scanmate/ink'

import type { PageSelection } from '../page-extraction'
import type { PageMetadata } from '../page-inspection'

export interface InspectOptions {
  /** Pages to inspect: `[1, 3]` or `'1-3,5,8-'`. Default all. The count is always the whole document's. */
  pages?:    PageSelection
  /**
   * Also read each page's text layer and operator list - kind, text, text items,
   * embedded images, effective dpi. Still renders nothing, but parses every
   * content stream, so it costs what extraction costs minus the drawing. Default
   * `false`: geometry only, which is read from the page dictionaries alone.
   */
  metadata?: boolean
}

/** A page's geometry, as its dictionary states it. */
export interface InspectedPage {
  /** One-based. */
  page:          number
  /** Size in points before rotation - the page's own box. */
  pointWidth:    number
  pointHeight:   number
  /** Clockwise rotation the page asks to be displayed at. */
  rotation:      0 | 90 | 180 | 270
  /** Size in points as displayed, after rotation: what a render's aspect ratio will be. */
  displayWidth:  number
  displayHeight: number
  /** The visible box in points, as pdf.js resolves it (the crop box, within the media box). */
  box:           ScanmateRect
  /** The full metadata, when asked for; otherwise `null`. */
  metadata:      PageMetadata | null
}

/** The document information dictionary, where the producer set one. */
export interface DocumentInfo {
  title:            string | null
  author:           string | null
  subject:          string | null
  /** The application that made the original - a word processor, a report generator. */
  creator:          string | null
  /** The application that wrote the PDF - often the scanner's or the PDF library's name. */
  producer:         string | null
  /** PDF version from the file header, e.g. `'1.7'`. */
  pdfVersion:       string | null
  /** As written in the file, e.g. `D:20260917120000Z`. */
  creationDate:     string | null
  modificationDate: string | null
}

export interface DocumentInspection {
  /** Pages in the whole document, whichever were inspected. */
  pageCount:  number
  /** Size of the source, in bytes. */
  byteLength: number
  info:       DocumentInfo
  pages:      InspectedPage[]
}
