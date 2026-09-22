import type { GrayImage } from '@scanmate/ink'
import { fft2d, nextPowerOfTwo } from '@scanmate/ink'

/**
 * Global translation from the Fourier shift theorem.
 *
 * Shifting an image does not change the magnitude of its spectrum, only the
 * phase — and it changes the phase by an amount proportional to the shift. So
 * divide out the magnitudes entirely, keep the phase difference, transform
 * back, and what comes out is a single spike at the offset between the two
 * images.
 *
 * Its value here is that it does not care what is *on* the page. Feature
 * matching needs corners to match; a mostly blank form does not have enough of
 * them, and neither does a page that scanned faint. Phase correlation uses
 * every pixel at once, which makes it the fallback when features fail, and a
 * good final polish when they succeed.
 *
 * It only finds translation. Rotation and scale have to be dealt with first.
 */

export interface PhaseCorrelationResult {
  /** Shift that takes `a` onto `b`: a feature at `p` in `a` sits at `p + (dx, dy)` in `b`. */
  dx:   number
  dy:   number
  /** Height of the correlation spike. Near 1 is a clean single answer; near 0 is noise. */
  peak: number
}

/**
 * Correlate two equally sized images.
 *
 * Both are Hann-windowed first. Without it the FFT sees the frame edges as a
 * hard discontinuity repeating forever, and that cross pattern in the spectrum
 * can be a stronger signal than the page.
 */
export function phaseCorrelate (a: GrayImage, b: GrayImage): PhaseCorrelationResult {
  if (a.width !== b.width || a.height !== b.height)
    throw new Error('phaseCorrelate needs two images of the same size')

  const width = nextPowerOfTwo(a.width)
  const height = nextPowerOfTwo(a.height)
  const size = width * height

  const aRe = new Float64Array(size)
  const aIm = new Float64Array(size)
  const bRe = new Float64Array(size)
  const bIm = new Float64Array(size)

  const windowX = hann(a.width)
  const windowY = hann(a.height)

  for (let y = 0; y < a.height; y++) {
    const src = y * a.width
    const dst = y * width
    for (let x = 0; x < a.width; x++) {
      const w = windowX[x] * windowY[y]
      aRe[dst + x] = a.data[src + x] * w
      bRe[dst + x] = b.data[src + x] * w
    }
  }

  fft2d(aRe, aIm, width, height)
  fft2d(bRe, bIm, width, height)

  // Cross-power spectrum of b against a, normalised to unit magnitude so that
  // every frequency contributes its phase and nothing else.
  for (let i = 0; i < size; i++) {
    const re = bRe[i] * aRe[i] + bIm[i] * aIm[i]
    const im = bIm[i] * aRe[i] - bRe[i] * aIm[i]
    const magnitude = Math.hypot(re, im)
    if (magnitude < 1e-12) {
      bRe[i] = 0
      bIm[i] = 0
    } else {
      bRe[i] = re / magnitude
      bIm[i] = im / magnitude
    }
  }

  fft2d(bRe, bIm, width, height, true)

  let peakIndex = 0
  let peakValue = -Infinity
  for (let i = 0; i < size; i++)
    if (bRe[i] > peakValue) {
      peakValue = bRe[i]
      peakIndex = i
    }

  const px = peakIndex % width
  const py = Math.floor(peakIndex / width)

  const dx = wrap(px + parabolic(sample(bRe, width, height, px - 1, py), peakValue, sample(bRe, width, height, px + 1, py)), width)
  const dy = wrap(py + parabolic(sample(bRe, width, height, px, py - 1), peakValue, sample(bRe, width, height, px, py + 1)), height)

  return { dx, dy, peak: peakValue }
}

/**
 * Sub-pixel offset of a peak, by fitting a parabola through it and its neighbours.
 *
 * The correlation surface is sampled on the pixel grid, but the true offset is
 * not a whole number of pixels. Three samples determine a parabola, and its
 * vertex is a better estimate than the middle sample - typically to about a
 * tenth of a pixel.
 */
function parabolic (left: number, center: number, right: number): number {
  const denominator = left - 2 * center + right
  if (Math.abs(denominator) < 1e-12) return 0

  const offset = (0.5 * (left - right)) / denominator

  return Math.abs(offset) < 1 ? offset : 0
}

function sample (data: Float64Array, width: number, height: number, x: number, y: number): number {
  const cx = ((x % width) + width) % width
  const cy = ((y % height) + height) % height

  return data[cy * width + cx]
}

/** Map an index in `[0, n)` onto a signed shift in `[-n/2, n/2)`. */
function wrap (value: number, n: number): number {
  return value > n / 2 ? value - n : value
}

function hann (n: number): Float64Array {
  const w = new Float64Array(n)
  if (n === 1) {
    w[0] = 1

    return w
  }
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))

  return w
}
