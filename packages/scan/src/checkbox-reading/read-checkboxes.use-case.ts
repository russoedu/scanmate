import type { AlignedPage, BinaryImage } from '@scanmate/ink'

import { connectedComponents } from '../change-detection'
import { buildMasks } from '../region-comparison'
import type { Masks } from '../region-comparison'
import type { Checkbox, CheckboxOptions, CheckboxReading, CheckboxSide, CheckboxState } from './checkbox.contract'

/** Pieces of ink smaller than this, in pixels, are grain: the same rule the change detection applies. */
const GRAIN = 2

/**
 * Which boxes are ticked, on the original and on the returned scan.
 *
 * A form is full of them, and the question about each is plain: ticked or
 * not. It is not the question an expected region answers. A region asks
 * whether ink was *added*, so a box ticked before it was issued reads as
 * untouched, and one left empty - often the right answer - reads as a field
 * someone forgot. So each side is read on its own terms: the ink inside the box,
 * past its printed frame, gives that side a state, and the two are compared.
 *
 * Reads the aligned scan: align first.
 */
export async function readCheckboxes (pages: readonly AlignedPage[], boxes: readonly Checkbox[], options: CheckboxOptions = {}): Promise<CheckboxReading[]> {
  const { tolerance = 2, assumeDpi = 150, ink } = options
  const readings: CheckboxReading[] = []

  for (const page of pages) {
    const onPage = boxes.filter(box => box.page === page.page)
    if (onPage.length === 0) continue
    const masks = await buildMasks(page.original.raster, page.aligned.raster, ink, tolerance)
    readings.push(...checkboxesFromMasks(masks, onPage, { ...options, dpi: page.original.dpi ?? assumeDpi }))
  }

  return readings
}

/**
 * {@link readCheckboxes} on masks already built - which the pixel comparison
 * builds anyway, so an audit reads its boxes for nothing.
 */
export function checkboxesFromMasks (masks: Masks, boxes: readonly Checkbox[], options: CheckboxOptions & { dpi: number }): CheckboxReading[] {
  const { inset = 0.2, minTickArea = 0.6, struckFill = 0.5, dpi } = options
  const toPixels = dpi / 72
  const mm2PerPixel = (25.4 / dpi) ** 2
  const judge = (ink: number, inside: number): CheckboxSide => {
    const area = ink * mm2PerPixel
    const fill = inside === 0 ? 0 : ink / inside

    return { state: stateOf(area, fill, minTickArea, struckFill), ink: area, fill }
  }

  return boxes.map((box) => {
    const margin = Math.min(box.width, box.height) * inset
    const left = Math.max(0, Math.round((box.x + margin) * toPixels))
    const top = Math.max(0, Math.round((box.y + margin) * toPixels))
    const right = Math.min(masks.width, Math.round((box.x + box.width - margin) * toPixels))
    const bottom = Math.min(masks.height, Math.round((box.y + box.height - margin) * toPixels))
    const inside = Math.max(0, right - left) * Math.max(0, bottom - top)

    const original = judge(inkIn(masks.original, left, top, right, bottom), inside)
    const scanned = judge(inkIn(masks.scan, left, top, right, bottom), inside)
    const expect = box.expect ?? null

    return {
      id:        box.id,
      page:      box.page,
      box:       { x: box.x, y: box.y, width: box.width, height: box.height },
      original,
      scanned,
      changed:   original.state !== scanned.state,
      expect,
      satisfied: expect === null ? null : scanned.state === expect,
    }
  })
}

function stateOf (area: number, fill: number, minTickArea: number, struckFill: number): CheckboxState {
  if (fill >= struckFill) return 'struck'

  return area >= minTickArea ? 'ticked' : 'empty'
}

/** Ink pixels inside a window of a mask, less the grain. */
function inkIn (mask: BinaryImage, left: number, top: number, right: number, bottom: number): number {
  const width = Math.max(0, right - left)
  const height = Math.max(0, bottom - top)
  if (width === 0 || height === 0) return 0

  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) data.set(mask.data.subarray((top + y) * mask.width + left, (top + y) * mask.width + left + width), y * width)

  return connectedComponents({ width, height, data })
    .filter(component => component.pixels >= GRAIN)
    .reduce((sum, component) => sum + component.pixels, 0)
}
