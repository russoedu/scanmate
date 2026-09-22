import { createGray } from '@scanmate/ink'
import type { GrayImage } from '@scanmate/ink'
import { phaseCorrelate } from './phase-correlate.algorithm'

/** A few smooth blobs, so the correlation surface has one unambiguous peak. */
function blobs (width: number, height: number, offsetX: number, offsetY: number): GrayImage {
  const image = createGray(width, height)
  const centres = [
    [0.3, 0.25], [0.7, 0.4], [0.45, 0.72], [0.2, 0.6], [0.8, 0.8],
  ] as const

  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let value = 0
      for (const [cx, cy] of centres) {
        const dx = x - (cx * width + offsetX)
        const dy = y - (cy * height + offsetY)
        value += Math.exp(-(dx * dx + dy * dy) / 220)
      }
      image.data[y * width + x] = Math.min(1, value)
    }

  return image
}

describe('phaseCorrelate', () => {
  it('recovers a whole-pixel shift', () => {
    const a = blobs(128, 128, 0, 0)
    const b = blobs(128, 128, 9, -6)

    const { dx, dy, peak } = phaseCorrelate(a, b)

    expect(dx).toBeCloseTo(9, 0)
    expect(dy).toBeCloseTo(-6, 0)
    expect(peak).toBeGreaterThan(0.01)
  })

  it('reaches sub-pixel accuracy', () => {
    const a = blobs(128, 128, 0, 0)
    const b = blobs(128, 128, 4.5, 2.5)

    const { dx, dy } = phaseCorrelate(a, b)

    expect(Math.abs(dx - 4.5)).toBeLessThan(0.6)
    expect(Math.abs(dy - 2.5)).toBeLessThan(0.6)
  })

  it('reports no shift for identical images', () => {
    const a = blobs(64, 64, 0, 0)
    const { dx, dy } = phaseCorrelate(a, a)

    expect(Math.abs(dx)).toBeLessThan(0.05)
    expect(Math.abs(dy)).toBeLessThan(0.05)
  })

  it('refuses mismatched sizes', () => {
    expect(() => phaseCorrelate(createGray(16, 16), createGray(16, 32))).toThrow(/same size/)
  })
})
