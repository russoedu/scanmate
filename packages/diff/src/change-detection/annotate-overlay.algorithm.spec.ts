import { createRaster } from '@scanmate/ink'

import { annotateOverlay, IDENTIFIED, UNEXPECTED } from './annotate-overlay.use-case'

function pixel (raster: ReturnType<typeof createRaster>, x: number, y: number): number[] {
  const i = (y * raster.width + x) * 4

  return [...raster.data.slice(i, i + 4)]
}

describe('annotateOverlay', () => {
  it('outlines a rectangle and leaves its inside alone', () => {
    const overlay = createRaster(40, 40)
    annotateOverlay(overlay, [{ rect: { x: 10, y: 10, width: 20, height: 20 }, color: IDENTIFIED }], 2)

    expect(pixel(overlay, 10, 10)).toEqual([...IDENTIFIED])
    expect(pixel(overlay, 29, 20)).toEqual([...IDENTIFIED])
    expect(pixel(overlay, 20, 20)).toEqual([255, 255, 255, 255])
  })

  it('clips an outline that runs past the edge of the page', () => {
    const overlay = createRaster(20, 20)
    annotateOverlay(overlay, [{ rect: { x: -5, y: -5, width: 15, height: 15 }, color: UNEXPECTED }], 2)

    expect(pixel(overlay, 9, 0)).toEqual([...UNEXPECTED])
    expect(pixel(overlay, 0, 9)).toEqual([...UNEXPECTED])
  })
})
