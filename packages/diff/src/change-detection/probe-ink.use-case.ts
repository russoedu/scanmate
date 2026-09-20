import type { Rect } from '@scanmate/ink'

import type { Masks } from '../region-comparison'
import type { CoordinateUnits, InkProbe } from './page-diff.contract'

/**
 * What the ink does inside places the caller names, changed or not.
 *
 * The rest of this subfeature starts from a change and asks where it is. This
 * asks the opposite question - *how much ink is here?* - and it exists to
 * settle an argument. A reading that disagrees with the original is not by
 * itself a change: OCR misreads small, faint and sideways print, and identical
 * ink under a word means identical characters whatever they were read as.
 *
 * It is separate from `diffPage` because the places worth asking about are
 * usually not known until the page has been read, which happens alongside the
 * pixel comparison rather than before it.
 *
 * @param masks - The ink masks of the pair, from `diffPage` or `buildMasks`.
 * @param rects - Where to measure, in `units`.
 * @param options - How to read `rects`, and the resolution they are in.
 * @returns One probe per rectangle, in the same order, in square millimetres.
 */
export function probeInk (
  masks: Masks,
  rects: readonly Rect[],
  options: { dpi?: number, units?: CoordinateUnits } = {},
): InkProbe[] {
  const { dpi = 150, units = 'points' } = options
  const toPixels = units === 'points' ? dpi / 72 : 1
  const pixelsPerMm = dpi / 25.4
  const mm2PerPixel = 1 / (pixelsPerMm * pixelsPerMm)

  return rects.map((rect) => {
    const ink = inkWithin({ x: rect.x * toPixels, y: rect.y * toPixels, width: rect.width * toPixels, height: rect.height * toPixels }, masks)

    return {
      rect,
      addedInk:  ink.added * mm2PerPixel,
      lostInk:   ink.lost * mm2PerPixel,
      sharedInk: ink.shared * mm2PerPixel,
    }
  })
}

/** Added, lost and shared ink inside one rectangle of the page, in pixels. */
export function inkWithin (rect: Rect, masks: Masks): { added: number, lost: number, shared: number } {
  const left = Math.max(0, Math.floor(rect.x))
  const top = Math.max(0, Math.floor(rect.y))
  const right = Math.min(masks.width, Math.ceil(rect.x + rect.width))
  const bottom = Math.min(masks.height, Math.ceil(rect.y + rect.height))
  let added = 0
  let lost = 0
  let shared = 0

  for (let y = top; y < bottom; y++) {
    const row = y * masks.width
    for (let x = left; x < right; x++) {
      const scan = masks.scan.data[row + x] === 1
      const print = masks.original.data[row + x] === 1
      if (scan && masks.originalDilated.data[row + x] === 0) added++
      if (print && masks.scanDilated.data[row + x] === 0) lost++
      if (scan && print) shared++
    }
  }

  return { added, lost, shared }
}
