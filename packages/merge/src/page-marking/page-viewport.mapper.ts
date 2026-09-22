/**
 * The page as a reader sees it, and the way back to the PDF's own coordinates.
 *
 * A mark is measured the way `@scanmate/extract` reports text: from the top-left
 * of the page as displayed, in points, with the page's `/Rotate` and crop box
 * already applied. pdf-lib draws in the PDF's own user space instead: from the
 * bottom-left of the media box, before any rotation.
 *
 * Getting from one to the other is the whole difficulty of drawing a mark in
 * the right place, and doing it approximately would defeat the purpose - a
 * helper for checking positions that is wrong on rotated or cropped pages gives
 * false confidence on exactly the pages that most need checking.
 *
 * So this is pdf.js's own `PageViewport` transform at scale 1, ported line for
 * line rather than re-derived, and inverted. The text a mark was measured from
 * and the box drawn for it then go through the same arithmetic in opposite
 * directions.
 */

/** A two-dimensional affine transform, `[a, b, c, d, e, f]` as PDF writes them. */
export type Affine = readonly [number, number, number, number, number, number]

/** The page's visible box, `[x0, y0, x1, y1]` in user space, and its rotation. */
export interface PageGeometry {
  view:     readonly [number, number, number, number]
  rotation: number
}

/** User space to what a reader sees - pdf.js's `PageViewport` at scale 1. */
export function viewportTransform ({ view, rotation }: PageGeometry): Affine {
  const centerX = (view[2] + view[0]) / 2
  const centerY = (view[3] + view[1]) / 2
  const [a, b, c, d] = rotationOf(rotation)

  const quarter = a === 0
  const offsetX = quarter ? Math.abs(centerY - view[1]) : Math.abs(centerX - view[0])
  const offsetY = quarter ? Math.abs(centerX - view[0]) : Math.abs(centerY - view[1])

  return [a, b, c, d, offsetX - a * centerX - c * centerY, offsetY - b * centerX - d * centerY]
}

/** How large the page is as a reader sees it: a quarter turn swaps width and height. */
export function viewportSize ({ view, rotation }: PageGeometry): { width: number, height: number } {
  const [a] = rotationOf(rotation)
  const across = view[2] - view[0]
  const down = view[3] - view[1]

  return a === 0 ? { width: down, height: across } : { width: across, height: down }
}

/** A point a reader sees, back in the PDF's own coordinates. */
export function toUserSpace ([a, b, c, d, e, f]: Affine, x: number, y: number): { x: number, y: number } {
  const det = a * d - b * c
  const dx = x - e
  const dy = y - f

  // `+ 0` turns a negative zero positive: harmless to draw at, noisy to read back.
  return { x: (d * dx - c * dy) / det + 0, y: (-b * dx + a * dy) / det + 0 }
}

/**
 * pdf.js's rotation matrix for a page turned by `rotation` degrees.
 *
 * Only quarter turns are legal in a PDF; anything else is refused here exactly
 * as pdf.js refuses it, rather than drawn somewhere plausible.
 */
function rotationOf (rotation: number): readonly [number, number, number, number] {
  const matrix = ROTATIONS.get(((rotation % 360) + 360) % 360)
  if (matrix === undefined) throw new RangeError(`a page may only be rotated by a multiple of 90 degrees, and is rotated by ${rotation}`)

  return matrix
}

/** pdf.js's `rotateA` to `rotateD`, by quarter turn. */
const ROTATIONS: ReadonlyMap<number, readonly [number, number, number, number]> = new Map([
  [0, [1, 0, 0, -1]],
  [90, [0, 1, 1, 0]],
  [180, [-1, 0, 0, 1]],
  [270, [0, -1, -1, 0]],
])
