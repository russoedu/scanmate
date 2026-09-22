import type { Matrix3 } from '../plane-geometry'
import type { GrayImage, Raster } from '../raster-codec'
import { createGray } from '../raster-codec'
import { boxBlurRaster } from './resize-gray.use-case'

/**
 * Resampling one image onto another image's grid.
 *
 * The matrix maps **destination coordinates to source coordinates** — we stand
 * on each output pixel and reach back into the scan for its colour. Doing it
 * the other way, pushing scan pixels forward, leaves the output full of pinholes
 * wherever the transform stretches, for the same reason a rotated stencil
 * sprays gaps.
 */

export type Interpolation = 'nearest' | 'bilinear' | 'bicubic'

export interface WarpOptions {
  /** RGBA fill for destination pixels that fall outside the source. Opaque white by default. */
  background?:    [number, number, number, number]
  interpolation?: Interpolation
  /**
   * Low-pass the source before minifying, so shrinking a 300 dpi scan does not
   * alias the text into stripes. On by default; it costs one blur.
   */
  prefilter?:     boolean
}

/** Warp an RGBA raster onto a `width x height` canvas. */
export function warpRaster (
  source: Raster,
  matrix: Matrix3,
  width: number,
  height: number,
  options: WarpOptions = {},
): Raster {
  const {
    background = [255, 255, 255, 255],
    interpolation = 'bilinear',
    prefilter = true,
  } = options

  const src = prefilter ? applyPrefilter(source, matrix) : source
  const data = new Uint8ClampedArray(width * height * 4)
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = matrix

  for (let y = 0; y < height; y++) {
    const dy = y + 0.5
    let i = y * width * 4

    for (let x = 0; x < width; x++, i += 4) {
      const dx = x + 0.5
      const w = m6 * dx + m7 * dy + m8
      if (w === 0) {
        writePixel(data, i, background)
        continue
      }

      // Continuous source coordinate, then index space: pixel k spans [k, k+1)
      // with its centre at k + 0.5, so the sample index is the centre minus a half.
      const u = (m0 * dx + m1 * dy + m2) / w - 0.5
      const v = (m3 * dx + m4 * dy + m5) / w - 0.5

      if (u < -1 || v < -1 || u > src.width || v > src.height) {
        writePixel(data, i, background)
        continue
      }

      sampleRaster(src, u, v, interpolation, data, i)
    }
  }

  return { width, height, data }
}

/** Warp a single channel image. Used for scoring, where colour is noise. */
export function warpGray (
  source: GrayImage,
  matrix: Matrix3,
  width: number,
  height: number,
  fill = 0,
): GrayImage {
  const out = createGray(width, height)
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = matrix

  for (let y = 0; y < height; y++) {
    const dy = y + 0.5
    const row = y * width

    for (let x = 0; x < width; x++) {
      const dx = x + 0.5
      const w = m6 * dx + m7 * dy + m8
      if (w === 0) {
        out.data[row + x] = fill
        continue
      }

      const u = (m0 * dx + m1 * dy + m2) / w - 0.5
      const v = (m3 * dx + m4 * dy + m5) / w - 0.5
      out.data[row + x] = sampleGrayBilinear(source, u, v, fill)
    }
  }

  return out
}

/** Bilinear read at a fractional index, returning `fill` outside the image. */
export function sampleGrayBilinear (image: GrayImage, u: number, v: number, fill = 0): number {
  const { width, height, data } = image
  if (u <= -1 || v <= -1 || u >= width || v >= height) return fill

  const x0 = Math.floor(u)
  const y0 = Math.floor(v)
  const fx = u - x0
  const fy = v - y0
  const x1 = x0 + 1
  const y1 = y0 + 1

  const cx0 = clampIndex(x0, width)
  const cx1 = clampIndex(x1, width)
  const cy0 = clampIndex(y0, height)
  const cy1 = clampIndex(y1, height)

  const p00 = data[cy0 * width + cx0]
  const p10 = data[cy0 * width + cx1]
  const p01 = data[cy1 * width + cx0]
  const p11 = data[cy1 * width + cx1]

  return (
    p00 * (1 - fx) * (1 - fy) +
    p10 * fx * (1 - fy) +
    p01 * (1 - fx) * fy +
    p11 * fx * fy
  )
}

/**
 * Blur the source when the warp is a minification.
 *
 * `sqrt(|det|)` of the linear part is how many source pixels land on one
 * destination pixel along an average direction; when that is comfortably above
 * one, a point sample is reading one of them and discarding the rest.
 */
function applyPrefilter (source: Raster, matrix: Matrix3): Raster {
  const det = Math.abs(matrix[0] * matrix[4] - matrix[1] * matrix[3])
  const scale = Math.sqrt(det)
  if (!Number.isFinite(scale) || scale <= 1.25) return source

  return boxBlurRaster(source, (scale - 1) / 2)
}

function sampleRaster (
  src: Raster,
  u: number,
  v: number,
  interpolation: Interpolation,
  out: Uint8ClampedArray,
  at: number,
): void {
  if (interpolation === 'nearest') {
    const x = clampIndex(Math.round(u), src.width)
    const y = clampIndex(Math.round(v), src.height)
    const i = (y * src.width + x) * 4
    out[at] = src.data[i]
    out[at + 1] = src.data[i + 1]
    out[at + 2] = src.data[i + 2]
    out[at + 3] = src.data[i + 3]

    return
  }

  if (interpolation === 'bicubic') {
    sampleBicubic(src, u, v, out, at)

    return
  }

  const x0 = Math.floor(u)
  const y0 = Math.floor(v)
  const fx = u - x0
  const fy = v - y0
  const cx0 = clampIndex(x0, src.width)
  const cx1 = clampIndex(x0 + 1, src.width)
  const cy0 = clampIndex(y0, src.height)
  const cy1 = clampIndex(y0 + 1, src.height)

  const i00 = (cy0 * src.width + cx0) * 4
  const i10 = (cy0 * src.width + cx1) * 4
  const i01 = (cy1 * src.width + cx0) * 4
  const i11 = (cy1 * src.width + cx1) * 4

  const w00 = (1 - fx) * (1 - fy)
  const w10 = fx * (1 - fy)
  const w01 = (1 - fx) * fy
  const w11 = fx * fy

  for (let c = 0; c < 4; c++)
    out[at + c] =
      src.data[i00 + c] * w00 +
      src.data[i10 + c] * w10 +
      src.data[i01 + c] * w01 +
      src.data[i11 + c] * w11
}

/** Catmull-Rom over a 4x4 neighbourhood: sharper strokes than bilinear when upscaling. */
function sampleBicubic (src: Raster, u: number, v: number, out: Uint8ClampedArray, at: number): void {
  const x0 = Math.floor(u)
  const y0 = Math.floor(v)
  const fx = u - x0
  const fy = v - y0

  const wx = catmullRomWeights(fx)
  const wy = catmullRomWeights(fy)

  for (let c = 0; c < 4; c++) {
    let total = 0
    for (let j = 0; j < 4; j++) {
      const y = clampIndex(y0 - 1 + j, src.height)
      const row = y * src.width
      let rowTotal = 0
      for (let i = 0; i < 4; i++) {
        const x = clampIndex(x0 - 1 + i, src.width)
        rowTotal += src.data[(row + x) * 4 + c] * wx[i]
      }
      total += rowTotal * wy[j]
    }
    out[at + c] = total
  }
}

function catmullRomWeights (t: number): [number, number, number, number] {
  const t2 = t * t
  const t3 = t2 * t

  return [
    0.5 * (-t3 + 2 * t2 - t),
    0.5 * (3 * t3 - 5 * t2 + 2),
    0.5 * (-3 * t3 + 4 * t2 + t),
    0.5 * (t3 - t2),
  ]
}

function writePixel (data: Uint8ClampedArray, at: number, rgba: [number, number, number, number]): void {
  data[at] = rgba[0]
  data[at + 1] = rgba[1]
  data[at + 2] = rgba[2]
  data[at + 3] = rgba[3]
}

function clampIndex (value: number, length: number): number {
  return value < 0 ? 0 : (value >= length ? length - 1 : value)
}
