import type { BinaryImage, GrayImage } from '../raster-codec'
import { createBinary } from '../raster-codec'

/**
 * Ink to a binary mask, and what you can measure once it is one.
 *
 * Splitting a continuous ink map into ink-or-paper is a decision rather than a
 * conversion: {@link otsuThreshold} picks the cut, {@link binarize} applies it,
 * {@link dilate} gives the result a tolerance band, and {@link coverage} counts
 * what survived.
 */

/** Otsu's threshold over a 256-bin histogram of `[0, 1]` values. */
export function otsuThreshold (image: GrayImage): number {
  const bins = 256
  const histogram = new Float64Array(bins)
  for (const value of image.data) {
    const bin = Math.min(bins - 1, Math.max(0, Math.round(value * (bins - 1))))
    histogram[bin]++
  }

  const total = image.data.length
  let sumAll = 0
  for (let i = 0; i < bins; i++) sumAll += i * histogram[i]

  let sumBackground = 0
  let weightBackground = 0
  let best = 0
  let bestVariance = -1

  for (let t = 0; t < bins; t++) {
    weightBackground += histogram[t]
    if (weightBackground === 0) continue
    const weightForeground = total - weightBackground
    if (weightForeground === 0) break

    sumBackground += t * histogram[t]
    const meanBackground = sumBackground / weightBackground
    const meanForeground = (sumAll - sumBackground) / weightForeground
    const between = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2

    if (between > bestVariance) {
      bestVariance = between
      best = t
    }
  }

  return best / (bins - 1)
}

/**
 * Ink to a binary mask.
 *
 * `threshold` defaults to Otsu's, with a floor: a page that is genuinely blank
 * has no bimodal split to find, and Otsu will happily cut its noise in half
 * and report that 50% of the paper is ink.
 */
export function binarize (image: GrayImage, threshold?: number): BinaryImage {
  const t = Math.max(threshold ?? otsuThreshold(image), 0.12)
  const out = createBinary(image.width, image.height)
  for (let p = 0; p < out.data.length; p++) out.data[p] = image.data[p] > t ? 1 : 0

  return out
}

/**
 * Morphological dilation by a square, done as two 1D max passes.
 *
 * Used to give the original's ink a tolerance band before asking what is new
 * in the scan: without it, alignment that is half a pixel off reports the edge
 * of every printed character as freshly written.
 */
export function dilate (mask: BinaryImage, radius: number): BinaryImage {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return { ...mask, data: Uint8Array.from(mask.data) }

  const { width, height } = mask
  const horizontal = new Uint8Array(width * height)

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let hit = 0
      const from = Math.max(0, x - r)
      const to = Math.min(width - 1, x + r)
      for (let k = from; k <= to; k++)
        if (mask.data[row + k] === 1) {
          hit = 1
          break
        }
      horizontal[row + x] = hit
    }
  }

  const out = createBinary(width, height)
  for (let y = 0; y < height; y++) {
    const from = Math.max(0, y - r)
    const to = Math.min(height - 1, y + r)
    for (let x = 0; x < width; x++) {
      let hit = 0
      for (let k = from; k <= to; k++)
        if (horizontal[k * width + x] === 1) {
          hit = 1
          break
        }
      out.data[y * width + x] = hit
    }
  }

  return out
}

/** Fraction of pixels set in `mask`, restricted to a rectangle when one is given. */
export function coverage (mask: BinaryImage, x0 = 0, y0 = 0, x1 = mask.width, y1 = mask.height): number {
  const left = Math.max(0, Math.floor(x0))
  const top = Math.max(0, Math.floor(y0))
  const right = Math.min(mask.width, Math.ceil(x1))
  const bottom = Math.min(mask.height, Math.ceil(y1))
  if (right <= left || bottom <= top) return 0

  let hits = 0
  for (let y = top; y < bottom; y++) {
    const row = y * mask.width
    for (let x = left; x < right; x++) hits += mask.data[row + x]
  }

  return hits / ((right - left) * (bottom - top))
}
