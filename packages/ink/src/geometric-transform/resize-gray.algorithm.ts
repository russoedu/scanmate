import type { GrayImage, Raster } from '../raster-codec'
import { createGray } from '../raster-codec'

/**
 * Separable resampling: area-average going down, bilinear going up.
 *
 * Going down matters more than it sounds. Point-sampling a 300 dpi scan to
 * half size drops every other row, and on a page of 9pt text that deletes
 * roughly half the strokes — the thumbnail the matcher sees is not a smaller
 * version of the page, it is a different page. Averaging over the exact source
 * footprint of each destination pixel is what keeps the ink where it was.
 */

/** Resize a single channel image to exactly `width x height`. */
export function resizeGray (src: GrayImage, width: number, height: number): GrayImage {
  if (width === src.width && height === src.height) return { ...src, data: Float32Array.from(src.data) }

  const horizontal = new Float32Array(width * src.height)
  resampleRows(src.data, src.width, src.height, horizontal, width)

  const out = createGray(width, height)
  resampleColumns(horizontal, width, src.height, out.data, height)

  return out
}

/**
 * Shrink so the longer side is at most `maxDimension`.
 *
 * Returns the factor applied, because every coordinate the caller recovers in
 * this smaller frame has to be scaled back up by it.
 */
export function downscaleGray (src: GrayImage, maxDimension: number): { image: GrayImage, scale: number } {
  const longest = Math.max(src.width, src.height)
  if (longest <= maxDimension) return { image: { ...src, data: Float32Array.from(src.data) }, scale: 1 }

  const scale = maxDimension / longest
  const width = Math.max(1, Math.round(src.width * scale))
  const height = Math.max(1, Math.round(src.height * scale))

  // The realised scale is what the rounded pixel counts imply, not the request.
  return { image: resizeGray(src, width, height), scale: width / src.width }
}

/**
 * Box blur an RGBA raster with two sliding-window passes.
 *
 * Lives here rather than with the other blurs because its only caller is the
 * warp prefilter, and because it has to work in bytes: a summed-area table over
 * four channels of a 12 megapixel scan is 400 MB, which is not a thing to
 * allocate inside a function app.
 */
export function boxBlurRaster (src: Raster, radius: number): Raster {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return { ...src, data: Uint8ClampedArray.from(src.data) }

  const { width, height } = src
  const temp = new Uint8ClampedArray(width * height * 4)
  const sums = new Int32Array(4)

  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    sums.fill(0)
    let count = 0
    for (let x = 0; x <= Math.min(r, width - 1); x++, count++)
      for (let c = 0; c < 4; c++) sums[c] += src.data[row + x * 4 + c]

    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) temp[row + x * 4 + c] = sums[c] / count

      const leaving = x - r
      const entering = x + r + 1
      if (leaving >= 0) {
        for (let c = 0; c < 4; c++) sums[c] -= src.data[row + leaving * 4 + c]
        count--
      }
      if (entering < width) {
        for (let c = 0; c < 4; c++) sums[c] += src.data[row + entering * 4 + c]
        count++
      }
    }
  }

  const out = new Uint8ClampedArray(width * height * 4)
  const columnSums = new Int32Array(width * 4)
  let count = 0
  for (let y = 0; y <= Math.min(r, height - 1); y++, count++)
    for (let i = 0; i < width * 4; i++) columnSums[i] += temp[y * width * 4 + i]

  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    for (let i = 0; i < width * 4; i++) out[row + i] = columnSums[i] / count

    const leaving = y - r
    const entering = y + r + 1
    if (leaving >= 0) {
      for (let i = 0; i < width * 4; i++) columnSums[i] -= temp[leaving * width * 4 + i]
      count--
    }
    if (entering < height) {
      for (let i = 0; i < width * 4; i++) columnSums[i] += temp[entering * width * 4 + i]
      count++
    }
  }

  return { width, height, data: out }
}

function resampleRows (
  src: Float32Array,
  srcWidth: number,
  rows: number,
  dst: Float32Array,
  dstWidth: number,
): void {
  const ratio = srcWidth / dstWidth

  if (ratio > 1) {
    for (let y = 0; y < rows; y++) {
      const srcRow = y * srcWidth
      const dstRow = y * dstWidth
      for (let x = 0; x < dstWidth; x++) {
        const start = x * ratio
        const end = start + ratio
        dst[dstRow + x] = areaAverage(src, srcRow, srcWidth, start, end)
      }
    }

    return
  }

  for (let y = 0; y < rows; y++) {
    const srcRow = y * srcWidth
    const dstRow = y * dstWidth
    for (let x = 0; x < dstWidth; x++) {
      const pos = clamp((x + 0.5) * ratio - 0.5, 0, srcWidth - 1)
      const i0 = Math.floor(pos)
      const i1 = Math.min(srcWidth - 1, i0 + 1)
      const frac = pos - i0
      dst[dstRow + x] = src[srcRow + i0] * (1 - frac) + src[srcRow + i1] * frac
    }
  }
}

function resampleColumns (
  src: Float32Array,
  width: number,
  srcHeight: number,
  dst: Float32Array,
  dstHeight: number,
): void {
  const ratio = srcHeight / dstHeight
  const column = new Float32Array(srcHeight)

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < srcHeight; y++) column[y] = src[y * width + x]

    if (ratio > 1)
      for (let y = 0; y < dstHeight; y++) {
        const start = y * ratio
        dst[y * width + x] = areaAverage(column, 0, srcHeight, start, start + ratio)
      }
    else
      for (let y = 0; y < dstHeight; y++) {
        const pos = clamp((y + 0.5) * ratio - 0.5, 0, srcHeight - 1)
        const i0 = Math.floor(pos)
        const i1 = Math.min(srcHeight - 1, i0 + 1)
        const frac = pos - i0
        dst[y * width + x] = column[i0] * (1 - frac) + column[i1] * frac
      }
  }
}

/** Mean of `src[offset + start .. offset + end)`, weighting the two partially covered ends. */
function areaAverage (src: Float32Array, offset: number, length: number, start: number, end: number): number {
  const from = Math.max(0, Math.floor(start))
  const to = Math.min(length, Math.ceil(end))
  let total = 0
  let weight = 0

  for (let i = from; i < to; i++) {
    const w = Math.min(end, i + 1) - Math.max(start, i)
    if (w <= 0) continue
    total += src[offset + i] * w
    weight += w
  }

  return weight > 0 ? total / weight : 0
}

function clamp (value: number, min: number, max: number): number {
  return value < min ? min : (Math.min(value, max))
}
