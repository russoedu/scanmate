import { fft1d, fft2d, isPowerOfTwo, nextPowerOfTwo } from './fft.use-case'

/** Textbook O(n^2) DFT, used only to prove the fast one computes the same thing. */
function naiveDft (re: Float64Array, im: Float64Array): { re: Float64Array, im: Float64Array } {
  const n = re.length
  const outRe = new Float64Array(n)
  const outIm = new Float64Array(n)

  for (let k = 0; k < n; k++)
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      outRe[k] += re[t] * cos - im[t] * sin
      outIm[k] += re[t] * sin + im[t] * cos
    }

  return { re: outRe, im: outIm }
}

describe('nextPowerOfTwo', () => {
  it('leaves exact powers alone and rounds everything else up', () => {
    expect(nextPowerOfTwo(1)).toBe(1)
    expect(nextPowerOfTwo(64)).toBe(64)
    expect(nextPowerOfTwo(65)).toBe(128)
    expect(nextPowerOfTwo(1000)).toBe(1024)
  })
})

describe('isPowerOfTwo', () => {
  it('agrees with the obvious cases', () => {
    expect(isPowerOfTwo(1)).toBe(true)
    expect(isPowerOfTwo(256)).toBe(true)
    expect(isPowerOfTwo(0)).toBe(false)
    expect(isPowerOfTwo(6)).toBe(false)
  })
})

describe('fft1d', () => {
  it('matches a direct DFT', () => {
    const n = 16
    const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + i * 0.1)
    const im = new Float64Array(n)
    const expected = naiveDft(re, im)

    const fastRe = Float64Array.from(re)
    const fastIm = Float64Array.from(im)
    fft1d(fastRe, fastIm)

    for (let k = 0; k < n; k++) {
      expect(fastRe[k]).toBeCloseTo(expected.re[k], 9)
      expect(fastIm[k]).toBeCloseTo(expected.im[k], 9)
    }
  })

  it('round-trips through the inverse', () => {
    const n = 32
    const re = Float64Array.from({ length: n }, (_, i) => Math.cos(i))
    const im = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 2))
    const originalRe = Float64Array.from(re)
    const originalIm = Float64Array.from(im)

    fft1d(re, im)
    fft1d(re, im, true)

    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(originalRe[k], 9)
      expect(im[k]).toBeCloseTo(originalIm[k], 9)
    }
  })

  it('rejects a length that is not a power of two', () => {
    expect(() => fft1d(new Float64Array(6), new Float64Array(6))).toThrow(/power of two/)
  })
})

describe('fft2d', () => {
  it('round-trips a 2D signal', () => {
    const width = 8
    const height = 16
    const re = Float64Array.from({ length: width * height }, (_, i) => (i * 37) % 11)
    const im = new Float64Array(width * height)
    const original = Float64Array.from(re)

    fft2d(re, im, width, height)
    fft2d(re, im, width, height, true)

    for (const [i, element] of original.entries()) {
      expect(re[i]).toBeCloseTo(element, 8)
      expect(im[i]).toBeCloseTo(0, 8)
    }
  })

  it('puts the total energy of a constant image in the DC bin', () => {
    const width = 8
    const height = 8
    const re = new Float64Array(width * height).fill(2)
    const im = new Float64Array(width * height)

    fft2d(re, im, width, height)

    expect(re[0]).toBeCloseTo(2 * width * height, 9)
    for (let i = 1; i < re.length; i++) expect(Math.hypot(re[i], im[i])).toBeCloseTo(0, 8)
  })
})
