import { boxBlur, boxBlurRaster, createRaster, toGrayscale } from '@scanmate/ink'
import type { Raster } from '@scanmate/ink'

import { despeckle as medianFilter, estimateNoiseSigma } from '../noise-reduction'
import { resolveContrastPoints } from './contrast-points.policy'
import type { AppliedEnhancement, EnhanceOptions, SharpenOptions } from './enhance-options.contract'

/**
 * Even out the lighting, whiten the paper and darken the ink.
 *
 * Scanned and photographed pages come back with shadows, yellowed or grey
 * paper and washed-out text. Dividing each pixel by an estimate of the paper
 * behind it - a wide box mean, which no stroke is big enough to move - flattens
 * the lighting and leaves the ink; a linear stretch between the black and white
 * points then clamps paper to white and ink to black. In colour mode each channel
 * is divided by its own background, which also corrects the white balance while
 * a blue pen stays blue.
 */

/**
 * Chosen by OCR word recall on three real scans (93, 120 and 144 dpi, 21 pages)
 * enlarged to 300 dpi: automatic clamp points gave the best mean, 0.738 against
 * 0.728 unenhanced, and gained most where reading is hardest - 0.448 against
 * 0.397 at 93 dpi. Forcing a despeckle cost recall at every resolution tried,
 * and badly at the scans' own (0.141 against 0.392 at 93 dpi): a 3x3 median
 * erases a stroke one or two pixels wide. So despeckling is `'auto'`, which only
 * fires on a page that measures noisy.
 */
export const DEFAULT_ENHANCE_OPTIONS: Required<EnhanceOptions> = {
  sharpen:            false,
  backgroundFraction: 1 / 16,
  whitePoint:         'auto',
  blackPoint:         'auto',
  mode:               'color',
  despeckle:          'auto',
  despeckleThreshold: 0.01,
  despeckleRadius:    1,
}

export interface EnhancedRaster {
  raster:  Raster
  applied: AppliedEnhancement
}

export function enhanceRaster (raster: Raster, options: EnhanceOptions = {}): EnhancedRaster {
  const settings = { ...DEFAULT_ENHANCE_OPTIONS, ...definedOnly(options) }
  const { width, height } = raster

  const rawGray = toGrayscale(raster)
  const noiseSigma = settings.despeckle === 'auto' ? estimateNoiseSigma(rawGray) : null
  const despeckled = settings.despeckle === true || (noiseSigma !== null && noiseSigma > settings.despeckleThreshold)
  const data = despeckled ? medianFilter(raster.data, width, height, settings.despeckleRadius) : raster.data
  const gray = despeckled ? toGrayscale({ width, height, data }) : rawGray

  const radius = Math.max(4, Math.round(Math.min(width, height) * settings.backgroundFraction))
  const background = boxBlur(gray, radius)
  const { whitePoint, blackPoint } = resolveContrastPoints(settings.whitePoint, settings.blackPoint, gray, background)
  const span = Math.max(1e-4, whitePoint - blackPoint)
  const out = createRaster(width, height)

  if (settings.mode === 'color') {
    const channels = [0, 1, 2].map(c => blurChannel(data, c, width, height, radius))
    for (let p = 0, i = 0; p < width * height; p++, i += 4) {
      for (let c = 0; c < 3; c++) out.data[i + c] = stretch(data[i + c] / Math.max(channels[c][p], 1), blackPoint, span)
      out.data[i + 3] = data[i + 3]
    }
  } else
    for (let p = 0, i = 0; p < width * height; p++, i += 4) {
      const value = stretch(gray.data[p] / Math.max(background.data[p], 1e-3), blackPoint, span)
      out.data[i] = value
      out.data[i + 1] = value
      out.data[i + 2] = value
      out.data[i + 3] = data[i + 3]
    }

  const sharpened = settings.sharpen === false ? out : unsharpMask(out, settings.sharpen)

  return { raster: sharpened, applied: { whitePoint, blackPoint, mode: settings.mode, despeckled, noiseSigma, sharpened: settings.sharpen } }
}

/**
 * An unsharp mask: the page, plus what a blur of it throws away.
 *
 * Applied last, on the enlarged and levelled page, and both of those matter.
 * Enlarging first is what sets the radius: a stroke on a page taken from 93 dpi
 * to 300 is three times the width it was scanned at, so a radius fitted to the
 * original resolution sharpens detail that is no longer there - measured, a
 * radius of 0.6 on such a page changed the reading in no way at all, while 4
 * was the optimum. Levelling first is what gives it edges to work on rather
 * than paper shading: on the same page, levelling alone gained 0.003 and
 * sharpening alone 0.074, but the two in this order gained 0.144.
 *
 * Three box blurs stand in for a Gaussian, which is close enough for a mask
 * and keeps this synchronous.
 */
function unsharpMask (raster: Raster, { sigma, amount = 1.5 }: SharpenOptions): Raster {
  if (sigma <= 0 || amount <= 0) return raster

  const radius = Math.max(1, Math.round(sigma))
  let blurred = raster
  for (let pass = 0; pass < 3; pass++) blurred = boxBlurRaster(blurred, radius)

  const out = createRaster(raster.width, raster.height)
  for (let i = 0; i < raster.data.length; i += 4) {
    for (let c = 0; c < 3; c++) out.data[i + c] = raster.data[i + c] + amount * (raster.data[i + c] - blurred.data[i + c])
    out.data[i + 3] = raster.data[i + 3]
  }

  return out
}

/** A background ratio to an 8-bit value: linear between the clamp points, clipped outside them. */
function stretch (ratio: number, blackPoint: number, span: number): number {
  const value = Math.round(((ratio - blackPoint) / span) * 255)

  return Math.min(255, Math.max(0, value))
}

/**
 * Box mean of one RGBA channel with a summed-area table, averaging over the
 * part of the window that lies on the page - so the border is never darkened by
 * paper that is not there.
 */
function blurChannel (data: Uint8ClampedArray, channel: number, width: number, height: number, radius: number): Float32Array {
  const stride = width + 1
  const sum = new Float64Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      row += data[(y * width + x) * 4 + channel]
      sum[(y + 1) * stride + x + 1] = sum[y * stride + x + 1] + row
    }
  }

  const out = new Float32Array(width * height)
  const r = Math.max(1, Math.round(radius))
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(height, y + r + 1)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(width, x + r + 1)
      const total = sum[y1 * stride + x1] - sum[y1 * stride + x0] - sum[y0 * stride + x1] + sum[y0 * stride + x0]
      out[y * width + x] = total / ((y1 - y0) * (x1 - x0))
    }
  }

  return out
}

/** `{ ...defaults, ...options }` without an explicit `undefined` wiping a default. */
function definedOnly (options: EnhanceOptions): EnhanceOptions {
  return Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined))
}
