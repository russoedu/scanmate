/**
 * `@scanmate/enhance` - scans cleaned for reading: even lighting, white paper,
 * dark ink, no speckle.
 *
 * ```ts
 * import { enhancePages } from '@scanmate/enhance'
 *
 * const enhanced = await enhancePages(alignedPages)
 * enhanced[0].enhanced.raster   // the aligned scan, cleaned, on the original's canvas
 * enhanced[0].enhanced.applied  // what was done: clamp points, despeckling, noise level
 * ```
 *
 * Every page is divided by an estimate of its own paper, so shadows and tinted
 * or greyed stock flatten out, then stretched between a black and a white point
 * that can be read from the page itself. Speckle can be median-filtered first,
 * on every page or only on pages measured to be noisy.
 *
 * The pixel work is hand-written, as in `@scanmate/ink`: libvips has no
 * image-by-image division and no clipped-area box mean. `sharp` does the codec.
 */

export { enhancePages, enhanceScan } from './scan-enhancement'
export type { EnhancedImage, EnhancedPage, EnhancePagesOptions, EnhanceResult, EnhanceScanOptions } from './scan-enhancement'
export type { AppliedEnhancement, EnhanceOptions, SharpenOptions } from './illumination-correction'

// --- Building blocks ---

export { DEFAULT_ENHANCE_OPTIONS, enhanceRaster, estimateContrastPoints, resolveContrastPoints } from './illumination-correction'
export type { ContrastPoints, EnhancedRaster } from './illumination-correction'
export { despeckle, estimateNoiseSigma } from './noise-reduction'
