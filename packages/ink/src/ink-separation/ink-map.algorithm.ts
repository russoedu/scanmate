import type { GrayImage, Raster } from '../raster-codec'
import { createGray } from '../raster-codec'

/**
 * Turning a photograph of paper into something two images can be compared on.
 *
 * A scan differs from its source in ways that have nothing to do with where
 * the page is: the lamp is brighter in the middle, the phone cast a shadow
 * down one side, the JPEG quantiser smeared the strokes. Comparing raw
 * greyscale means comparing all of that too. So every stage below the codec
 * works on **ink**: greyscale divided by its own slowly-varying background and
 * inverted, which is near zero on paper and near one on print no matter what
 * the lighting did.
 *
 * Think of it as reading a page through a sheet of tracing paper — you lose
 * the tint of the paper and the angle of the lamp, and keep the writing.
 */

/** Rec. 601 luminance, alpha composited over white, scaled to `[0, 1]`. */
export function toGrayscale (image: Raster): GrayImage {
  const out = createGray(image.width, image.height)
  const src = image.data
  const dst = out.data

  for (let i = 0, p = 0; p < dst.length; i += 4, p++) {
    const a = src[i + 3] / 255
    const r = src[i] * a + 255 * (1 - a)
    const g = src[i + 1] * a + 255 * (1 - a)
    const b = src[i + 2] * a + 255 * (1 - a)
    dst[p] = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  }

  return out
}

/** Render a single channel back to RGBA, for debugging and diff overlays. */
export function grayToRaster (image: GrayImage): Raster {
  const data = new Uint8ClampedArray(image.width * image.height * 4)
  for (let p = 0, i = 0; p < image.data.length; p++, i += 4) {
    const v = image.data[p] * 255
    data[i] = v
    data[i + 1] = v
    data[i + 2] = v
    data[i + 3] = 255
  }

  return { width: image.width, height: image.height, data }
}

/** Summed-area table with a zero first row and column, so a window sum is four lookups. */
export function integralImage (image: GrayImage): Float64Array {
  const { width, height, data } = image
  const stride = width + 1
  const sum = new Float64Array(stride * (height + 1))

  for (let y = 0; y < height; y++) {
    let rowSum = 0
    const srcRow = y * width
    const dstRow = (y + 1) * stride
    const prevRow = y * stride
    for (let x = 0; x < width; x++) {
      rowSum += data[srcRow + x]
      sum[dstRow + x + 1] = sum[prevRow + x + 1] + rowSum
    }
  }

  return sum
}

/**
 * Mean over a `(2 * radius + 1)` square, in time independent of the radius.
 *
 * Border windows are clipped and divided by their real area rather than padded,
 * so the blur never invents dark paper outside the page.
 */
export function boxBlur (image: GrayImage, radius: number): GrayImage {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return { ...image, data: Float32Array.from(image.data) }

  const { width, height } = image
  const sum = integralImage(image)
  const stride = width + 1
  const out = createGray(width, height)

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(height, y + r + 1)
    const top = y0 * stride
    const bottom = y1 * stride

    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(width, x + r + 1)
      const total = sum[bottom + x1] - sum[bottom + x0] - sum[top + x1] + sum[top + x0]
      out.data[y * width + x] = total / ((y1 - y0) * (x1 - x0))
    }
  }

  return out
}

export interface InkOptions {
  /**
   * Background window as a fraction of the shorter side. The window has to be
   * wide enough that no glyph can fill it — otherwise a bold heading becomes
   * its own background and disappears — and narrow enough to follow a shadow.
   */
  backgroundFraction?: number
  /** Ink below this fraction of full black is treated as paper noise and zeroed. */
  floor?:              number
}

/**
 * Greyscale to ink: divide out the local background, invert, clip the noise floor.
 *
 * Division rather than subtraction because illumination is multiplicative —
 * a shadow halves what reaches the sensor, it does not subtract a constant —
 * so dividing restores the same contrast in the shadow as in the light.
 */
export function inkMap (gray: GrayImage, options: InkOptions = {}): GrayImage {
  const { backgroundFraction = 1 / 16, floor = 0.06 } = options
  const radius = Math.max(4, Math.round(Math.min(gray.width, gray.height) * backgroundFraction))
  const background = boxBlur(gray, radius)
  const out = createGray(gray.width, gray.height)

  for (let p = 0; p < out.data.length; p++) {
    const bg = Math.max(background.data[p], 1e-3)
    const ratio = gray.data[p] / bg
    const ink = 1 - Math.min(1, ratio)
    out.data[p] = ink < floor ? 0 : Math.min(1, (ink - floor) / (1 - floor))
  }

  return out
}
