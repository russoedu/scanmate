import type { InkOptions, PageRegion, ScanmateRect } from '@scanmate/ink'

/**
 * - `empty`: nothing written in it.
 * - `ticked`: a tick, a cross, a dot - a mark that answers it.
 * - `struck`: most of it inked over. Blacked out, or a tick scribbled over to
 *   take it back: which answer it gives cannot be told from the ink.
 */
export type CheckboxState = 'empty' | 'ticked' | 'struck'

/** A box on the original to read, in points from the top-left of the page as displayed - the printed square, frame and all. */
export interface Checkbox extends PageRegion {
  /**
   * What the returned document must show. A box with no expectation is read
   * and reported, and only a box that was ticked on the original and comes
   * back empty is a finding; one that must be ticked, or must stay empty, is a
   * finding whenever it is not.
   */
  expect?: 'ticked' | 'empty'
}

export interface CheckboxOptions {
  /**
   * How much of each side is set aside as the printed frame, as a share of
   * the box's shorter side. Default `0.2`: the frame, and a pixel or two of
   * misalignment, never counts as a mark. A tick crosses the middle of its box.
   */
  inset?:         number
  /**
   * Least ink inside the box that is a mark, in square millimetres. Default
   * `0.6`. Measured on synthetic scans at 150 dpi, in 4.6 mm boxes: a 0.34 mm
   * pen tick leaves 1.7-1.8 mm2 inside when dark and 0.75-0.83 when mid-grey,
   * a 0.5 mm one 1.4-2.6; an empty box under heavy sensor noise, at most 0.23.
   * A very light stroke - pencil pressed softly - can fall under it: at 37%
   * grey the same tick measured 0-0.75.
   */
  minTickArea?:   number
  /**
   * Share of the box's inside that, once **solidly** inked, makes it struck
   * rather than ticked. Default `0.5`.
   *
   * Solid, not merely covered: two 0.5 mm strokes fill half of a 3 mm box - the
   * W-9's size - so a plain tick would otherwise be read as a box inked over.
   * What is measured is the ink left after eroding every edge by
   * `struckErosion`, which a stroke does not survive and a filled box does.
   * Measured on a real 200-dpi scan of a 3 mm box: a tick leaves 0.01 of the
   * inside, a cross 0.06, a 1 mm marker tick 0.45; blacked out and scribbled
   * over both leave 1.00.
   */
  struckFill?:    number
  /** How far each edge of the ink is eaten away before it counts as solid, in millimetres. Default `0.4`: wider than a pen, narrower than a filled box. */
  struckErosion?: number
  /** Pixels the original's ink is fattened by, for the comparison's masks. Default `2`. */
  tolerance?:     number
  /** Resolution assumed for a page that does not say what it was rendered at. Default `150`. */
  assumeDpi?:     number
  ink?:           InkOptions
}

/** How one side of the pair has a box marked. */
export interface CheckboxSide {
  state: CheckboxState
  /** Ink inside the box, past its frame, in square millimetres. */
  ink:   number
  /** That ink as a share of the box's inside. */
  fill:  number
  /** The share that is solid ink - what survives eroding every edge by `struckErosion`. A mark leaves almost none. */
  solid: number
}

export interface CheckboxReading {
  id:        string
  page:      number
  /** The box as given, in points. */
  box:       ScanmateRect
  /** What was issued: usually empty, sometimes ticked in advance. */
  original:  CheckboxSide
  /** What came back. */
  scanned:   CheckboxSide
  /** The two sides are in different states. */
  changed:   boolean
  expect:    'ticked' | 'empty' | null
  /** Whether the scan shows what `expect` asks for; `null` when nothing was asked. */
  satisfied: boolean | null
}

/** Boxes answered together: "check only one of the following". */
export interface CheckboxGroup {
  /** Names the group in findings. */
  id:     string
  /** The ids of its boxes, each one of the `checkboxes` read. */
  boxes:  readonly string[]
  /** How many may be ticked. */
  ticked: 'exactly-one' | 'at-least-one' | 'at-most-one'
}

/** How a group is answered on the scan. */
export interface GroupReading {
  id:        string
  rule:      CheckboxGroup['ticked']
  /** Its boxes ticked on the scan. */
  ticked:    string[]
  /** Its boxes inked over, whose answer cannot be read. */
  struck:    string[]
  /** Its boxes that were not read at all. */
  missing:   string[]
  /** Whether the scan answers it as the rule asks; `null` when not all its boxes were read. */
  satisfied: boolean | null
}
