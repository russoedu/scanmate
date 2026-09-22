import { createRandom } from '../deterministic-sampling'
import { boxBlurRaster, warpRaster } from '../geometric-transform'
import type { Matrix3, ScanmateRect } from '../plane-geometry'
import { invert, multiply, scaling, translation } from '../plane-geometry'
import type { Raster } from '../raster-codec'

/**
 * Synthetic pages, and synthetic scans of them.
 *
 * Alignment is awkward to test honestly: with two real images you have no
 * ground truth, only an opinion about whether the output looks right. Generate
 * the page and then the distortion yourself and you know the exact matrix the
 * estimator is supposed to recover, so a test can assert a number of pixels
 * instead of a feeling.
 *
 * It is exported rather than kept in the test folder because the same trick is
 * how you smoke-test a deployment: generate, distort, align, check the error is
 * small, all without shipping sample scans.
 */

export interface DocumentOptions {
  width?:        number
  height?:       number
  seed?:         number
  /** Where a signature would go. Left empty by {@link createSyntheticDocument}. */
  signatureBox?: ScanmateRect
}

export interface SyntheticDocument {
  raster:  Raster
  /** Rectangles a caller may want to inspect later: the signature box, the tick boxes. */
  regions: Record<string, ScanmateRect>
}

export interface ScanOptions {
  rotationDeg?:  number
  /** Size of the scan relative to the page. `1.5` is roughly 300 dpi against a 200 dpi render. */
  scale?:        number
  translateX?:   number
  translateY?:   number
  /** Standard deviation of additive sensor noise, in `[0, 1]` units. */
  noise?:        number
  /** Box blur radius, standing in for an out-of-focus or low-quality scan. */
  blur?:         number
  /** Strength of a diagonal lighting ramp, in `[0, 1]`. `0.3` is a pronounced shadow. */
  illumination?: number
  /** Scan canvas. Defaults to the page scaled by `scale`, so the whole page fits. */
  canvas?:       { width: number, height: number }
  seed?:         number
}

export interface SimulatedScan {
  raster: Raster
  /** Ground truth: maps original coordinates to scanned coordinates. */
  matrix: Matrix3
}

/**
 * A plausible printed form: header rule, paragraphs, a table, tick boxes, a
 * signature box. Deterministic for a given seed.
 */
export function createSyntheticDocument (options: DocumentOptions = {}): SyntheticDocument {
  const { width = 850, height = 1100, seed = 42 } = options
  const random = createRandom(seed)
  const page: Raster = { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) }

  // The layout is written once against a nominal 850x1100 page and scaled to
  // whatever was asked for. Laying it out in absolute pixels instead means a
  // smaller page silently loses its last few elements off the bottom edge -
  // including, on a form, the signature box.
  const scale = Math.min(width / 850, height / 1100)
  const unit = (value: number): number => value * scale

  const margin = Math.round(unit(76))
  const right = width - margin
  const lineHeight = Math.max(4, unit(21))
  const textHeight = Math.max(2, Math.round(unit(9)))
  let y = margin

  fillRect(page, { x: margin, y, width: Math.round((right - margin) * 0.44), height: Math.max(3, unit(26)) }, 20)
  y += unit(54)

  drawLine(page, margin, y, right, y, Math.max(1, unit(3)), 40)
  y += unit(34)

  // Fixed line counts rather than random ones, so the page always fits.
  for (const lines of [3, 4, 5, 6]) {
    for (let line = 0; line < lines; line++) {
      drawTextLine(page, margin, y, right, textHeight, random)
      y += lineHeight
    }
    y += unit(18)
  }

  const tableTop = y
  const rows = 5
  const columns = 4
  const rowHeight = Math.max(6, unit(30))
  const columnWidth = (right - margin) / columns
  const ruleWidth = Math.max(1, unit(2))
  for (let r = 0; r <= rows; r++)
    drawLine(page, margin, tableTop + r * rowHeight, right, tableTop + r * rowHeight, ruleWidth, 60)
  for (let c = 0; c <= columns; c++)
    drawLine(page, margin + c * columnWidth, tableTop, margin + c * columnWidth, tableTop + rows * rowHeight, ruleWidth, 60)

  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++)
      drawTextLine(
        page,
        margin + c * columnWidth + unit(8),
        tableTop + r * rowHeight + rowHeight * 0.36,
        margin + (c + 1) * columnWidth - unit(8),
        textHeight,
        random,
      )

  y = tableTop + rows * rowHeight + unit(46)

  const regions: Record<string, ScanmateRect> = {}
  const boxSize = Math.max(6, Math.round(unit(18)))
  for (let i = 0; i < 3; i++) {
    const box: ScanmateRect = { x: margin + i * unit(150), y, width: boxSize, height: boxSize }
    strokeRect(page, box, Math.max(1, unit(2)), 30)
    regions[`tick-${i + 1}`] = box
  }
  y += unit(70)

  const signature: ScanmateRect = options.signatureBox ?? {
    x:      margin,
    y,
    width:  Math.round((right - margin) * 0.55),
    height: Math.max(12, Math.round(unit(78))),
  }
  strokeRect(page, signature, Math.max(1, unit(2)), 30)
  regions.signature = signature

  regions.stamp = {
    x:      right - Math.round(unit(150)),
    y,
    width:  Math.round(unit(150)),
    height: signature.height,
  }

  return { raster: page, regions }
}

/** Scribble inside a rectangle, the way a signature crosses a signature box. */
export function drawSignature (page: Raster, box: ScanmateRect, seed = 7): void {
  const random = createRandom(seed)
  const points = 9
  const baseline = box.y + box.height * 0.62
  let previousX = box.x + box.width * 0.06
  let previousY = baseline

  for (let i = 1; i <= points; i++) {
    const x = box.x + box.width * (0.06 + (0.86 * i) / points)
    const y = baseline - box.height * (0.05 + random() * 0.42) * (i % 2 === 0 ? 1 : -0.45)
    drawLine(page, previousX, previousY, x, y, 3, 25)
    previousX = x
    previousY = y
  }
}

/** Fill a tick box, the way a pen does. */
export function drawTick (page: Raster, box: ScanmateRect): void {
  const { x, y, width, height } = box
  drawLine(page, x + width * 0.15, y + height * 0.5, x + width * 0.42, y + height * 0.82, 3, 20)
  drawLine(page, x + width * 0.42, y + height * 0.82, x + width * 0.88, y + height * 0.12, 3, 20)
}

/**
 * Put a page through everything a scanner does to it, and report the matrix used.
 *
 * Order matters and mirrors the physical one: the page is placed on the glass
 * somewhere, at some angle, and sampled at some resolution (the geometry);
 * then the lamp falls off towards one corner, the optics blur, and the sensor
 * adds noise (the photometry). Estimators that only ever see clean geometric
 * distortion pass tests and fail on real scans.
 */
export function simulateScan (page: Raster, options: ScanOptions = {}): SimulatedScan {
  const {
    rotationDeg = 0,
    scale = 1,
    translateX = 0,
    translateY = 0,
    noise = 0,
    blur = 0,
    illumination = 0,
    seed = 1234,
  } = options

  const canvas = options.canvas ?? {
    width:  Math.max(8, Math.round(page.width * scale)),
    height: Math.max(8, Math.round(page.height * scale)),
  }

  const angle = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const cx = page.width / 2
  const cy = page.height / 2

  // Rotate about the page centre, scale, then place that centre in the middle
  // of the scan canvas plus the requested offset.
  const rotateAboutCentre: Matrix3 = [
    cos, -sin, cx - cos * cx + sin * cy,
    sin, cos, cy - sin * cx - cos * cy,
    0, 0, 1,
  ]
  const place = translation(
    canvas.width / 2 - cx * scale + translateX,
    canvas.height / 2 - cy * scale + translateY,
  )
  const forward = multiply(place, multiply(scaling(scale), rotateAboutCentre))

  let raster = warpRaster(page, invert(forward), canvas.width, canvas.height, {
    background:    [255, 255, 255, 255],
    interpolation: 'bilinear',
    prefilter:     true,
  })

  if (blur > 0) raster = boxBlurRaster(raster, blur)
  if (illumination > 0) applyIllumination(raster, illumination)
  if (noise > 0) applyNoise(raster, noise, seed)

  return { raster, matrix: forward }
}

/** A diagonal ramp plus a soft corner shadow: the two things a phone camera always adds. */
function applyIllumination (raster: Raster, strength: number): void {
  const { width, height, data } = raster
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width
      const v = y / height
      const ramp = 1 - strength * (0.35 * u + 0.65 * v)
      const corner = 1 - strength * 0.8 * Math.max(0, 1 - Math.hypot(u, v) * 1.3)
      const factor = ramp * corner
      const i = (y * width + x) * 4
      data[i] *= factor
      data[i + 1] *= factor
      data[i + 2] *= factor
    }
  }
}

function applyNoise (raster: Raster, sigma: number, seed: number): void {
  const random = createRandom(seed)
  const amplitude = sigma * 255
  for (let i = 0; i < raster.data.length; i += 4) {
    const n = (random() + random() + random() - 1.5) * 2 * amplitude
    raster.data[i] += n
    raster.data[i + 1] += n
    raster.data[i + 2] += n
  }
}

/** One line of "text": dark blocks of word-ish widths with gaps between them. */
function drawTextLine (
  page: Raster,
  x0: number,
  y: number,
  x1: number,
  height: number,
  random: () => number,
): void {
  const unit = height / 9
  let x = x0
  while (x < x1 - 12 * unit) {
    const word = (14 + Math.floor(random() * 46)) * unit
    const end = Math.min(x1, x + word)
    fillRect(page, { x, y, width: end - x, height }, 35 + Math.floor(random() * 40))
    x = end + (6 + Math.floor(random() * 6)) * unit
  }
}

export function fillRect (page: Raster, rect: ScanmateRect, value: number): void {
  const left = Math.max(0, Math.round(rect.x))
  const top = Math.max(0, Math.round(rect.y))
  const right = Math.min(page.width, Math.round(rect.x + rect.width))
  const bottom = Math.min(page.height, Math.round(rect.y + rect.height))

  for (let y = top; y < bottom; y++) {
    let i = (y * page.width + left) * 4
    for (let x = left; x < right; x++, i += 4) {
      page.data[i] = value
      page.data[i + 1] = value
      page.data[i + 2] = value
      page.data[i + 3] = 255
    }
  }
}

export function strokeRect (page: Raster, rect: ScanmateRect, thickness: number, value: number): void {
  const { x, y, width, height } = rect
  fillRect(page, { x, y, width, height: thickness }, value)
  fillRect(page, { x, y: y + height - thickness, width, height: thickness }, value)
  fillRect(page, { x, y, width: thickness, height }, value)
  fillRect(page, { x: x + width - thickness, y, width: thickness, height }, value)
}

export function drawLine (
  page: Raster,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness: number,
  value: number,
): void {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) + 1
  const half = thickness / 2

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    fillRect(
      page,
      { x: x0 + (x1 - x0) * t - half, y: y0 + (y1 - y0) * t - half, width: thickness, height: thickness },
      value,
    )
  }
}
