import { IDENTITY, invert, similarity, translation } from '../plane-geometry'
import { createGray, createRaster } from '../raster-codec'
import { sampleGrayBilinear, warpGray, warpRaster } from './warp.use-case'
import { toGrayscale } from '../ink-separation'

function checker (size: number, cell: number) {
  const raster = createRaster(size, size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0) {
        const i = (y * size + x) * 4
        raster.data[i] = 0
        raster.data[i + 1] = 0
        raster.data[i + 2] = 0
      }

  return raster
}

describe('warpRaster', () => {
  it('reproduces the source exactly under the identity', () => {
    const source = checker(32, 4)
    const warped = warpRaster(source, IDENTITY, 32, 32, { prefilter: false })

    expect([...warped.data]).toEqual([...source.data])
  })

  it('shifts by the translation in the matrix', () => {
    const source = checker(32, 4)
    // Destination pixel (x, y) reads source (x + 4, y): the image moves left by 4.
    const warped = warpRaster(source, translation(4, 0), 32, 32, { prefilter: false })

    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 28; x++)
        expect(warped.data[(y * 32 + x) * 4]).toBe(source.data[(y * 32 + x + 4) * 4])
  })

  it('fills the uncovered canvas with the background colour', () => {
    const source = checker(16, 4)
    const warped = warpRaster(source, translation(-40, -40), 16, 16, {
      prefilter:  false,
      background: [7, 8, 9, 255],
    })

    expect(warped.data[0]).toBe(7)
    expect(warped.data[1]).toBe(8)
    expect(warped.data[2]).toBe(9)
  })

  it('undoes its own rotation to within a pixel of the original', () => {
    const source = checker(64, 8)
    const rotate = similarity(1, 0.35, { x: 32, y: 32 }, { x: 32, y: 32 })

    const rotated = warpRaster(source, invert(rotate), 64, 64, { prefilter: false })
    const restored = warpRaster(rotated, rotate, 64, 64, { prefilter: false })

    // Compare the interior only; the corners genuinely left the frame.
    let error = 0
    let count = 0
    for (let y = 16; y < 48; y++)
      for (let x = 16; x < 48; x++) {
        error += Math.abs(restored.data[(y * 64 + x) * 4] - source.data[(y * 64 + x) * 4])
        count++
      }

    expect(error / count).toBeLessThan(26)
  })

  it('offers bicubic and nearest sampling as well as bilinear', () => {
    const source = checker(32, 4)
    const m = translation(0.5, 0.5)

    const nearest = warpRaster(source, m, 32, 32, { interpolation: 'nearest', prefilter: false })
    const bicubic = warpRaster(source, m, 32, 32, { interpolation: 'bicubic', prefilter: false })

    // Nearest can only ever emit values that were already there.
    expect(new Set(nearest.data).size).toBeLessThanOrEqual(2)
    // Bicubic interpolates, so it invents intermediate greys at the edges.
    expect(new Set(bicubic.data).size).toBeGreaterThan(2)
  })

  it('pre-filters when minifying, so shrinking averages detail instead of beating against it', () => {
    const source = checker(160, 5)
    const shrink = similarity(6.3, 0, { x: 0, y: 0 }, { x: 0, y: 0 })
    const size = Math.floor(160 / 6.3)

    const filtered = warpRaster(source, shrink, size, size, { prefilter: true })
    const raw = warpRaster(source, shrink, size, size, { prefilter: false })

    const deviation = (image: { data: Uint8ClampedArray }) => {
      const data = image.data
      const values: number[] = []
      for (let i = 0; i < data.length; i += 4) values.push(data[i])
      const mean = values.reduce((a, b) => a + b, 0) / values.length

      return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
    }

    // A 5px checker read every 6.3px beats against itself: point sampling
    // returns violent moire that is not on the page. Averaging the footprint
    // returns the mid grey that is.
    expect(deviation(raw)).toBeGreaterThan(80)
    expect(deviation(filtered)).toBeLessThan(deviation(raw) / 3)
  })
})

describe('warpGray', () => {
  it('agrees with warpRaster on the same transform', () => {
    const source = checker(32, 4)
    const gray = toGrayscale(source)
    const m = translation(3, 2)

    const viaGray = warpGray(gray, m, 32, 32, 1)
    const viaRaster = toGrayscale(warpRaster(source, m, 32, 32, { prefilter: false }))

    for (let y = 4; y < 28; y++)
      for (let x = 4; x < 28; x++)
        expect(viaGray.data[y * 32 + x]).toBeCloseTo(viaRaster.data[y * 32 + x], 2)
  })
})

describe('sampleGrayBilinear', () => {
  it('interpolates between neighbours', () => {
    const image = createGray(2, 1)
    image.data.set([0, 1])

    expect(sampleGrayBilinear(image, 0, 0)).toBeCloseTo(0, 6)
    expect(sampleGrayBilinear(image, 0.5, 0)).toBeCloseTo(0.5, 6)
    expect(sampleGrayBilinear(image, 1, 0)).toBeCloseTo(1, 6)
  })

  it('returns the fill value outside the image', () => {
    const image = createGray(2, 2)

    expect(sampleGrayBilinear(image, -5, 0, 0.75)).toBe(0.75)
    expect(sampleGrayBilinear(image, 0, 99, 0.75)).toBe(0.75)
  })
})
