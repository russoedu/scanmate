import type { BinaryImage, GrayImage } from '../raster-codec'

/**
 * How well two ink images actually overlap.
 *
 * Every stage of the pipeline proposes a transform; this is the referee. It
 * has to be a *correlation*, not a difference: the scan is darker, or fainter,
 * or contrast-stretched by the scanner's own firmware, and a sum of absolute
 * differences would rank a badly aligned pale scan above a well aligned dark
 * one. Zero-mean normalised cross correlation is invariant to both of those —
 * it only asks whether the ink rises and falls in the same places.
 */

/** Zero-mean normalised cross correlation of two equally sized images, in `[-1, 1]`. */
export function correlation (a: GrayImage, b: GrayImage): number {
  if (a.width !== b.width || a.height !== b.height)
    throw new Error('correlation needs two images of the same size')

  const n = a.data.length
  if (n === 0) return 0

  let sumA = 0
  let sumB = 0
  for (let i = 0; i < n; i++) {
    sumA += a.data[i]
    sumB += b.data[i]
  }
  const meanA = sumA / n
  const meanB = sumB / n

  let cov = 0
  let varA = 0
  let varB = 0
  for (let i = 0; i < n; i++) {
    const da = a.data[i] - meanA
    const db = b.data[i] - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }

  const denom = Math.sqrt(varA * varB)

  return denom > 1e-12 ? cov / denom : 0
}

/** Intersection over union of two masks. The pixel-level version of "did it land on top of it". */
export function intersectionOverUnion (a: BinaryImage, b: BinaryImage): number {
  if (a.width !== b.width || a.height !== b.height)
    throw new Error('intersectionOverUnion needs two masks of the same size')

  let intersection = 0
  let union = 0
  for (let i = 0; i < a.data.length; i++) {
    const hit = a.data[i] | b.data[i]
    union += hit
    intersection += a.data[i] & b.data[i]
  }

  return union > 0 ? intersection / union : 0
}

/** Mean of a single channel image. */
export function mean (image: GrayImage): number {
  if (image.data.length === 0) return 0
  let total = 0
  for (const value of image.data) total += value

  return total / image.data.length
}
