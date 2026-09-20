/**
 * `@scanmate/diff` - what changed between an original and its aligned scan, where,
 * and whether it was supposed to.
 *
 * ```ts
 * const diffs = await diffPages(alignedPages, [
 *   { page: 1, id: 'signature', x: 76, y: 700, width: 300, height: 60 },
 * ])
 * diffs[0].expected    // [{ id: 'signature', identified: true, ... }]
 * diffs[0].unexpected  // changes outside every expected region, one box each
 * ```
 *
 * Every function here assumes both images already share a canvas - which is what
 * `@scanmate/align` produces. Feed it a raw scan and every rectangle names a
 * different part of the page in each image.
 */

export { diffPage, diffPages } from './change-detection'
export type { Change, CoordinateUnits, DiffOptions, ExpectedChange, ExpectedResult, PageDiff, RegionInkMetrics } from './change-detection'

export { compareRegions, diffDocument, renderDiff } from './region-comparison'
export type { DocumentDiff, Region, RegionOptions, RegionReport } from './region-comparison'

// --- Building blocks ---

export { annotateOverlay, composeSideBySide, connectedComponents, EXPECTED_MARGIN, IDENTIFIED, labelComponents, measureRegionInk, mergeBoxes, MISSING, NOT_IDENTIFIED, UNEXPECTED } from './change-detection'
export type { Annotation, Component, LabelledComponents, LabelOptions, MergedBox, RegionInk, RegionInkOptions, Rgba } from './change-detection'
export { buildMasks, measureRegion, paintOverlay } from './region-comparison'
export type { Masks } from './region-comparison'
