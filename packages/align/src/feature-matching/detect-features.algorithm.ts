import type { GrayImage } from '@scanmate/ink'
import { boxBlur, createRandom, gaussian, resizeGray } from '@scanmate/ink'

/**
 * FAST corners with steered BRIEF descriptors — an ORB, written out.
 *
 * This is the piece OpenCV would normally hand you, and it is here because the
 * deployment target rules out a native binding. The three parts each answer a
 * separate question:
 *
 * - **FAST** answers *where*. A pixel is a corner when a contiguous arc of the
 *   16 pixels on a circle around it is all clearly brighter, or all clearly
 *   darker, than it is. On a page that fires on stroke ends, serifs, and the
 *   corners of rules and boxes — landmarks that survive being rescanned.
 * - **The intensity centroid** answers *which way up*. The vector from the
 *   patch's centre to its centre of mass is a direction the ink itself defines,
 *   so it turns with the page.
 * - **BRIEF** answers *what it looks like*, as 256 yes/no questions of the form
 *   "is this pixel darker than that one?", asked at positions rotated by that
 *   angle. Comparing two of those is one XOR and a bit count, which is why
 *   brute-force matching thousands of them is affordable.
 *
 * The descriptor is not scale invariant on its own, hence the pyramid: the same
 * corner is described at several sizes so a scan at a different dpi still
 * matches.
 */

export interface Keypoint {
  /** Coordinates in the *input* image, pixel centres, regardless of the level found at. */
  x:     number
  y:     number
  score: number
  /** Dominant ink direction in radians. */
  angle: number
  level: number
  /** Pixel size of the patch described, in input pixels. */
  size:  number
}

export interface FeatureSet {
  keypoints:   Keypoint[]
  /** 8 x 32 bits per keypoint, laid out contiguously. */
  descriptors: Uint32Array
}

export interface FeatureOptions {
  maxFeatures?:   number
  /** Contrast a circle pixel must clear to count, in `[0, 1]` ink units. */
  fastThreshold?: number
  /** Pyramid levels, including the original. */
  levels?:        number
  /** Ratio between consecutive levels. */
  scaleFactor?:   number
  /** Side of the described patch, in pixels of its own level. */
  patchSize?:     number
  /** Cells per axis used to spread keypoints over the page instead of over its densest paragraph. */
  gridSize?:      number
  seed?:          number
}

export const DESCRIPTOR_WORDS = 8
const DESCRIPTOR_BITS = DESCRIPTOR_WORDS * 32
/** Rotation bins for the steered pattern. 32 bins is 11.25 degrees, finer than ORB's own 12. */
const ANGLE_BINS = 32

/** The Bresenham circle of radius 3, clockwise from the top. */
const CIRCLE: readonly [number, number][] = [
  [0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3],
  [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2], [-1, -3],
]
const ARC = 9
const COMPASS_MINIMUM = Math.floor((ARC - 1) / 4)

export function detectAndDescribe (image: GrayImage, options: FeatureOptions = {}): FeatureSet {
  const {
    maxFeatures = 1200,
    fastThreshold = 0.08,
    levels = 3,
    scaleFactor = 1.3,
    patchSize = 31,
    gridSize = 8,
    seed = 0xB81EF,
  } = options

  const patterns = steeredPatterns(patchSize, seed)
  const halfPatch = (patchSize - 1) / 2
  const border = Math.ceil(halfPatch * Math.SQRT2) + 2

  const keypoints: Keypoint[] = []
  const descriptorChunks: Uint32Array[] = []
  const perLevel = Math.ceil(maxFeatures / levels)

  for (let level = 0; level < levels; level++) {
    const levelScale = scaleFactor ** level
    const width = Math.round(image.width / levelScale)
    const height = Math.round(image.height / levelScale)
    if (width < border * 2 + 8 || height < border * 2 + 8) break

    const levelImage = level === 0 ? image : resizeGray(image, width, height)
    // BRIEF compares single pixels, so it is exquisitely sensitive to noise;
    // the smoothing is part of the descriptor, not a preprocessing nicety.
    const smoothed = boxBlur(levelImage, 2)

    const found = detectFast(levelImage, fastThreshold, border)
    const kept = distribute(found, width, height, gridSize, perLevel)

    for (const corner of kept) {
      const angle = orientation(levelImage, corner.x, corner.y, halfPatch)
      const bin = angleBin(angle)
      const descriptor = describe(smoothed, corner.x, corner.y, patterns[bin])
      if (descriptor === null) continue

      descriptorChunks.push(descriptor)
      keypoints.push({
        x:     (corner.x + 0.5) * levelScale,
        y:     (corner.y + 0.5) * levelScale,
        score: corner.score,
        angle,
        level,
        size:  patchSize * levelScale,
      })
    }
  }

  const descriptors = new Uint32Array(descriptorChunks.length * DESCRIPTOR_WORDS)
  for (const [i, chunk] of descriptorChunks.entries()) descriptors.set(chunk, i * DESCRIPTOR_WORDS)

  return { keypoints, descriptors }
}

interface Corner {
  x:     number
  y:     number
  score: number
}

/** FAST-9 with a 3x3 non-maximum suppression pass over the corner scores. */
export function detectFast (image: GrayImage, threshold: number, border: number): Corner[] {
  const { width, height, data } = image
  const scores = new Float32Array(width * height)
  const ring = new Float64Array(16)

  for (let y = border; y < height - border; y++) {
    for (let x = border; x < width - border; x++) {
      const center = data[y * width + x]
      const high = center + threshold
      const low = center - threshold

      // Cheap rejection on the four compass points, which sit 4 apart on the
      // ring. Any run of ARC consecutive pixels must contain at least
      // floor((ARC - 1) / 4) of them, so fewer than that cannot be a corner.
      // For ARC = 9 that bound is 2, not the 3 that the widely quoted FAST-12
      // version of this test uses - requiring 3 here silently discards real
      // corners, among them the corner of a plain filled rectangle.
      let bright = 0
      let dark = 0
      for (const k of [0, 4, 8, 12]) {
        const value = data[(y + CIRCLE[k][1]) * width + x + CIRCLE[k][0]]
        if (value > high) bright++
        else if (value < low) dark++
      }
      if (bright < COMPASS_MINIMUM && dark < COMPASS_MINIMUM) continue

      for (let k = 0; k < 16; k++) ring[k] = data[(y + CIRCLE[k][1]) * width + x + CIRCLE[k][0]]
      if (!hasArc(ring, high, low)) continue

      let brightSum = 0
      let darkSum = 0
      for (let k = 0; k < 16; k++) {
        if (ring[k] > high) brightSum += ring[k] - high
        else if (ring[k] < low) darkSum += low - ring[k]
      }
      scores[y * width + x] = Math.max(brightSum, darkSum)
    }
  }

  const corners: Corner[] = []
  for (let y = border; y < height - border; y++) {
    for (let x = border; x < width - border; x++) {
      const score = scores[y * width + x]
      if (score <= 0) continue

      let isPeak = true
      for (let dy = -1; isPeak && dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue

          if (scores[(y + dy) * width + x + dx] > score) {
            isPeak = false
            break
          }
        }

      if (isPeak) corners.push({ x, y, score })
    }
  }

  return corners
}

/** True when 9 consecutive ring pixels (wrapping) are all above `high` or all below `low`. */
function hasArc (ring: Float64Array, high: number, low: number): boolean {
  let runBright = 0
  let runDark = 0

  for (let k = 0; k < 16 + ARC - 1; k++) {
    const value = ring[k % 16]
    runBright = value > high ? runBright + 1 : 0
    runDark = value < low ? runDark + 1 : 0
    if (runBright >= ARC || runDark >= ARC) return true
  }

  return false
}

/**
 * Keep the strongest corners, but spread over the page.
 *
 * Score alone concentrates every keypoint in the densest block of text, and a
 * transform fitted to correspondences from one corner of the page extrapolates
 * badly to the other three. Filling a grid first, then topping up from what is
 * left, buys coverage without throwing away the best corners.
 */
function distribute (
  corners: Corner[],
  width: number,
  height: number,
  gridSize: number,
  budget: number,
): Corner[] {
  if (corners.length <= budget) return corners

  const cells = new Map<number, Corner[]>()
  const cellWidth = width / gridSize
  const cellHeight = height / gridSize

  for (const corner of corners) {
    const cx = Math.min(gridSize - 1, Math.floor(corner.x / cellWidth))
    const cy = Math.min(gridSize - 1, Math.floor(corner.y / cellHeight))
    const key = cy * gridSize + cx
    const bucket = cells.get(key)
    if (bucket === undefined) cells.set(key, [corner])
    else bucket.push(corner)
  }

  const perCell = Math.max(1, Math.floor(budget / Math.max(1, cells.size)))
  const kept: Corner[] = []
  const leftovers: Corner[] = []

  for (const bucket of cells.values()) {
    bucket.sort((a, b) => b.score - a.score)
    kept.push(...bucket.slice(0, perCell))
    leftovers.push(...bucket.slice(perCell))
  }

  if (kept.length < budget) {
    leftovers.sort((a, b) => b.score - a.score)
    kept.push(...leftovers.slice(0, budget - kept.length))
  }

  // With more cells than budget the floor above rounds to one per cell, which
  // can overshoot; the budget is a promise, so trim by score.
  if (kept.length > budget) {
    kept.sort((a, b) => b.score - a.score)

    return kept.slice(0, budget)
  }

  return kept
}

/**
 * Angle from the patch centre to its centre of intensity mass.
 *
 * On an ink image the mass is the writing, so the angle turns with the page —
 * which is the entire trick that makes a binary descriptor rotation invariant.
 */
export function orientation (image: GrayImage, cx: number, cy: number, radius: number): number {
  const { width, height, data } = image
  const r = Math.floor(radius)
  let m10 = 0
  let m01 = 0

  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy
    if (y < 0 || y >= height) continue
    const span = Math.floor(Math.sqrt(r * r - dy * dy))
    const row = y * width
    for (let dx = -span; dx <= span; dx++) {
      const x = cx + dx
      if (x < 0 || x >= width) continue
      const value = data[row + x]
      m10 += dx * value
      m01 += dy * value
    }
  }

  return Math.atan2(m01, m10)
}

function angleBin (angle: number): number {
  const twoPi = Math.PI * 2
  const normalized = ((angle % twoPi) + twoPi) % twoPi

  return Math.floor((normalized / twoPi) * ANGLE_BINS) % ANGLE_BINS
}

function describe (image: GrayImage, cx: number, cy: number, pattern: Int32Array): Uint32Array | null {
  const { width, height, data } = image
  const out = new Uint32Array(DESCRIPTOR_WORDS)

  for (let bit = 0; bit < DESCRIPTOR_BITS; bit++) {
    const base = bit * 4
    const x1 = cx + pattern[base]
    const y1 = cy + pattern[base + 1]
    const x2 = cx + pattern[base + 2]
    const y2 = cy + pattern[base + 3]

    if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0 || x1 >= width || y1 >= height || x2 >= width || y2 >= height)
      return null

    if (data[y1 * width + x1] < data[y2 * width + x2])
      out[bit >> 5] |= 1 << (bit & 31)
  }

  return out
}

const patternCache = new Map<string, Int32Array[]>()

/**
 * One integer sampling pattern per rotation bin, built once and cached.
 *
 * Rotating 256 point pairs per keypoint would mean a thousand trig calls each;
 * quantising the angle instead turns the whole thing into a table lookup, at a
 * cost of at most half a bin of angular error.
 */
function steeredPatterns (patchSize: number, seed: number): Int32Array[] {
  const key = `${patchSize}:${seed}`
  const cached = patternCache.get(key)
  if (cached !== undefined) return cached

  const half = (patchSize - 1) / 2
  const sigma = patchSize / 5
  const random = createRandom(seed)
  const base = new Float64Array(DESCRIPTOR_BITS * 4)

  for (let i = 0; i < DESCRIPTOR_BITS * 4; i++)
    base[i] = clamp(Math.round(gaussian(random) * sigma), -half, half)

  const patterns: Int32Array[] = []
  for (let bin = 0; bin < ANGLE_BINS; bin++) {
    const angle = (bin / ANGLE_BINS) * Math.PI * 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const rotated = new Int32Array(DESCRIPTOR_BITS * 4)

    for (let i = 0; i < DESCRIPTOR_BITS * 4; i += 2) {
      const x = base[i]
      const y = base[i + 1]
      rotated[i] = Math.round(cos * x - sin * y)
      rotated[i + 1] = Math.round(sin * x + cos * y)
    }
    patterns.push(rotated)
  }

  patternCache.set(key, patterns)

  return patterns
}

function clamp (value: number, min: number, max: number): number {
  return value < min ? min : (Math.min(value, max))
}
