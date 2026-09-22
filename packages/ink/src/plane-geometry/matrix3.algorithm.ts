import type { Matrix3, Point, ScanmateRect, TransformModel, TransformSummary } from './geometry.model'

/**
 * 3x3 homogeneous matrix helpers.
 *
 * ## The one convention that matters
 *
 * Every matrix in this library maps **original coordinates to scanned
 * coordinates**, never the other way round. That reads backwards the first
 * time: we are producing an image on the original's canvas, so we walk the
 * output pixel by pixel and ask "where in the scan does this come from?".
 * Inverse mapping is what stops the output having holes — forward-splatting a
 * rotated source leaves gaps between the splats, like spray-painting through a
 * rotated stencil.
 *
 * Coordinates are continuous, with the centre of pixel `(i, j)` at
 * `(i + 0.5, j + 0.5)`. Sticking to that is what makes {@link conjugateScale}
 * a plain scale conjugation instead of a scale plus a half-pixel fudge.
 */

export const IDENTITY: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** `a * b` — the transform that applies `b` first, then `a`. */
export function multiply (a: Matrix3, b: Matrix3): Matrix3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],

    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],

    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ]
}

export function determinant (m: Matrix3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  )
}

/** Throws when `m` is singular — a transform that collapses the page to a line is never a usable answer. */
export function invert (m: Matrix3): Matrix3 {
  const det = determinant(m)
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12)
    throw new Error('matrix is singular and cannot be inverted')

  const inv = 1 / det

  return [
    (m[4] * m[8] - m[5] * m[7]) * inv,
    (m[2] * m[7] - m[1] * m[8]) * inv,
    (m[1] * m[5] - m[2] * m[4]) * inv,

    (m[5] * m[6] - m[3] * m[8]) * inv,
    (m[0] * m[8] - m[2] * m[6]) * inv,
    (m[2] * m[3] - m[0] * m[5]) * inv,

    (m[3] * m[7] - m[4] * m[6]) * inv,
    (m[1] * m[6] - m[0] * m[7]) * inv,
    (m[0] * m[4] - m[1] * m[3]) * inv,
  ]
}

/** Divide through by `m8` so two matrices describing the same transform compare equal. */
export function normalize (m: Matrix3): Matrix3 {
  const s = m[8]
  if (s === 0 || s === 1) return m

  return [m[0] / s, m[1] / s, m[2] / s, m[3] / s, m[4] / s, m[5] / s, m[6] / s, m[7] / s, 1]
}

export function applyPoint (m: Matrix3, x: number, y: number): Point {
  const w = m[6] * x + m[7] * y + m[8]
  const iw = w === 0 ? 0 : 1 / w

  return { x: (m[0] * x + m[1] * y + m[2]) * iw, y: (m[3] * x + m[4] * y + m[5]) * iw }
}

export function translation (tx: number, ty: number): Matrix3 {
  return [1, 0, tx, 0, 1, ty, 0, 0, 1]
}

export function scaling (sx: number, sy = sx): Matrix3 {
  return [sx, 0, 0, 0, sy, 0, 0, 0, 1]
}

/**
 * Scale `s` and rotation `angleRad` about `pivot`, then land that pivot on `target`.
 *
 * This is the shape the coarse stage produces: "the middle of the original's
 * printed content is the middle of the scan's printed content, turned by this
 * much and this many times bigger".
 */
export function similarity (s: number, angleRad: number, pivot: Point, target: Point): Matrix3 {
  const c = Math.cos(angleRad) * s
  const k = Math.sin(angleRad) * s

  return [
    c, -k, target.x - c * pivot.x + k * pivot.y,
    k, c, target.y - k * pivot.x - c * pivot.y,
    0, 0, 1,
  ]
}

/**
 * Re-express `m` in a coordinate frame scaled by `k`.
 *
 * Fitting runs on downscaled copies because matching 3000x4000 images is a
 * waste; the matrix that comes back speaks in those small pixels. `k` is
 * `working / full`, and the result speaks in full-resolution pixels.
 */
export function conjugateScale (m: Matrix3, k: number): Matrix3 {
  return multiply(scaling(1 / k), multiply(m, scaling(k)))
}

/**
 * Re-express a matrix whose two frames were scaled by different factors.
 *
 * The coarse stage measures on two independently shrunk copies - the original
 * and the scan rarely have the same pixel count, so they rarely shrink by the
 * same factor. `sourceScale` and `targetScale` are each `working / full` for
 * their own side, and the result speaks full-resolution pixels on both.
 */
export function rebase (m: Matrix3, sourceScale: number, targetScale: number): Matrix3 {
  return multiply(scaling(1 / targetScale), multiply(m, scaling(sourceScale)))
}

/** The four corners of `rect` mapped through `m`, clockwise from the top-left. */
export function mapRectCorners (m: Matrix3, rect: ScanmateRect): Point[] {
  const { x, y, width, height } = rect

  return [
    applyPoint(m, x, y),
    applyPoint(m, x + width, y),
    applyPoint(m, x + width, y + height),
    applyPoint(m, x, y + height),
  ]
}

/**
 * Pull a matrix apart into scale, rotation and shear.
 *
 * The 2x2 linear part is factored as `R(theta) * [[sx, k], [0, sy]]`, which is
 * the order a scanner actually applies them: the page is stretched on the
 * glass, then the whole thing sits at an angle.
 */
export function decompose (m: Matrix3, model: TransformModel): TransformSummary {
  const [a, b, , d, e] = m
  const scaleX = Math.hypot(a, d)
  const det = a * e - b * d
  const scaleY = scaleX === 0 ? 0 : det / scaleX
  const shear = scaleX === 0 ? 0 : (a * b + d * e) / scaleX
  const origin = applyPoint(m, 0, 0)

  return {
    model,
    scaleX,
    scaleY,
    rotationDeg: (Math.atan2(d, a) * 180) / Math.PI,
    shearDeg:    (Math.atan2(shear, scaleY || 1) * 180) / Math.PI,
    translation: origin,
    perspective: { x: m[6], y: m[7] },
  }
}

/** Euclidean distance between `m * source` and `target`, in target pixels. */
export function reprojectionError (m: Matrix3, source: Point, target: Point): number {
  const p = applyPoint(m, source.x, source.y)

  return Math.hypot(p.x - target.x, p.y - target.y)
}
