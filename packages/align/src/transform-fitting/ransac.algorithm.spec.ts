import { applyPoint, createRandom, similarity } from '@scanmate/ink'
import type { Matrix3, Point } from '@scanmate/ink'
import type { Correspondence } from './fit-transform.algorithm'
import { findInliers, ransac } from './ransac.algorithm'

const DEGREE = Math.PI / 180
const TRUTH = similarity(1.25, 4.5 * DEGREE, { x: 400, y: 500 }, { x: 420, y: 480 })

function build (inlierCount: number, outlierCount: number, seed = 3): Correspondence[] {
  const random = createRandom(seed)
  const matches: Correspondence[] = []

  for (let i = 0; i < inlierCount; i++) {
    const source: Point = { x: random() * 800, y: random() * 1000 }
    const target = applyPoint(TRUTH, source.x, source.y)
    matches.push({ source, target: { x: target.x + (random() - 0.5), y: target.y + (random() - 0.5) } })
  }

  for (let i = 0; i < outlierCount; i++)
    matches.push({
      source: { x: random() * 800, y: random() * 1000 },
      target: { x: random() * 1000, y: random() * 1200 },
    })

  return matches
}

function maxError (fitted: Matrix3, points: Point[]): number {
  let worst = 0
  for (const p of points) {
    const a = applyPoint(fitted, p.x, p.y)
    const b = applyPoint(TRUTH, p.x, p.y)
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y))
  }

  return worst
}

const CORNERS: Point[] = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 0, y: 1000 }, { x: 800, y: 1000 }]

describe('ransac', () => {
  it('finds the transform that most correspondences agree on', () => {
    const result = ransac(build(60, 10), { model: 'similarity', threshold: 3 })

    expect(result).not.toBeNull()
    expect(result?.inliers.length).toBeGreaterThanOrEqual(58)
    expect(maxError(result?.matrix as Matrix3, CORNERS)).toBeLessThan(2)
  })

  it('survives more wrong matches than right ones', () => {
    const result = ransac(build(40, 60), { model: 'similarity', threshold: 3, maxIterations: 5000 })

    expect(result).not.toBeNull()
    expect(result?.inliers.length).toBeGreaterThanOrEqual(38)
    expect(maxError(result?.matrix as Matrix3, CORNERS)).toBeLessThan(2)
  })

  it('is deterministic for a given seed', () => {
    const matches = build(50, 40)
    const a = ransac(matches, { model: 'similarity', threshold: 3, seed: 99 })
    const b = ransac(matches, { model: 'similarity', threshold: 3, seed: 99 })

    expect(a?.matrix).toEqual(b?.matrix)
  })

  it('gives up rather than inventing a transform from pure noise', () => {
    const result = ransac(build(0, 80), { model: 'similarity', threshold: 2, minInliers: 20 })

    expect(result).toBeNull()
  })

  it('refuses when there are fewer matches than the model needs', () => {
    expect(ransac(build(3, 0), { model: 'homography', threshold: 3 })).toBeNull()
  })

  it('reports the mean reprojection error over its inliers', () => {
    const result = ransac(build(60, 10), { model: 'similarity', threshold: 3 })

    expect(result?.error).toBeLessThan(1)
    expect(result?.inlierRatio).toBeGreaterThan(0.8)
  })
})

describe('findInliers', () => {
  it('counts exactly the correspondences within the threshold', () => {
    const matches: Correspondence[] = [
      { source: { x: 0, y: 0 }, target: { x: 0, y: 0 } },
      { source: { x: 0, y: 0 }, target: { x: 10, y: 0 } },
    ]

    expect(findInliers(matches, [1, 0, 0, 0, 1, 0, 0, 0, 1], 1)).toEqual([0])
  })
})
