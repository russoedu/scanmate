/** Which known rectangles gained ink, what changed page-wide, and an overlay to look at. */

export { compareRegions, diffDocument, measureRegion } from './compare-regions.use-case'
/** Consumed by change-detection, which builds the masks once per page and reads them several ways. */
export { buildMasks } from './ink-masks.use-case'
export type { Masks } from './ink-masks.use-case'
export type { DocumentDiff, Region, RegionOptions, RegionReport } from './region.model'
export { OVERLAY_DIFFERENT, OVERLAY_SHARED, paintOverlay, renderDiff } from './render-diff.use-case'
