/**
 * In-place radix-2 Cooley-Tukey FFT, real and imaginary parts in separate arrays.
 *
 * Only used by phase correlation, which needs a *global* translation estimate
 * that no amount of local feature matching can produce on a page with almost
 * nothing printed on it. Sizes must be powers of two; {@link nextPowerOfTwo}
 * and the caller's zero padding see to that.
 */

export function nextPowerOfTwo (n: number): number {
  let p = 1
  while (p < n) p *= 2

  return p
}

export function isPowerOfTwo (n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0
}

/** Transform `re`/`im` of length `n` in place. `inverse` also divides by `n`. */
export function fft1d (re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length
  if (!isPowerOfTwo(n)) throw new Error(`fft length must be a power of two, got ${n}`)
  if (n === 1) return

  // Bit-reversal permutation: the decimation-in-time butterflies below expect
  // the input already shuffled into the order the recursion would have left it.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit
    j ^= bit

    if (i < j) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }

  const sign = inverse ? 1 : -1
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (sign * 2 * Math.PI) / len
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)

    for (let start = 0; start < n; start += len) {
      let curRe = 1
      let curIm = 0
      const half = len >> 1

      for (let k = 0; k < half; k++) {
        const i = start + k
        const j = i + half
        const evenRe = re[i]
        const evenIm = im[i]
        const oddRe = re[j] * curRe - im[j] * curIm
        const oddIm = re[j] * curIm + im[j] * curRe

        re[i] = evenRe + oddRe
        im[i] = evenIm + oddIm
        re[j] = evenRe - oddRe
        im[j] = evenIm - oddIm

        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }

  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n
      im[i] /= n
    }
}

/** 2D transform of a `width x height` row-major complex image, rows then columns. */
export function fft2d (
  re: Float64Array,
  im: Float64Array,
  width: number,
  height: number,
  inverse = false,
): void {
  const rowRe = new Float64Array(width)
  const rowIm = new Float64Array(width)
  for (let y = 0; y < height; y++) {
    const off = y * width
    rowRe.set(re.subarray(off, off + width))
    rowIm.set(im.subarray(off, off + width))
    fft1d(rowRe, rowIm, inverse)
    re.set(rowRe, off)
    im.set(rowIm, off)
  }

  const colRe = new Float64Array(height)
  const colIm = new Float64Array(height)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      colRe[y] = re[y * width + x]
      colIm[y] = im[y * width + x]
    }
    fft1d(colRe, colIm, inverse)
    for (let y = 0; y < height; y++) {
      re[y * width + x] = colRe[y]
      im[y * width + x] = colIm[y]
    }
  }
}
