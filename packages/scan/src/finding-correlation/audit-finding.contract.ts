import type { Change, ExpectedResult } from '../change-detection'
import type { CheckboxReading, GroupReading } from '../checkbox-reading'
import type { ScanmateRect } from '@scanmate/ink'
import type { TextDifference } from '@scanmate/ocr'

/**
 * One thing on a page someone should look at, with every piece of evidence for it.
 *
 * - `unexpected-mark`: ink added where nothing was expected; any words read
 *   there are attached.
 * - `missing-ink`: printed ink the scan lost; any text read as missing there is
 *   attached.
 * - `text-changed`, `text-missing`, `text-added`: the reading disagrees with the
 *   original where the pixels saw nothing - typically a substituted character,
 *   which stays within the pixel tolerance.
 * - `expected-empty`, `expected-overfilled`: a region that should have been
 *   filled in was left empty, or was blacked out.
 * - `text-unsettled`: the reading disagrees, the ink at that run is identical,
 *   and reading both sides again could not settle which is right. Reported,
 *   because "we could not tell" is not the same as "nothing happened".
 * - `checkbox-mismatch`: a box does not show what its `expect` asks.
 * - `checkbox-struck`: a box is inked over, so which answer it gives cannot be
 *   told - blacked out, or a tick scribbled over to take it back.
 * - `checkbox-cleared`: a box ticked on the original comes back empty.
 * - `checkbox-group`: boxes answered together are not answered as their rule
 *   asks - two ticked where one may be, or none where one must be.
 */
export type FindingKind =
  'unexpected-mark' |
  'missing-ink' |
  'text-changed' |
  'text-unsettled' |
  'text-missing' |
  'text-added' |
  'expected-empty' |
  'expected-overfilled' |
  'checkbox-mismatch' |
  'checkbox-struck' |
  'checkbox-cleared' |
  'checkbox-group'

export interface AuditFinding {
  kind:         FindingKind
  /** Where, in points from the page's top-left; `null` for content the original never places. */
  box:          ScanmateRect | null
  /** Both the reading and the pixels saw it - the strongest kind of finding. */
  corroborated: boolean
  /** One sentence for whoever reviews it. */
  summary:      string
  /** What the text comparison found here. */
  text:         TextDifference[]
  /** What the pixel comparison found here: a change, or an expected region's result. */
  pixels:       Change | ExpectedResult | null
  /** The expected region, the box, or the required content it concerns. */
  subject?:     string
  /** The box it concerns, as both sides have it. */
  checkbox?:    CheckboxReading
  /** The group of boxes it concerns, as the scan answers it. */
  group?:       GroupReading
}

/** A text difference that needs no one's attention, and why. */
export interface ExplainedDifference {
  difference: TextDifference
  /** The expected region that explains it: its own ink read as words, or its label written over. */
  region:     string
}
