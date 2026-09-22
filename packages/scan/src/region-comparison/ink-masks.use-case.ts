import { binarize, decodeImage, dilate, inkMap, otsuThreshold, toGrayscale } from '@scanmate/ink'
import type { BinaryImage, GrayImage, ScanmateSource, InkOptions } from '@scanmate/ink'

/**
 * The ink masks every comparison starts from, plus their tolerance bands.
 *
 * Both images must already share a canvas - that is what alignment is for - so
 * a size mismatch is refused outright rather than compared into nonsense.
 *
 * ## Why "lost" uses a lower bar than "added"
 *
 * Deciding that the scan *added* ink and deciding that it *lost* ink are not
 * symmetric, because scanning is not. A scanner washes colour out: on real
 * scans a crisp red hyperlink came back pink and a purple header bar came back
 * lavender, both light enough to fall below the scan's own ink threshold -
 * which, judged by the same bar as added ink, reported them as missing on every
 * page. Nothing had gone; it had faded. So the scan's ink is read twice: at its
 * normal threshold for what it added, and at `faintInk` times that threshold for
 * what is still there at all. Original ink counts as lost only where the scan
 * shows none even at the lower bar. An erased word leaves bare paper, which
 * fails both.
 */

export interface Masks {
  width:           number
  height:          number
  original:        BinaryImage
  /** The scan's ink at its normal threshold: what counts as *added*. */
  scan:            BinaryImage
  /** The scan's ink at the faint threshold: anything still there at all. */
  scanFaint:       BinaryImage
  originalDilated: BinaryImage
  /** `scanFaint`, fattened by the tolerance: original ink outside it is *lost*. */
  scanDilated:     BinaryImage
}

/** Default for {@link buildMasks}' `faintInk`, measured against real scans. */
export const FAINT_INK = 0.25

export async function buildMasks (
  original: ScanmateSource,
  aligned: ScanmateSource,
  ink: InkOptions | undefined,
  tolerance: number,
  faintInk = FAINT_INK,
): Promise<Masks> {
  const originalRaster = await decodeImage(original)
  const alignedRaster = await decodeImage(aligned)

  if (originalRaster.width !== alignedRaster.width || originalRaster.height !== alignedRaster.height)
    throw new Error(
      `compareRegions needs both images on the same canvas: got ${originalRaster.width}x${originalRaster.height} and ${alignedRaster.width}x${alignedRaster.height}. Align the scan first.`,
    )

  const originalMask = binarize(inkMap(toGrayscale(originalRaster), ink))
  const scanInk = inkMap(toGrayscale(alignedRaster), ink)
  const scanMask = binarize(scanInk)
  const scanFaint = above(scanInk, faintInk * Math.max(otsuThreshold(scanInk), MIN_THRESHOLD))

  return {
    width:           originalRaster.width,
    height:          originalRaster.height,
    original:        originalMask,
    scan:            scanMask,
    scanFaint,
    originalDilated: dilate(originalMask, tolerance),
    scanDilated:     dilate(scanFaint, tolerance),
  }
}

/** `binarize`'s own floor on the Otsu threshold, so the faint bar scales from the same number. */
const MIN_THRESHOLD = 0.12

/**
 * Threshold without `binarize`'s floor: the faint bar is meant to sit below it.
 * `inkMap` has already zeroed paper noise, so nothing here reads blank paper as ink.
 */
function above (image: GrayImage, cut: number): BinaryImage {
  const data = new Uint8Array(image.data.length)
  for (let p = 0; p < data.length; p++) data[p] = image.data[p] > cut ? 1 : 0

  return { width: image.width, height: image.height, data }
}
