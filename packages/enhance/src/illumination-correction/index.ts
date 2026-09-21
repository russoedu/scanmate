/** Flattening uneven lighting and stretching contrast, from the page's own background. */

export { estimateContrastPoints, resolveContrastPoints } from './contrast-points.policy'
export type { ContrastPoints } from './contrast-points.policy'
export type { AppliedEnhancement, EnhanceOptions, SharpenOptions } from './enhance-options.contract'
export { DEFAULT_ENHANCE_OPTIONS, enhanceRaster, sharpenRaster } from './enhance-raster.use-case'
export type { EnhancedRaster } from './enhance-raster.use-case'
