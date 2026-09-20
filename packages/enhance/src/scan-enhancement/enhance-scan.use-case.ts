import { decodeImage, encodeImage, isRaster, readImageMetadata, resampleRaster } from '@scanmate/ink'
import type { ScanmateSource } from '@scanmate/ink'

import { enhanceRaster } from '../illumination-correction'
import type { EnhanceResult, EnhanceScanOptions } from './enhance-result.contract'

/**
 * Clean one image: any raster, encoded image or path `@scanmate/ink` can decode.
 *
 * An image below `targetDpi` is first enlarged to it with a Lanczos kernel, so
 * the cleaning - and the reading after it - works on strokes several pixels
 * wide rather than one or two. Resampling, decoding and encoding go through
 * libvips and are asynchronous; the cleaning runs to completion on the calling
 * thread.
 */
export async function enhanceScan (input: ScanmateSource, options: EnhanceScanOptions = {}): Promise<EnhanceResult> {
  const { output = 'png', quality = 92, targetDpi = 300, dpi: given, ...enhance } = options

  const decoded = await decodeImage(input)
  const dpi = given === undefined ? await recordedDpi(input) : given
  const scale = targetDpi !== null && dpi !== null && dpi > 0 && dpi < targetDpi ? targetDpi / dpi : 1
  const source = scale === 1
    ? decoded
    : await resampleRaster(decoded, Math.round(decoded.width * scale), Math.round(decoded.height * scale))
  const { raster, applied } = enhanceRaster(source, enhance)

  return {
    raster,
    image:  output === 'none' ? null : await encodeImage(raster, { format: output, quality }),
    width:  raster.width,
    height: raster.height,
    dpi:    dpi === null ? null : dpi * scale,
    scale,
    applied,
  }
}

/** The density an encoded file records; unknown for a raster, or for a file that records none. */
async function recordedDpi (input: ScanmateSource): Promise<number | null> {
  if (isRaster(input)) return null
  const { density } = await readImageMetadata(input)

  return density
}
