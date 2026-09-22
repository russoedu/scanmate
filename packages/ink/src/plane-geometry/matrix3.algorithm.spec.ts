import type { Matrix3 } from './geometry.model'
import { applyPoint, conjugateScale, decompose, IDENTITY, invert, multiply, normalize, rebase, reprojectionError, scaling, similarity, translation } from './matrix3.algorithm'

const DEGREE = Math.PI / 180

describe('multiply', () => {
  it('leaves a matrix alone when multiplied by the identity', () => {
    const m: Matrix3 = [2, 0.3, 40, -0.1, 1.7, -5, 0.0001, 0.0002, 1]

    expect(multiply(m, IDENTITY)).toEqual(m)
    expect(multiply(IDENTITY, m)).toEqual(m)
  })

  it('applies the right operand first', () => {
    const composed = multiply(scaling(2), translation(10, 0))

    // Translate by 10, then scale by 2: the point ends at 20, not 10 + 2.
    expect(applyPoint(composed, 0, 0)).toEqual({ x: 20, y: 0 })
  })
})

describe('invert', () => {
  it('round-trips an arbitrary projective transform', () => {
    const m: Matrix3 = [1.2, 0.08, 30, -0.05, 0.94, -12, 0.0003, -0.0001, 1]
    const round = multiply(invert(m), m)

    for (const [i, value] of normalize(round).entries()) expect(value).toBeCloseTo(IDENTITY[i], 9)
  })

  it('refuses a singular matrix rather than returning infinities', () => {
    expect(() => invert([1, 2, 3, 2, 4, 6, 0, 0, 1])).toThrow(/singular/)
  })
})

describe('similarity', () => {
  it('lands the pivot exactly on the target', () => {
    const m = similarity(1.4, 12 * DEGREE, { x: 100, y: 200 }, { x: 640, y: 480 })
    const landed = applyPoint(m, 100, 200)

    expect(landed.x).toBeCloseTo(640, 9)
    expect(landed.y).toBeCloseTo(480, 9)
  })

  it('scales distances by exactly the requested factor', () => {
    const m = similarity(1.4, 33 * DEGREE, { x: 0, y: 0 }, { x: 0, y: 0 })
    const a = applyPoint(m, 0, 0)
    const b = applyPoint(m, 100, 0)

    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(140, 9)
  })
})

describe('decompose', () => {
  it('recovers the scale and rotation that built the matrix', () => {
    const summary = decompose(similarity(1.25, -7 * DEGREE, { x: 10, y: 10 }, { x: 10, y: 10 }), 'similarity')

    expect(summary.scaleX).toBeCloseTo(1.25, 9)
    expect(summary.scaleY).toBeCloseTo(1.25, 9)
    expect(summary.rotationDeg).toBeCloseTo(-7, 9)
    expect(summary.shearDeg).toBeCloseTo(0, 9)
  })

  it('separates anisotropic scale from rotation', () => {
    const rotate = similarity(1, 20 * DEGREE, { x: 0, y: 0 }, { x: 0, y: 0 })
    const summary = decompose(multiply(rotate, scaling(2, 3)), 'affine')

    expect(summary.scaleX).toBeCloseTo(2, 9)
    expect(summary.scaleY).toBeCloseTo(3, 9)
    expect(summary.rotationDeg).toBeCloseTo(20, 9)
  })
})

describe('conjugateScale', () => {
  it('lifts a matrix measured on a shrunk copy back to full resolution', () => {
    const k = 0.25
    const measured = similarity(1.3, 5 * DEGREE, { x: 100, y: 125 }, { x: 102, y: 124 })
    const full = conjugateScale(measured, k)

    const inMeasured = applyPoint(measured, 120 * k, 340 * k)
    const inFull = applyPoint(full, 120, 340)

    expect(inFull.x).toBeCloseTo(inMeasured.x / k, 6)
    expect(inFull.y).toBeCloseTo(inMeasured.y / k, 6)
  })

  it('is the equal-scale case of rebase', () => {
    const measured = similarity(0.9, -3 * DEGREE, { x: 40, y: 60 }, { x: 44, y: 57 })

    expect(conjugateScale(measured, 0.5)).toEqual(rebase(measured, 0.5, 0.5))
  })
})

describe('rebase', () => {
  it('handles two frames shrunk by different factors', () => {
    const sourceScale = 0.4
    const targetScale = 0.25
    // A transform measured between the two shrunk frames.
    const measured = similarity(1.1, 3 * DEGREE, { x: 100, y: 100 }, { x: 102, y: 97 })
    const full = rebase(measured, sourceScale, targetScale)

    const inSmall = applyPoint(measured, 50 * sourceScale, 70 * sourceScale)
    const inFull = applyPoint(full, 50, 70)

    expect(inFull.x).toBeCloseTo(inSmall.x / targetScale, 6)
    expect(inFull.y).toBeCloseTo(inSmall.y / targetScale, 6)
  })
})

describe('reprojectionError', () => {
  it('is the distance between the mapped source and the target', () => {
    const error = reprojectionError(translation(3, 4), { x: 0, y: 0 }, { x: 0, y: 0 })

    expect(error).toBeCloseTo(5, 9)
  })
})
