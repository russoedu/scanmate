import { createBinary, dilate } from '@scanmate/ink'
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
  const { inset = 0.2, minTickArea = 0.6, struckFill = 0.5, struckErosion = 0.4, dpi } = options
  const toPixels = dpi / 72
  const mm2PerPixel = (25.4 / dpi) ** 2
  // What a stroke cannot survive: a mark is thin, a box inked over is not.
  const radius = Math.max(1, Math.round(struckErosion / 25.4 * dpi))
  const judge = (mask: BinaryImage, window: Window, inside: number): CheckboxSide => {
    const ink = inkIn(mask, window)
    const area = ink * mm2PerPixel
    const fill = inside === 0 ? 0 : ink / inside
    const solid = inside === 0 ? 0 : solidIn(mask, window, radius) / inside

    return { state: stateOf(area, fill, solid, minTickArea, struckFill), ink: area, fill, solid }
  }

  return boxes.map((box) => {
    const margin = Math.min(box.width, box.height) * inset
    const left = Math.max(0, Math.round((box.x + margin) * toPixels))
    const top = Math.max(0, Math.round((box.y + margin) * toPixels))
    const right = Math.min(masks.width, Math.round((box.x + box.width - margin) * toPixels))
    const bottom = Math.min(masks.height, Math.round((box.y + box.height - margin) * toPixels))
    const inside = Math.max(0, right - left) * Math.max(0, bottom - top)

    const window = { left, top, right, bottom }
    const original = judge(masks.original, window, inside)
    const scanned = judge(masks.scan, window, inside)
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

function stateOf (area: number, fill: number, solid: number, minTickArea: number, struckFill: number): CheckboxState {
  if (solid >= struckFill) return 'struck'

  return area >= minTickArea ? 'ticked' : 'empty'
}

/** A window of a mask, in pixels. */
interface Window { left: number, top: number, right: number, bottom: number }

/** The window's ink as its own image. */
function crop (mask: BinaryImage, { left, top, right, bottom }: Window): BinaryImage {
  const width = Math.max(0, right - left)
  const height = Math.max(0, bottom - top)
  const out = createBinary(width, height)
  for (let y = 0; y < height; y++) out.data.set(mask.data.subarray((top + y) * mask.width + left, (top + y) * mask.width + left + width), y * width)

  return out
}

/**
 * Ink that survives an erosion of `radius`: what is left of a mark when every
 * edge is eaten away. A stroke disappears; a box inked over does not.
 *
 * Erosion is a dilation of the background, inverted - `dilate` is the kernel
 * this package has, and the two are the same operation seen from either side.
 */
function solidIn (mask: BinaryImage, window: Window, radius: number): number {
  const inside = crop(mask, window)
  const background = createBinary(inside.width, inside.height)
  for (const [i, value] of inside.data.entries()) background.data[i] = value === 1 ? 0 : 1
  const grown = dilate(background, radius)

  return grown.data.reduce((sum, value) => sum + (value === 1 ? 0 : 1), 0)
}

/** Ink pixels inside a window of a mask, less the grain. */
function inkIn (mask: BinaryImage, window: Window): number {
  const inside = crop(mask, window)
  if (inside.width === 0 || inside.height === 0) return 0

  return connectedComponents(inside)
    .filter(component => component.pixels >= GRAIN)
    .reduce((sum, component) => sum + component.pixels, 0)
}
