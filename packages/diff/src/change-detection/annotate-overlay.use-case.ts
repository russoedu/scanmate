import type { Raster, Rect, Rgba } from '@scanmate/ink'

/**
 * Outline what the report says onto the overlay, so the picture and the numbers
 * can be checked against each other at a glance.
 *
 * One colour per answer, and the answers are few:
 *
 * | colour | |
 * |---|---|
 * | blue `#0017FC` | the area being asked about, as the original has it |
 * | green `#00FC11` | an expected region that was filled in |
 * | red `#FC0027` | one left empty, covered, or content that changed |
 * | pink `#F500FC` | the band around a region where ink still counts as its own |
 * | orange `#FF8A00` | ink added where nothing was expected |
 * | cyan `#00C8FC` | printed ink the scan lost |
 */

export type { Rgba } from '@scanmate/ink'

/** The area in question, drawn on the original: a statement of where, not of what. */
export const REFERENCE: Rgba = [0, 23, 252, 255]
export const IDENTIFIED: Rgba = [0, 252, 17, 255]
/** Empty, covered, or changed: the answers that need a person. */
export const NOT_IDENTIFIED: Rgba = [252, 0, 39, 255]
export const EXPECTED_MARGIN: Rgba = [245, 0, 252, 255]
export const UNEXPECTED: Rgba = [255, 138, 0, 255]
export const MISSING: Rgba = [0, 200, 252, 255]

export interface Annotation {
  rect:  Rect
  color: Rgba
}

export function annotateOverlay (overlay: Raster, annotations: readonly Annotation[], thickness = 2): void {
  for (const { rect, color } of annotations) {
    const { x, y, width, height } = rect
    fill(overlay, { x, y, width, height: thickness }, color)
    fill(overlay, { x, y: y + height - thickness, width, height: thickness }, color)
    fill(overlay, { x, y, width: thickness, height }, color)
    fill(overlay, { x: x + width - thickness, y, width: thickness, height }, color)
  }
}

/** Fill a rectangle, clipped to the raster - an outline grown past the page edge draws what fits. */
function fill (raster: Raster, rect: Rect, color: Rgba): void {
  const left = Math.max(0, Math.round(rect.x))
  const top = Math.max(0, Math.round(rect.y))
  const right = Math.min(raster.width, Math.round(rect.x + rect.width))
  const bottom = Math.min(raster.height, Math.round(rect.y + rect.height))

  for (let y = top; y < bottom; y++)
    for (let x = left, i = (y * raster.width + left) * 4; x < right; x++, i += 4) {
      raster.data[i] = color[0]
      raster.data[i + 1] = color[1]
      raster.data[i + 2] = color[2]
      raster.data[i + 3] = color[3]
    }
}
