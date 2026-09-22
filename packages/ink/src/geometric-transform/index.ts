/** Resampling: resize, and warp through a 3x3 matrix. */

export { boxBlurRaster, downscaleGray, resizeGray } from './resize-gray.algorithm'
export { sampleGrayBilinear, warpGray, warpRaster } from './warp.algorithm'
export type { Interpolation, WarpOptions } from './warp.algorithm'
