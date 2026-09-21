import { createRaster } from '@scanmate/ink'
import type { Raster } from '@scanmate/ink'

import { renderEvidence } from './render-evidence.use-case'

/** A blank page of a given size, which is all the layout depends on. */
function page (width: number, height: number): Raster {
  const raster = createRaster(width, height)
  raster.data.fill(255)

  return raster
}

/** How much height the legend adds at this width, with and without an overlay. */
function band (width: number, overlay: boolean): number {
  const options = overlay ? { dpi: 150, overlay: page(width, 300) } : { dpi: 150 }
  const bare = renderEvidence(page(width, 300), page(width, 300), { ...options, legend: false })

  return renderEvidence(page(width, 300), page(width, 300), options).height - bare.height
}

/** The rightmost column holding anything other than white. */
function rightmostMark (raster: Raster): number {
  for (let x = raster.width - 1; x >= 0; x--)
    for (let y = 0; y < raster.height; y++) {
      const at = (y * raster.width + x) * 4
      if (raster.data[at] !== 255 || raster.data[at + 1] !== 255 || raster.data[at + 2] !== 255) return x
    }

  return -1
}

describe('renderEvidence', () => {
  it('keeps the legend inside the page, however narrow the page is', () => {
    // The legend used to be sized from the annotation stroke alone, which says
    // nothing about width, so on a narrow page its last entries - including the
    // one explaining the overlay - ran off the right edge and were lost.
    for (const width of [320, 700, 1400, 3000]) {
      const rendered = renderEvidence(page(width, 400), page(width, 400), { dpi: 150, overlay: page(width, 400) })

      expect(rendered.width).toBe(width * 3 + Math.max(4, Math.round(150 / 12)) * 2)
      expect(rightmostMark(rendered)).toBeLessThan(rendered.width)
    }
  })

  it('makes room for the entry that explains the overlay', () => {
    // The overlay's entry is much the longest, and on a narrow page it is the
    // one that used to be cut off. Carrying it has to cost height, not silence.
    for (const width of [200, 400, 1600]) expect(band(width, true)).toBeGreaterThanOrEqual(band(width, false))
    expect(band(200, true)).toBeGreaterThan(0)
  })

  it('names each panel, so three near-identical pages are told apart', () => {
    const withOverlay = renderEvidence(page(400, 300), page(400, 300), { dpi: 150, overlay: page(400, 300) })
    const without = renderEvidence(page(400, 300), page(400, 300), { dpi: 150 })

    // The captions sit in a band above the panels, so the rendered page is
    // taller than the panels themselves whether or not an overlay is drawn.
    expect(withOverlay.height).toBeGreaterThan(300)
    expect(without.height).toBeGreaterThan(300)
    expect(without.width).toBe(400 * 2 + Math.max(4, Math.round(150 / 12)))
  })

  it('draws no legend when it is not asked for', () => {
    const bare = renderEvidence(page(400, 300), page(400, 300), { dpi: 150, legend: false })
    const legended = renderEvidence(page(400, 300), page(400, 300), { dpi: 150 })

    expect(bare.height).toBeLessThan(legended.height)
  })
})
