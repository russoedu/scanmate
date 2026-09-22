import type { GrayImage } from '../raster-codec'

/**
 * Which way up the printing is.
 *
 * {@link contentExtent} cannot measure the block of ink until the skew is out of
 * the way, so this runs first and hands it an angle.
 */

export interface SkewOptions {
  /** Largest skew to consider, in degrees, in either direction. */
  maxAngleDeg?: number
  /** Longest side of the image the search runs on. Skew does not need detail. */
  workingSize?: number
}

/**
 * The page's own skew, in radians, from the sharpness of its ink profile.
 *
 * Rotate the page until the rows of text stack up: at the right angle every
 * line of type falls into one bin of the projection histogram and the profile
 * is a comb of tall spikes; a degree off and each line smears across several
 * bins. Sum of squares rewards exactly that concentration — same total ink,
 * fewer bins, bigger number. Searched coarse to fine so the cost stays flat.
 */
export function estimateSkew (ink: GrayImage, options: SkewOptions = {}): number {
  const { maxAngleDeg = 12 } = options
  const toRad = Math.PI / 180

  let best = 0
  let bestScore = -Infinity
  for (let deg = -maxAngleDeg; deg <= maxAngleDeg; deg += 1) {
    const score = profileSharpness(ink, deg * toRad)
    if (score > bestScore) {
      bestScore = score
      best = deg
    }
  }

  for (const [span, step] of [[1, 0.2], [0.2, 0.04]] as const) {
    let localBest = best
    for (let deg = best - span; deg <= best + span + 1e-9; deg += step) {
      const score = profileSharpness(ink, deg * toRad)
      if (score > bestScore) {
        bestScore = score
        localBest = deg
      }
    }
    best = localBest
  }

  return best * toRad
}

/** Sum of squares of the ink profile projected onto the axis perpendicular to `angle`. */
export function profileSharpness (ink: GrayImage, angle: number): number {
  const { width, height, data } = ink
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const offset = Math.max(0, -width * sin)
  const bins = new Float64Array(Math.ceil(height * cos + width * Math.abs(sin)) + 2)

  for (let y = 0; y < height; y++) {
    const row = y * width
    const yCos = (y + 0.5) * cos + offset
    for (let x = 0; x < width; x++) {
      const value = data[row + x]
      if (value <= 0) continue
      const bin = Math.floor(yCos - (x + 0.5) * sin)
      if (bin >= 0 && bin < bins.length) bins[bin] += value
    }
  }

  let score = 0
  for (const value of bins) score += value * value

  return score
}
