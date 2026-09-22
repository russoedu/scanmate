import type { Bleed, ScanmateRect } from '@scanmate/ink'

/**
 * One region to draw, where the document's own fields are expected to be.
 *
 * In points, from the top-left of the page as displayed - the same coordinates
 * `@scanmate/extract` reports text in, and the same shape as the pixel comparison's
 * `ExpectedChange`. So the array about to be handed to an audit can be drawn
 * as it is, and what is checked visually is exactly what will be measured.
 */
export interface PageMark extends ScanmateRect {
  /** One-based page number. */
  page: number
  /** Written beside the box, so a reviewer can tell which field is which. */
  id?:  string
}

/**
 * How the marks are drawn. The bleed - `bleed`, and `bleedTop`, `bleedRight`,
 * `bleedBottom`, `bleedLeft` to override a side - is drawn as a dashed band
 * around each mark, and is the same rule the pixel comparison measures with. A
 * mark checked here with a given bleed is checked against the region an audit
 * with that bleed will actually claim. Default 6 points on every side.
 */
export interface MarkOptions extends Bleed {
  /** Write each mark's `id` beside it. Default `true`. */
  labels?:   boolean
  /**
   * Opens a PDF encrypted with a password it needs to be read. A signed or
   * permission-restricted document, locked with an owner password alone, needs
   * none: it is decrypted as it is read, and the marks are drawn on it.
   */
  password?: string
}

export interface MarkResult {
  /** The original, with the marks drawn on it. Nothing else about it changes. */
  pdf:      Uint8Array
  /** How many marks were drawn. */
  drawn:    number
  /**
   * What could not be drawn, or was drawn somewhere it cannot be right: a mark
   * on a page the document does not have, or one that reaches past the edge of
   * its page. The second is itself a positioning error, and exactly the kind
   * this exists to catch.
   */
  warnings: string[]
}
