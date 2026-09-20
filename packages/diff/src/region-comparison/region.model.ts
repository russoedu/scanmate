import type { InkOptions, ScanmateRect } from '@scanmate/ink'

export interface Region {
  id:         string
  /** In the *original's* pixel coordinates - the whole point of aligning first. */
  rect:       ScanmateRect
  /** Fraction of the region that must be new ink before `filled` is true. Overrides the global default. */
  threshold?: number
}

export interface RegionOptions {
  ink?:       InkOptions
  /**
   * Radius, in pixels, that the original's ink is fattened by before diffing.
   * Raise it if alignment is loose; lower it to catch very fine additions.
   */
  tolerance?: number
  /** Default fraction of new ink that counts as filled. */
  threshold?: number
  /**
   * Scan ink fainter than this fraction of the scan's own ink threshold counts
   * as gone. Anything lighter but still visible has faded, not disappeared -
   * scanners wash colour out. Default `0.25`.
   */
  faintInk?:  number
}

export interface RegionReport {
  id:          string
  rect:        ScanmateRect
  /** Ink coverage of the region in the original, in `[0, 1]`. */
  originalInk: number
  /** Ink coverage of the region in the aligned scan. */
  scanInk:     number
  /** Coverage that is ink in the scan and not within `tolerance` of ink in the original. */
  added:       number
  /** Coverage that is ink in the original and missing from the scan. Mostly a faint-scan warning. */
  removed:     number
  filled:      boolean
  /** `added` as a multiple of the threshold, clamped to `[0, 1]`. A reportable confidence. */
  score:       number
}

export interface DocumentDiff {
  /** Page-wide version of {@link RegionReport.added}. */
  added:   number
  removed: number
  regions: RegionReport[]
}
