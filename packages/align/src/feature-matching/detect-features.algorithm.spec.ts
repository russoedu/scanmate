import type { Matrix3 } from '@scanmate/ink'
import { applyPoint, createGray, createSyntheticDocument, inkMap, simulateScan, toGrayscale } from '@scanmate/ink'
import { ransac } from '../transform-fitting'
import { DESCRIPTOR_WORDS, detectAndDescribe, detectFast, orientation } from './detect-features.algorithm'
import { hamming, matchFeatures, popcount } from './match-features.algorithm'

const PAGE = createSyntheticDocument({ width: 480, height: 620 })
const PAGE_INK = inkMap(toGrayscale(PAGE.raster))

describe('popcount', () => {
  it('counts set bits, including in the sign bit', () => {
    expect(popcount(0)).toBe(0)
    expect(popcount(0b1011)).toBe(3)
    expect(popcount(-1)).toBe(32)
    expect(popcount(-0x80000000)).toBe(1)
  })
})

describe('hamming', () => {
  it('is zero for identical descriptors and 256 for inverted ones', () => {
    const a = new Uint32Array(DESCRIPTOR_WORDS).fill(0xAAAAAAAA)
    const b = new Uint32Array(DESCRIPTOR_WORDS).fill(0x55555555)

    expect(hamming(a, 0, a, 0)).toBe(0)
    expect(hamming(a, 0, b, 0)).toBe(256)
  })
})

describe('detectFast', () => {
  it('fires on a corner and not on flat paper', () => {
    const image = createGray(40, 40)
    for (let y = 12; y < 40; y++) for (let x = 12; x < 40; x++) image.data[y * 40 + x] = 1

    const corners = detectFast(image, 0.1, 6)
    const nearCorner = corners.filter(c => Math.hypot(c.x - 12, c.y - 12) < 4)

    expect(nearCorner.length).toBeGreaterThan(0)
    expect(detectFast(createGray(40, 40), 0.1, 6)).toHaveLength(0)
  })
})

describe('orientation', () => {
  it('points at the ink', () => {
    const image = createGray(41, 41)
    // All the ink to the right of centre.
    for (let y = 15; y < 26; y++) for (let x = 25; x < 36; x++) image.data[y * 41 + x] = 1

    expect(Math.abs(orientation(image, 20, 20, 15))).toBeLessThan(0.2)
  })

  it('turns with the ink', () => {
    const image = createGray(41, 41)
    for (let y = 25; y < 36; y++) for (let x = 15; x < 26; x++) image.data[y * 41 + x] = 1

    expect(orientation(image, 20, 20, 15)).toBeCloseTo(Math.PI / 2, 1)
  })
})

describe('detectAndDescribe', () => {
  it('finds plenty of describable corners on a printed page', () => {
    const features = detectAndDescribe(PAGE_INK)

    expect(features.keypoints.length).toBeGreaterThan(200)
    expect(features.descriptors.length).toBe(features.keypoints.length * DESCRIPTOR_WORDS)
  })

  it('respects the feature budget', () => {
    const features = detectAndDescribe(PAGE_INK, { maxFeatures: 90 })

    expect(features.keypoints.length).toBeLessThanOrEqual(90)
  })

  it('spreads keypoints over the page rather than piling them into one block', () => {
    const features = detectAndDescribe(PAGE_INK, { maxFeatures: 400, levels: 1 })
    const occupied = new Set(
      features.keypoints.map(k => `${Math.floor((k.x / PAGE_INK.width) * 4)},${Math.floor((k.y / PAGE_INK.height) * 4)}`),
    )

    expect(occupied.size).toBeGreaterThanOrEqual(10)
  })

  it('is deterministic', () => {
    const a = detectAndDescribe(PAGE_INK, { seed: 5 })
    const b = detectAndDescribe(PAGE_INK, { seed: 5 })

    expect(a.keypoints.length).toBe(b.keypoints.length)
    expect([...a.descriptors]).toEqual([...b.descriptors])
  })

  it('finds nothing on blank paper instead of inventing corners', () => {
    expect(detectAndDescribe(createGray(200, 200)).keypoints).toHaveLength(0)
  })
})

describe('matchFeatures', () => {
  it('matches a page to itself, on the same pixels', () => {
    const features = detectAndDescribe(PAGE_INK, { levels: 1, maxFeatures: 300 })
    const matches = matchFeatures(features, features)

    expect(matches.length).toBeGreaterThan(200)

    const exact = matches.filter(m => m.source.x === m.target.x && m.source.y === m.target.y)
    expect(exact.length / matches.length).toBeGreaterThan(0.95)
  })

  it('honours the displacement gate', () => {
    const features = detectAndDescribe(PAGE_INK, { levels: 1, maxFeatures: 200 })
    const matches = matchFeatures(features, features, { maxDisplacement: 0 })

    // Every correspondence is at zero displacement, so the gate keeps them all.
    expect(matches.length).toBeGreaterThan(100)
  })

  it('returns nothing when one side has no features', () => {
    const features = detectAndDescribe(PAGE_INK, { levels: 1, maxFeatures: 50 })

    expect(matchFeatures(features, { keypoints: [], descriptors: new Uint32Array(0) })).toHaveLength(0)
  })
})

describe('rotation and scale invariance', () => {
  it('recovers a 20 degree rotation from descriptors alone', () => {
    const scan = simulateScan(PAGE.raster, {
      rotationDeg: 20,
      canvas:      { width: 760, height: 860 },
    })
    const scanInk = inkMap(toGrayscale(scan.raster))

    const matches = matchFeatures(
      detectAndDescribe(PAGE_INK, { levels: 1, maxFeatures: 900 }),
      detectAndDescribe(scanInk, { levels: 1, maxFeatures: 900 }),
    )
    const consensus = ransac(matches, { model: 'similarity', threshold: 3, maxIterations: 4000 })

    expect(consensus).not.toBeNull()
    expect(cornerError(consensus?.matrix as Matrix3, scan.matrix)).toBeLessThan(3)
  })

  it('recovers a 1.35x scale change using the pyramid', () => {
    const scan = simulateScan(PAGE.raster, { scale: 1.35 })
    const scanInk = inkMap(toGrayscale(scan.raster))

    const matches = matchFeatures(
      detectAndDescribe(PAGE_INK, { levels: 4, scaleFactor: 1.18, maxFeatures: 1600 }),
      detectAndDescribe(scanInk, { levels: 4, scaleFactor: 1.18, maxFeatures: 1600 }),
    )
    const consensus = ransac(matches, { model: 'similarity', threshold: 3, maxIterations: 4000 })

    expect(consensus).not.toBeNull()
    expect(cornerError(consensus?.matrix as Matrix3, scan.matrix)).toBeLessThan(4)
  })
})

function cornerError (fitted: Matrix3, truth: Matrix3): number {
  let worst = 0
  for (const [x, y] of [[0, 0], [PAGE.raster.width, 0], [0, PAGE.raster.height], [PAGE.raster.width, PAGE.raster.height]]) {
    const a = applyPoint(fitted, x, y)
    const b = applyPoint(truth, x, y)
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y))
  }

  return worst
}
