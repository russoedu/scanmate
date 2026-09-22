import { contentExtent } from './content-extent.use-case'
import { createGray, createRaster } from '../raster-codec'
import { fillRect } from '../synthetic-document'
import { inkMap, toGrayscale } from '../ink-separation'

describe('contentExtent', () => {
  it('measures the printed block, not the page', () => {
    const ink = createGray(200, 300)
    for (let y = 100; y < 200; y++) for (let x = 50; x < 110; x++) ink.data[y * 200 + x] = 1

    const extent = contentExtent(ink)

    expect(extent.width).toBeCloseTo(60, 0)
    expect(extent.height).toBeCloseTo(100, 0)
    expect(extent.center.x).toBeCloseTo(80, 0)
    expect(extent.center.y).toBeCloseTo(150, 0)
  })

  it('ignores an isolated speck that would otherwise set the boundary', () => {
    const ink = createGray(200, 200)
    for (let y = 80; y < 120; y++) for (let x = 80; x < 120; x++) ink.data[y * 200 + x] = 1
    ink.data[2 * 200 + 2] = 1

    const extent = contentExtent(ink, 0, 0.004)

    expect(extent.width).toBeLessThan(45)
  })

  it('reports the whole frame and zero density for a blank page', () => {
    const extent = contentExtent(createGray(80, 120))

    expect(extent.density).toBe(0)
    expect(extent.width).toBe(80)
    expect(extent.height).toBe(120)
  })

  it('measures along rotated axes when given an angle', () => {
    // A bar rotated by 30 degrees is narrow along its own axis, wide across the frame.
    const page = createRaster(400, 400)
    const angle = (30 * Math.PI) / 180
    for (let t = -150; t < 150; t++)
      for (let w = -8; w <= 8; w++)
        fillRect(
          page,
          {
            x:      200 + t * Math.cos(angle) - w * Math.sin(angle),
            y:      200 + t * Math.sin(angle) + w * Math.cos(angle),
            width:  1,
            height: 1,
          },
          0,
        )

    const ink = inkMap(toGrayscale(page))
    const aligned = contentExtent(ink, angle)
    const axisAligned = contentExtent(ink, 0)

    expect(aligned.height).toBeLessThan(40)
    expect(axisAligned.height).toBeGreaterThan(150)
  })
})
