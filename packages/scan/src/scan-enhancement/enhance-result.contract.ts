import type { AlignedPage, ImageFormat, PageImage, ProgressCallback, Raster } from '@scanmate/ink'

import type { AppliedEnhancement, EnhanceOptions } from '../illumination-correction'

export interface EnhanceScanOptions extends EnhanceOptions {
  /**
   * Resolution to enlarge the image to before cleaning it, when it is below it;
   * never reduced. Default `300`, the resolution OCR reads best at and the one
   * the cleaning defaults were measured at. `null` keeps the image as it is.
   */
  targetDpi?: number | null
  /**
   * The input's resolution. Default: what an encoded file records, else
   * unknown - and an image of unknown resolution is not resampled.
   */
  dpi?:       number | null
  /** Encoding for `image`. `'none'` keeps only the raster. Default `'png'`. */
  output?:    ImageFormat | 'none'
  /** Quality for lossy formats, 1-100. Default `92`. */
  quality?:   number
}

export interface EnhanceResult {
  raster:  Raster
  /** `raster` encoded, or `null` when `output` was `'none'`. */
  image:   Uint8Array | null
  width:   number
  height:  number
  /** Resolution of `raster`: the input's, or `targetDpi` if it was enlarged to it; `null` when unknown. */
  dpi:     number | null
  /** How much the input was enlarged; `1` when it was not. */
  scale:   number
  /** What was done, with every `'auto'` setting resolved to the value it chose. */
  applied: AppliedEnhancement
}

export interface EnhancePagesOptions extends Omit<EnhanceScanOptions, 'dpi'> {
  /**
   * Which image of each page to clean: `'aligned'` (the default), the scan on
   * the original's canvas, which is what OCR regions and diff boxes refer to;
   * or `'scanned'`, the scan as it came. Either way the page's own dpi is the
   * input resolution.
   */
  source?:     'aligned' | 'scanned'
  onProgress?: ProgressCallback
}

/**
 * A page image after enhancement: a {@link PageImage}, so it can go wherever one
 * goes. Enlarged to `targetDpi`, it is the same canvas at a finer grid - scaled
 * by `scale` - so a region in points still lands at `points * dpi / 72`.
 */
export interface EnhancedImage extends PageImage {
  scale:   number
  applied: AppliedEnhancement
}

/** An aligned page with its cleaned image alongside - everything it carried is kept. */
export type EnhancedPage<Page extends AlignedPage = AlignedPage> = Page & { enhanced: EnhancedImage }
