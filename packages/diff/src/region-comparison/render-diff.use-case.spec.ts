import { cloneRaster, createSyntheticDocument, drawSignature, drawTick } from '@scanmate/ink'
import type { Raster } from '@scanmate/ink'

import { OVERLAY_DIFFERENT, OVERLAY_SHARED, renderDiff } from './render-diff.use-case'

const BLANK = createSyntheticDocument({ width: 520, height: 680, seed: 3 })

/** The same form, filled in: signed, with the first box ticked. */
function filledForm (): Raster {
  const page = cloneRaster(BLANK.raster)
  drawSignature(page, BLANK.regions.signature, 5)
  drawTick(page, BLANK.regions['tick-1'])

  return page
}

describe('renderDiff', () => {
  it('paints ink the two do not share violet, and agreed ink grey', async () => {
    const overlay = await renderDiff(BLANK.raster, filledForm())

    let added = 0
    let grey = 0
    for (let i = 0; i < overlay.data.length; i += 4) {
      const pixel = [overlay.data[i], overlay.data[i + 1], overlay.data[i + 2]]
      if (pixel.every((value, channel) => value === OVERLAY_DIFFERENT[channel])) added++
      else if (pixel.every((value, channel) => value === OVERLAY_SHARED[channel])) grey++
    }

    expect(added).toBeGreaterThan(200)
    expect(grey).toBeGreaterThan(added)
    expect(overlay.width).toBe(BLANK.raster.width)
  })
})
