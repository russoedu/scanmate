import type { Raster, Rect } from '@scanmate/ink'

/**
 * Outline what the report says onto the overlay, so the picture and the numbers
 * can be checked against each other at a glance: green for an expected region
 * that was filled in, amber for one that was not, orange for the band around it
 * where ink still counts as that region's - the room a signature is given to
 * stray - magenta around every change nobody expected, and blue - the overlay's
 * colour for lost ink - around ink that went missing.
 */

export type Rgba = readonly [number, number, number, number]

export const IDENTIFIED: Rgba = [30, 160, 70, 255]
export const NOT_IDENTIFIED: Rgba = [230, 150, 20, 255]
export const EXPECTED_MARGIN: Rgba = [250, 120, 30, 255]
export const UNEXPECTED: Rgba = [200, 30, 190, 255]
export const MISSING: Rgba = [20, 90, 230, 255]

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
