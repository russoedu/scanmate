/** What changed on a page and whether it was supposed to: changed pixels grouped into reportable regions. */

export { annotateOverlay, EXPECTED_MARGIN, IDENTIFIED, MISSING, NOT_IDENTIFIED, UNEXPECTED } from './annotate-overlay.use-case'
export type { Annotation, Rgba } from './annotate-overlay.use-case'
export { connectedComponents, labelComponents } from './connected-components.use-case'
export type { Component, LabelledComponents, LabelOptions } from './connected-components.use-case'
export { diffPage, diffPages } from './diff-pages.use-case'
export { mergeBoxes } from './merge-boxes.use-case'
export type { MergedBox } from './merge-boxes.use-case'
export type { Change, CoordinateUnits, DiffOptions, ExpectedChange, ExpectedResult, PageDiff, RegionInkMetrics } from './page-diff.contract'
export { measureRegionInk } from './region-ink.use-case'
export type { RegionInk, RegionInkOptions } from './region-ink.use-case'
export { composeSideBySide } from './side-by-side.use-case'
