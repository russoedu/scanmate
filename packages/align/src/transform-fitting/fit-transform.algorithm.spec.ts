import { applyPoint, createRandom, multiply, scaling, similarity } from '@scanmate/ink'
import type { Matrix3, Point } from '@scanmate/ink'
import { fitAffine, fitHomography, fitModel, fitSimilarity, minimumSamples } from './fit-transform.use-case'
import type { Correspondence } from './fit-transform.use-case'

const DEGREE = Math.PI / 180

const GRID: Point[] = []
for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) GRID.push({ x: 40 + x * 130, y: 50 + y * 160 })

function project (m: Matrix3, points = GRID): Correspondence[] {
  return points.map(source => ({ source, target: applyPoint(m, source.x, source.y) }))
}

function maxError (fitted: Matrix3, truth: Matrix3, points = GRID): number {
  let worst = 0
  for (const p of points) {
    const a = applyPoint(fitted, p.x, p.y)
    const b = applyPoint(truth, p.x, p.y)
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y))
  }

  return worst
}

describe('minimumSamples', () => {
  it('reflects each model degrees of freedom', () => {
    expect(minimumSamples('similarity')).toBe(2)
    expect(minimumSamples('affine')).toBe(3)
    expect(minimumSamples('homography')).toBe(4)
  })
})

describe('fitSimilarity', () => {
  it('recovers a scale, rotation and translation exactly', () => {
    const truth = similarity(1.37, 6.2 * DEGREE, { x: 300, y: 400 }, { x: 512, y: 380 })
    const fitted = fitSimilarity(project(truth)) as Matrix3

    expect(maxError(fitted, truth)).toBeLessThan(1e-9)
  })

  it('is determined by two points', () => {
    const truth = similarity(0.8, -21 * DEGREE, { x: 0, y: 0 }, { x: 15, y: -9 })
    const fitted = fitSimilarity(project(truth), [0, 24])

    expect(maxError(fitted as Matrix3, truth)).toBeLessThan(1e-9)
  })

  it('averages away symmetric noise rather than chasing it', () => {
    const truth = similarity(1.1, 3 * DEGREE, { x: 200, y: 200 }, { x: 205, y: 196 })
    const random = createRandom(11)
    const noisy = project(truth).map(m => ({
      source: m.source,
      target: { x: m.target.x + (random() - 0.5) * 2, y: m.target.y + (random() - 0.5) * 2 },
    }))

    expect(maxError(fitSimilarity(noisy) as Matrix3, truth)).toBeLessThan(1)
  })

  it('returns null when every point is the same point', () => {
    const degenerate = [
      { source: { x: 5, y: 5 }, target: { x: 1, y: 1 } },
      { source: { x: 5, y: 5 }, target: { x: 2, y: 2 } },
    ]

    expect(fitSimilarity(degenerate)).toBeNull()
  })
})

describe('fitAffine', () => {
  it('recovers a non-uniform scale that similarity cannot', () => {
    const rotate = similarity(1, 8 * DEGREE, { x: 0, y: 0 }, { x: 30, y: 10 })
    const truth = multiply(rotate, scaling(1.3, 0.85))
    const matches = project(truth)

    expect(maxError(fitAffine(matches) as Matrix3, truth)).toBeLessThan(1e-8)
    expect(maxError(fitSimilarity(matches) as Matrix3, truth)).toBeGreaterThan(10)
  })

  it('returns null for collinear sources', () => {
    const line = [0, 1, 2].map(i => ({ source: { x: i * 10, y: i * 10 }, target: { x: i, y: i } }))

    expect(fitAffine(line)).toBeNull()
  })
})

describe('fitHomography', () => {
  it('recovers a projective warp', () => {
    const truth: Matrix3 = [1.04, 0.07, 22, -0.03, 0.98, -14, 0.00021, -0.00013, 1]
    const fitted = fitHomography(project(truth)) as Matrix3

    expect(maxError(fitted, truth)).toBeLessThan(1e-6)
  })

  it('is determined by four points', () => {
    const truth: Matrix3 = [1.1, 0.05, 10, 0.02, 1.05, -8, 0.0002, 0.0001, 1]
    const corners = [GRID[0], GRID[4], GRID[20], GRID[24]]
    const fitted = fitHomography(project(truth, corners))

    expect(maxError(fitted as Matrix3, truth)).toBeLessThan(1e-6)
  })

  it('needs at least four correspondences', () => {
    const truth: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
    const tooFew = project(truth, GRID.slice(0, 3))

    expect(fitHomography(tooFew)).toBeNull()
  })

  it('returns a matrix normalised so the last entry is one', () => {
    const truth: Matrix3 = [2.2, 0.1, 5, 0.1, 2.1, 7, 0.0004, 0.0002, 1]
    const fitted = fitHomography(project(truth)) as Matrix3

    expect(fitted[8]).toBeCloseTo(1, 9)
  })
})

describe('fitModel', () => {
  it('dispatches to the right fitter', () => {
    const truth = similarity(1.2, 4 * DEGREE, { x: 0, y: 0 }, { x: 3, y: 4 })
    const matches = project(truth)

    for (const model of ['similarity', 'affine', 'homography'] as const)
      expect(maxError(fitModel(model, matches) as Matrix3, truth)).toBeLessThan(1e-5)
  })
})
