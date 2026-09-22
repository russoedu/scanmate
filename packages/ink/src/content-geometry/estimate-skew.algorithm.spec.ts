import { createGray } from '../raster-codec'
import { createSyntheticDocument, simulateScan } from '../synthetic-document'
import { estimateSkew, profileSharpness } from './estimate-skew.use-case'
import { inkMap, toGrayscale } from '../ink-separation'

describe('profileSharpness', () => {
  it('peaks when the projection axis matches the stripes', () => {
    const ink = createGray(200, 200)
    for (let y = 0; y < 200; y += 10)
      for (let x = 0; x < 200; x++) ink.data[y * 200 + x] = 1

    expect(profileSharpness(ink, 0)).toBeGreaterThan(profileSharpness(ink, 0.15))
  })
})

describe('estimateSkew', () => {
  it('finds no skew on a straight page', () => {
    const page = createSyntheticDocument({ width: 420, height: 560 })
    const skew = estimateSkew(inkMap(toGrayscale(page.raster)))

    expect(Math.abs((skew * 180) / Math.PI)).toBeLessThan(0.3)
  })

  it('recovers the angle a page was turned by', () => {
    const page = createSyntheticDocument({ width: 420, height: 560 })

    for (const rotationDeg of [-4.5, 2.5, 7]) {
      const scan = simulateScan(page.raster, {
        rotationDeg,
        canvas: { width: 620, height: 760 },
      })
      const skew = estimateSkew(inkMap(toGrayscale(scan.raster)))

      expect((skew * 180) / Math.PI).toBeCloseTo(rotationDeg, 0)
    }
  })
})
