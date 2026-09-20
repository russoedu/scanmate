import { createRaster } from '@scanmate/ink'
import type { Raster } from '@scanmate/ink'

import { annotateOverlay } from './annotate-overlay.use-case'
import type { Annotation, Rgba } from './annotate-overlay.use-case'

/**
 * The original and the aligned scan next to each other, boxed.
 *
 * The overlay answers "which pixels changed"; this answers "show me", for the
 * person who has to agree with the verdict. Because the scan is aligned onto
 * the original's canvas, a box drawn at the same place on each half surrounds
 * the same part of the page in both, so the eye goes straight from the empty
 * field on the left to the signature on the right.
 *
 * The two halves can say different things, and usually should: the original's
 * half states *where* the question is, in one colour, and the scan's half
 * states the answer, in the colour of that answer.
 */

/** Separator between the halves: mid grey, so it shows against white paper and a grey scan alike. */
const GUTTER: Rgba = [150, 150, 150, 255]

/** What to draw on each half, when the two differ. An array draws the same on both. */
export interface SideAnnotations {
  original?: readonly Annotation[]
  scanned?:  readonly Annotation[]
}

/** One panel of a composition: an image, and what to draw on it. */
export interface Panel {
  raster:       Raster
  annotations?: readonly Annotation[]
}

/**
 * Several images in a row on one canvas, each with its own boxes, separated by
 * a grey gutter - the original, the scan, and the overlay of the two, say.
 *
 * @param panels - The images, left to right.
 * @param thickness - Outline thickness, in pixels.
 * @param gutter - Pixels between panels.
 * @returns One image, as wide as the panels and their gutters.
 */
export function composePanels (panels: readonly Panel[], thickness: number, gutter: number): Raster {
  const width = panels.reduce((sum, panel) => sum + panel.raster.width, 0) + gutter * Math.max(0, panels.length - 1)
  const height = Math.max(...panels.map(panel => panel.raster.height))
  const result = createRaster(width, height)

  let left = 0
  for (const [index, panel] of panels.entries()) {
    paste(result, panel.raster, left)
    annotateOverlay(result, (panel.annotations ?? []).map(a => ({ ...a, rect: { ...a.rect, x: a.rect.x + left } })), thickness)
    left += panel.raster.width
    if (index < panels.length - 1) {
      for (let y = 0; y < height; y++)
        for (let x = left; x < left + gutter; x++) result.data.set(GUTTER, (y * result.width + x) * 4)
      left += gutter
    }
  }

  return result
}

export function composeSideBySide (
  original: Raster,
  aligned: Raster,
  annotations: readonly Annotation[] | SideAnnotations,
  thickness: number,
  gutter: number,
): Raster {
  const sides = Array.isArray(annotations)
    ? { original: annotations, scanned: annotations }
    : annotations as SideAnnotations

  return composePanels([
    { raster: original, annotations: sides.original },
    { raster: aligned, annotations: sides.scanned },
  ], thickness, gutter)
}

function paste (target: Raster, source: Raster, left: number): void {
  const rowBytes = source.width * 4
  for (let y = 0; y < source.height; y++)
    target.data.set(source.data.subarray(y * rowBytes, (y + 1) * rowBytes), (y * target.width + left) * 4)
}
