import type { AlignedPage, Bleed, ImageFormat, InkOptions, PageRegion, ProgressCallback, Raster, ScanmateRect } from '@scanmate/ink'

import type { Masks } from '../region-comparison'

/**
 * Coordinates for regions going in and changes coming out.
 *
 * `points` (the default) are PDF points, 1/72 inch, from the page's top-left
 * corner - the units a document generator already knows its fields in, and the
 * only ones that stay put when `@scanmate/extract` renders each document at its
 * scan's resolution. `pixels` are the original's rendered pixels, for callers
 * working from images rather than PDFs.
 */
export type CoordinateUnits = 'points' | 'pixels'

/** A place on a page where a change is expected - a signature box, a tick box. */
/**
 * A region where a change is expected - a field someone fills in. The shared
 * `PageRegion`, so a field located from its label by `@scanmate/extract` and
 * checked by eye with `@scanmate/merge` arrives here as it is.
 */
export type ExpectedChange = PageRegion

/**
 * An aligned page with what the pixel comparison found on it.
 *
 * The comparison hands the page back rather than a bare result, so whatever the
 * producer attached - the metadata, the page's partner in the scan, anything a
 * caller added - is still there afterwards. A bare result carries only a page
 * number, and matching those up again is a join the caller should never have to
 * write: page numbers are the original's, and go non-contiguous the moment
 * anyone extracts `'1-3,5'`.
 */
export type ComparedPage<Page extends AlignedPage = AlignedPage> = Page & { diff: PageDiff }

/**
 * How the comparison is run.
 *
 * The bleed - `bleed`, and `bleedTop`, `bleedRight`, `bleedBottom`, `bleedLeft`
 * to override a side - is how far outside an expected region its ink may still
 * lie, in `units`. Default 6 on every side, 2 mm at 72 points to the inch.
 *
 * People sign past the box they are given - a descender below the rule, a
 * flourish out to the side - and that is the signature, not a mark someone made
 * elsewhere. The region claims the ink within its bleed and measures it, while
 * still reporting the rectangle it was given. Ink inside the bleed of any
 * expected region counts towards them all, so one stroke crossing two fields is
 * not left over as unexpected.
 *
 * It is the same rule `Scanmate.mark` draws, so the band a reviewer is shown is
 * the band that is measured.
 */
export interface DiffOptions extends Bleed {
  /** Units of `ExpectedChange` rectangles and of every rectangle reported back. Default `'points'`. */
  units?:             CoordinateUnits
  /**
   * Places to measure the ink at, whether or not anything changed there.
   *
   * A reading that disagrees with the original is not by itself a change: OCR
   * misreads small print, and sideways print, and print on a shaded bar. Asking
   * what the ink does at the very place the reading disagrees settles it - ink
   * that is identical there means the characters are identical, whatever was
   * read. `@scanmate/audit` passes every text difference through here.
   */
  probes?:            readonly ProbeRect[]
  /**
   * Keep the ink masks on the result, so the caller can probe places it does
   * not know about yet.
   *
   * The places worth probing are the ones the reading disputes, and the reading
   * runs alongside this rather than before it - so `probes` cannot name them.
   * Masks are four binary images the size of the page, about 9 MB for A4 at
   * 150 dpi, so a caller is expected to drop them as soon as it has asked.
   */
  keepMasks?:         boolean
  /** Pixels the original's ink is fattened by before diffing, to absorb sub-pixel misalignment. Default `2`. */
  tolerance?:         number
  /**
   * New ink an expected region needs to count as identified, in square
   * millimetres. Default `2`.
   *
   * Counted from the region's changes - each already past `minChangeArea`, so
   * scattered speckle never adds up to a signature - and in physical units, not
   * as a share of the region: a pen signature is the same few tens of mm2
   * whether its box is a stamp or the width of the page, and the same mark is
   * four times the pixels at twice the dpi. A tick is about 5 mm2, initials a
   * little more; after merging, the largest noise measured on real scans was
   * 0.85 mm2.
   */
  minFillArea?:       number
  /**
   * Share of an expected region that may be new ink before it stops counting
   * as filled in. Default `0.5`.
   *
   * A signature or a name leaves most of its box empty; a box more than half
   * covered was scribbled out, blacked over or hit by a stamp. It is not
   * identified, and its result says `overfilled`.
   */
  maxFill?:           number
  /**
   * A piece of new ink inside an expected region that spans at least this share
   * of the region's width or height, and is thin, is a form rule, not writing.
   * Default `0.9`.
   *
   * Field boxes are often drawn with printed borders, and where the alignment
   * leaves a border a pixel or two out of place, a sliver of it outlives the
   * tolerance band. Such slivers are discarded and counted in `ink.formLines`.
   */
  formLineSpan?:      number
  /**
   * How thin, in millimetres, a spanning piece must be to be a form rule - or
   * 4% of the region's other side, if that is more. Default `0.6`: a printed
   * rule is a few tenths of a millimetre, a pen stroke rarely runs the length of
   * its box.
   */
  formLineThickness?: number
  /**
   * Smallest change worth reporting, in square millimetres of ink. Default `1`.
   *
   * Measured on real scans: after merging, the largest noise specks came to
   * 0.31-0.85 mm2, while a tick in a 6 mm box is about 5 mm2 and a signature
   * tens of mm2. Physical units, because the render resolution varies with the
   * scan and the same speck is four times the pixels at twice the dpi.
   */
  minChangeArea?:     number
  /**
   * Smallest loss of original ink worth reporting, in square millimetres.
   * Default `4`.
   *
   * Higher than `minChangeArea` on purpose. The poorest of three real scans
   * softened the ends of solid header bars into strips of 1-8 mm2 of apparent
   * loss on most pages, while an erased word, a line or a paragraph measured
   * 8-22 mm2 and more. Losses too small to clear this - a deleted three-letter
   * word is about 1 mm2 - are textual, and are what `@scanmate/ocr` compares
   * text for.
   */
  minMissingArea?:    number
  /**
   * Scan ink fainter than this fraction of the scan's own ink threshold counts
   * as gone. Scanners wash colour out - a red link comes back pink - and faded
   * is not missing. Default `0.25`.
   */
  faintInk?:          number
  /**
   * Changes within this many millimetres of each other are one change - the
   * strokes and dots of a signature, the two arms of a tick. Default `3`.
   */
  mergeGap?:          number
  /** Resolution assumed for a page that does not say what it was rendered at. Default `150`. */
  assumeDpi?:         number
  /** Fraction of a change's ink inside an expected region for the change to count as expected. Default `0.5`. */
  regionOverlap?:     number
  /**
   * Most changes reported per page, largest first. A badly aligned page turns
   * every stroke into a change; past this it is reported as `truncated`
   * instead of as a thousand boxes. Default `50`.
   */
  maxChanges?:        number
  /** Encoding of `diffImage`. `'none'` skips it. Default `'png'`. */
  output?:            ImageFormat | 'none'
  /** Draw each expected region and each unexpected change onto the overlay. Default `false`. */
  annotate?:          boolean
  /**
   * Also compose the original and the aligned scan side by side, with every
   * expected region, unexpected change and missing ink boxed on both halves -
   * the image a reviewer looks at. Encoded like the overlay. Default `false`:
   * it is twice a page of pixels.
   */
  sideBySide?:        boolean
  ink?:               InkOptions
  onProgress?:        ProgressCallback
}

/** What happened in one expected region. */
export interface ExpectedResult {
  id:         string
  /** The region gained enough new ink to count as filled in. */
  identified: boolean
  /** The region as given, in the requested units. */
  x:          number
  y:          number
  width:      number
  height:     number
  /** New ink in the region's changes, in square millimetres. */
  addedInk:   number
  /** Original ink the region lost, in square millimetres. */
  removedInk: number
  /** `addedInk` as a share of `minFillArea`, clamped to `[0, 1]`. */
  score:      number
  /** More of the region is new ink than `maxFill` allows: blacked out or scribbled over, not filled in. */
  overfilled: boolean
  /** The shape of the region's new ink. */
  ink:        RegionInkMetrics
}

/** How the new ink in an expected region is laid out. */
export interface RegionInkMetrics {
  /** Separate changes, after grouping the pieces of each - one for a signature, two for a name and a date. */
  changes:     number
  /** Ink in the largest change, in square millimetres. */
  largestArea: number
  /** Box around all of it, in the requested units; `null` when there is none. */
  bounds:      ScanmateRect | null
  /** `bounds` as a share of the region's width and height. */
  widthRatio:  number
  heightRatio: number
  /**
   * Share of the ink lying along the region's border (a band 3% of its shorter
   * side). Writing sits inside its box; ink that is mostly border-band came in
   * from outside or is the box's own frame.
   */
  edgeTouch:   number
  /** Share of the region's area that is new ink. */
  fill:        number
  /** Form-rule slivers discarded before measuring. */
  formLines:   number
}

/** A change found where nothing was expected, or ink that went missing. */
/** A place to measure the ink at; `page` selects the page when several are compared. */
export type ProbeRect = ScanmateRect & { page?: number }

/** What the ink does inside one place that was asked about. */
export interface InkProbe {
  /** The place asked about, in `units`. */
  rect:      ScanmateRect
  /** New ink there, in square millimetres. */
  addedInk:  number
  /** Printed ink lost there, in square millimetres. */
  lostInk:   number
  /** Ink the two pages agree on there, in square millimetres. */
  sharedInk: number
}

export interface Change {
  /** Bounding box, in the requested units. */
  x:       number
  y:       number
  width:   number
  height:  number
  /** Changed ink, in square millimetres. */
  inkArea: number
  /** Changed pixels. */
  pixels:  number
}

export interface PageDiff {
  page:             number
  /** The overlay: violet where the ink differs, grey where it agrees - annotated when asked. */
  diffRaster:       Raster
  diffImage:        Uint8Array | null
  /** Original and aligned scan side by side with the report boxed on both, when `sideBySide` was asked for. */
  sideBySideRaster: Raster | null
  sideBySideImage:  Uint8Array | null
  expected:         ExpectedResult[]
  /** The ink at each place `probes` asked about, in the same order. */
  probes:           InkProbe[]
  /** The ink masks, when `keepMasks` asked for them: for `probeInk`, then dropped. */
  masks:            Masks | null
  /** New ink outside every expected region, merged into one box per change. */
  unexpected:       Change[]
  /**
   * Original ink the scan lost. A dropped line is as suspicious as an added one.
   * A scan blurry enough to wash out a hairline rule reports that rule here too:
   * it is gone from the image, whatever happened to the paper.
   */
  missing:          Change[]
  /** More changes than `maxChanges` were found - usually a sign the alignment failed. */
  truncated:        boolean
  summary: {
    /** Page-wide fraction of new ink. */
    addedInk:      number
    removedInk:    number
    identified:    number
    notIdentified: number
    unexpected:    number
    missing:       number
  }
}
