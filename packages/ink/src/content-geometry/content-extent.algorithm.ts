import type { Point } from '../plane-geometry'
import type { GrayImage } from '../raster-codec'

/**
 * Where the printing is, and which way up it is.
 *
 * Feature matching needs the two images at roughly the same scale before its
 * descriptors mean anything, and nothing in the file headers tells us the dpi
 * the scanner used. What does tell us is the printing itself: the block of ink
 * on the page is the same physical object in both images, so the ratio of its
 * measured sizes is the ratio of the resolutions. Measuring it needs the skew
 * out of the way first, which is what {@link estimateSkew} is for.
 */

export interface ContentExtent {
  /** Extent along the rotated axes, in pixels. */
  width:   number
  height:  number
  /** Centre of the extent, back in unrotated image coordinates. */
  center:  Point
  /** The angle the extent was measured at, in radians. */
  angle:   number
  /** Mean ink over the whole image. Near zero means there was nothing to measure. */
  density: number
}

/**
 * Extent of the ink along axes rotated by `angle`, trimming outliers.
 *
 * `trim` is a fraction of the total ink discarded from each end of each axis.
 * A scanner that clips a black strip down one edge, or a speck of dust, would
 * otherwise set the page boundary — and since this measurement becomes the
 * scale estimate, a 2% error here is a 2% error in every coordinate downstream.
 */
export function contentExtent (ink: GrayImage, angle = 0, trim = 0.004): ContentExtent {
  const { width, height, data } = ink
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ]
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (const c of corners) {
    const u = c.x * cos + c.y * sin
    const v = -c.x * sin + c.y * cos
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }

  const uBins = new Float64Array(Math.ceil(maxU - minU) + 2)
  const vBins = new Float64Array(Math.ceil(maxV - minV) + 2)
  let total = 0

  for (let y = 0; y < height; y++) {
    const row = y * width
    const yCos = (y + 0.5) * cos
    const ySin = (y + 0.5) * sin
    for (let x = 0; x < width; x++) {
      const value = data[row + x]
      if (value <= 0) continue
      const px = x + 0.5
      // floor, not round: a pixel centre at x + 0.5 belongs to bucket x.
      uBins[Math.floor(px * cos + ySin - minU)] += value
      vBins[Math.floor(-px * sin + yCos - minV)] += value
      total += value
    }
  }

  if (total <= 0) {
    // Nothing printed: report the whole frame rather than an empty box, so the
    // caller falls back to fitting the page frame instead of dividing by zero.
    return {
      width,
      height,
      center:  { x: width / 2, y: height / 2 },
      angle,
      density: 0,
    }
  }

  const [u0, u1] = trimmedSpan(uBins, total, trim)
  const [v0, v1] = trimmedSpan(vBins, total, trim)

  const centerU = minU + (u0 + u1) / 2
  const centerV = minV + (v0 + v1) / 2

  return {
    width:   Math.max(1, u1 - u0),
    height:  Math.max(1, v1 - v0),
    center:  { x: centerU * cos - centerV * sin, y: centerU * sin + centerV * cos },
    angle,
    density: total / (width * height),
  }
}

/** First and last bin holding all but `trim` of the mass at each end. */
function trimmedSpan (bins: Float64Array, total: number, trim: number): [number, number] {
  const cutoff = total * trim

  let accumulated = 0
  let low = 0
  for (; low < bins.length; low++) {
    accumulated += bins[low]
    if (accumulated > cutoff) break
  }

  accumulated = 0
  let high = bins.length - 1
  for (; high > low; high--) {
    accumulated += bins[high]
    if (accumulated > cutoff) break
  }

  return [low, high + 1]
}
