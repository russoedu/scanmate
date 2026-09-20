import type { ScanmateOrientedRect } from '../plane-geometry'

/**
 * A run of text somewhere on a page.
 *
 * Three shapes used to say this - one from the PDF text layer, two inside the
 * reader - and they differed only in which fields they made optional. That
 * cost more than tidiness: the reader's shape had no `angle`, so a third shape
 * had to be invented the moment printed runs turned sideways needed checking.
 *
 * One shape now, with everything past the box optional, because a PDF's text
 * layer knows more about a run than OCR ever will. A producer that knows a
 * field fills it; a consumer that needs one says so.
 */
export interface TextRun extends ScanmateOrientedRect {
  /** What the run says. */
  text:      string
  /** Where the run's baseline starts, when the producer knows it. */
  baseline?: { x: number, y: number }
  /** Size of the font as placed, in points. */
  fontSize?: number
  /** Stable within a document: runs that share it share a face. */
  fontName?: string
  /** The run ends a line. */
  endsLine?: boolean
}

/**
 * A run read off a PDF's own text layer: exact, and everything is known.
 *
 * This is what `@scanmate/extract` reports and what the glyph checks rely on -
 * a face, a size and an angle are what let a printed figure be matched against
 * the other glyphs the page prints in the same face.
 *
 * Positions are PDF points (1/72 inch) from the top-left corner of the page as
 * displayed - after its `/Rotate` - which is the frame a rendered page is in,
 * and the one `@scanmate/diff` takes regions in. Multiply by `dpi / 72` for
 * pixels of a page rendered at `dpi`.
 */
export type PdfTextRun = Required<TextRun>
