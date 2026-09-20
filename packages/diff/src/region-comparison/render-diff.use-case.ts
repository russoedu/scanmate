import type { ImageInput, Raster, Rgba } from '@scanmate/ink'
import { buildMasks } from './ink-masks.use-case'
import type { Masks } from './ink-masks.use-case'
import type { RegionOptions } from './region.model'

/**
 * An RGBA overlay of the comparison, for looking at with your own eyes.
 *
 * Violet is ink the two pages do not share - added by the scan or lost from the
 * print, which the picture does not distinguish; grey is ink they agree on. A
 * correctly aligned pair of a signed form is almost entirely grey with a violet
 * signature; a misaligned one is violet confetti along every stroke, which is
 * the fastest way to tell the two failures apart.
 *
 * Which side the ink came from is a question for the report, where it is
 * measured separately and in millimetres. Here it would be a second colour
 * carrying a distinction the eye does not need at this zoom.
 */
export async function renderDiff (
  original: ImageInput,
  aligned: ImageInput,
  options: RegionOptions = {},
): Promise<Raster> {
  const { tolerance = 2, ink, faintInk } = options
  const masks = await buildMasks(original, aligned, ink, tolerance, faintInk)

  return paintOverlay(masks)
}

/**
 * Ink the two pages do not share. Violet rather than red, because red means
 * "changed" on every annotated page in the pipeline and one colour cannot mean
 * two things.
 */
export const OVERLAY_DIFFERENT: Rgba = [127, 0, 252, 255]
/** Ink the two pages agree on. */
export const OVERLAY_SHARED: Rgba = [110, 110, 110, 255]

/** The overlay, from masks already built. Violet where they differ, grey where they agree, white paper. */
export function paintOverlay (masks: Masks): Raster {
  const { width, height } = masks
  const data = new Uint8ClampedArray(width * height * 4)

  for (let i = 0, p = 0; p < width * height; p++, i += 4) {
    const inOriginal = masks.original.data[p] === 1
    const inScan = masks.scan.data[p] === 1
    const nearOriginal = masks.originalDilated.data[p] === 1

    let r = 255
    let g = 255
    let b = 255

    const added = inScan && !nearOriginal
    const lost = inOriginal && masks.scanDilated.data[p] === 0
    if (added || lost) [r, g, b] = OVERLAY_DIFFERENT
    else if (inOriginal || inScan) [r, g, b] = OVERLAY_SHARED

    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }

  return { width, height, data }
}
