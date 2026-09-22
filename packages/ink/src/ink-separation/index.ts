/** Greyscale to ink, and ink to a mask. */

export { boxBlur, grayToRaster, inkMap, integralImage, toGrayscale } from './ink-map.algorithm'
export type { InkOptions } from './ink-map.algorithm'
export { binarize, coverage, dilate, otsuThreshold } from './ink-mask.algorithm'
