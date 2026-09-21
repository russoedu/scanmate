import { createGray, createRaster } from '@scanmate/ink'
import type { Raster } from '@scanmate/ink'

import { estimateContrastPoints } from './contrast-points.policy'
import { enhanceRaster, sharpenRaster } from './enhance-raster.use-case'

const MIDDLE = (8 * 16 + 8) * 4
/** A 16x16 swatch is too small for page statistics - one pixel of ink reads as noise - so swatch tests fix the settings. */
const FIXED = { whitePoint: 0.92, blackPoint: 0.05, despeckle: false } as const

function withPixel (background: [number, number, number, number], ink: [number, number, number]): Raster {
  const raster = createRaster(16, 16, background)
  raster.data.set(ink, MIDDLE)

  return raster
}

/** A page lit from the left: paper runs from 120 to 240 across it, with a dark stroke down the middle. */
function shadowed (): Raster {
  const raster = createRaster(200, 100)
  for (let y = 0; y < 100; y++)
    for (let x = 0; x < 200; x++) {
      const paper = 120 + 120 * (x / 199)
      const v = x >= 98 && x < 102 ? paper * 0.2 : paper
      raster.data.set([v, v, v], (y * 200 + x) * 4)
    }

  return raster
}

describe('enhanceRaster', () => {
  it('turns darkened paper white and keeps the ink dark', () => {
    const { raster } = enhanceRaster(withPixel([90, 85, 80, 255], [20, 20, 20]), { whitePoint: 0.92, blackPoint: 0.05 })

    expect([...raster.data.slice(0, 4)]).toEqual([255, 255, 255, 255])
    expect(raster.data[MIDDLE]).toBeLessThan(100)
  })

  it('keeps a blue pen blue on yellowed paper in colour mode', () => {
    const { raster } = enhanceRaster(withPixel([200, 190, 150, 255], [30, 40, 180]), { ...FIXED, mode: 'color' })

    expect(raster.data[MIDDLE + 2]).toBeGreaterThan(raster.data[MIDDLE])
    expect(raster.data[MIDDLE + 2]).toBeGreaterThan(raster.data[MIDDLE + 1])
  })

  it('returns a monochrome page in grayscale mode', () => {
    const { raster } = enhanceRaster(withPixel([100, 150, 200, 255], [30, 40, 50]), { ...FIXED, mode: 'grayscale' })

    for (let i = 0; i < raster.data.length; i += 4) {
      expect(raster.data[i]).toBe(raster.data[i + 1])
      expect(raster.data[i + 1]).toBe(raster.data[i + 2])
    }
  })

  it('leaves a clean white page clean', () => {
    const { raster } = enhanceRaster(withPixel([255, 255, 255, 255], [0, 0, 0]), FIXED)

    expect(raster.data[0]).toBe(255)
    expect(raster.data[MIDDLE]).toBe(0)
  })

  it('flattens a shadow: paper on the dark side comes out as light as on the lit side', () => {
    const { raster } = enhanceRaster(shadowed(), { mode: 'grayscale' })
    const at = (x: number): number => raster.data[(50 * 200 + x) * 4]

    // 120 against 240 going in; the same value coming out.
    expect(Math.abs(at(20) - at(180))).toBeLessThanOrEqual(2)
    expect(at(100)).toBeLessThan(at(20) - 120)
  })

  it('clamps paper to pure white with fixed points below it', () => {
    const { raster } = enhanceRaster(shadowed(), { mode: 'grayscale', whitePoint: 0.92, blackPoint: 0.05 })

    expect(raster.data[(50 * 200 + 20) * 4]).toBe(255)
    expect(raster.data[(50 * 200 + 180) * 4]).toBe(255)
  })

  it('reports what it did, with the automatic defaults resolved', () => {
    const { applied } = enhanceRaster(shadowed())

    expect(applied.whitePoint).toBeGreaterThanOrEqual(0.7)
    expect(applied.whitePoint).toBeLessThanOrEqual(1.1)
    expect(applied.blackPoint).toBeGreaterThanOrEqual(0)
    expect(applied.blackPoint).toBeLessThanOrEqual(0.4)
    // A smooth synthetic page is not noisy, so auto leaves it alone.
    expect(applied).toMatchObject({ despeckled: false, mode: 'color' })
    expect(applied.noiseSigma).toBeLessThan(0.01)
  })

  it('does not measure noise it has no use for', () => {
    expect(enhanceRaster(shadowed(), { despeckle: true }).applied).toMatchObject({ despeckled: true, noiseSigma: null })
  })
})

describe('estimateContrastPoints', () => {
  it('puts the white point just below the paper and the black point just above the ink', () => {
    const gray = createGray(100, 100)
    const background = createGray(100, 100)
    background.data.fill(0.8)
    // 95% paper at the background, 5% ink at a fifth of it.
    for (let i = 0; i < gray.data.length; i++) gray.data[i] = i % 20 === 0 ? 0.16 : 0.8
    const points = estimateContrastPoints(gray, background)

    expect(points.blackPoint).toBeCloseTo(0.2, 1)
    expect(points.whitePoint).toBeCloseTo(1, 1)
  })
})

/** Text-like strokes a few pixels wide on paper, softened as a scan softens them. */
function softPage (): Raster {
  const raster = createRaster(400, 300)
  raster.data.fill(235)
  for (let y = 40; y < 260; y += 20)
    for (let x = 30; x < 370; x++)
      if (x % 9 < 3)
        for (let dy = 0; dy < 8; dy++) raster.data.set([40, 40, 40], ((y + dy) * 400 + x) * 4)
  // A scanner's softness: each pixel averaged with its neighbours.
  const soft = createRaster(400, 300)
  for (let y = 1; y < 299; y++)
    for (let x = 1; x < 399; x++) {
      let sum = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += raster.data[((y + dy) * 400 + x + dx) * 4]
      const v = Math.round(sum / 9)
      soft.data.set([v, v, v, 255], (y * 400 + x) * 4)
    }

  return soft
}

/** How far the page's grey levels spread from their mean: contrast, in one number. */
function spread (raster: Raster): number {
  let sum = 0
  let squares = 0
  const count = raster.data.length / 4
  for (let i = 0; i < raster.data.length; i += 4) {
    sum += raster.data[i]
    squares += raster.data[i] ** 2
  }

  return Math.sqrt(squares / count - (sum / count) ** 2)
}

describe('sharpenRaster', () => {
  it('is the mask enhanceRaster applies, to within two grey levels on average away from the edge', async () => {
    const page = softPage()
    const settings = { whitePoint: 1, blackPoint: 0, despeckle: false } as const
    const levelled = enhanceRaster(page, { ...settings, sharpen: false }).raster
    const inJavaScript = enhanceRaster(page, { ...settings, sharpen: { sigma: 2 } }).raster
    const inLibvips = await sharpenRaster(levelled, { sigma: 2 })

    // The two blurs treat the page's edge differently - one averages what is on
    // the page, the other extends it - so the comparison is of the page inside.
    let difference = 0
    let counted = 0
    for (let y = 20; y < 280; y++)
      for (let x = 20; x < 380; x++) {
        const i = (y * 400 + x) * 4
        difference += Math.abs(inLibvips.data[i] - inJavaScript.data[i])
        counted++
      }
    // A Gaussian is not quite three box blurs, and dense strokes a few pixels
    // apart show it most: 1.5 levels here, against 0.3-0.4 on a real W-9 page.
    expect(difference / counted).toBeLessThan(2)
  })

  it('sharpens: the page comes out with more contrast than it went in', async () => {
    const levelled = enhanceRaster(softPage(), { whitePoint: 1, blackPoint: 0, despeckle: false, sharpen: false }).raster
    const sharpened = await sharpenRaster(levelled, { sigma: 2 })

    expect(spread(sharpened)).toBeGreaterThan(spread(levelled))
  })

  it('leaves the page alone when there is nothing to do', async () => {
    const page = softPage()

    expect(await sharpenRaster(page, { sigma: 0 })).toBe(page)
    expect(await sharpenRaster(page, { sigma: 2, amount: 0 })).toBe(page)
  })
})
