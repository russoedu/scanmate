/**
 * The two dense solvers the estimators need, and nothing more.
 *
 * Both work on plain row-major `Float64Array`s of a fixed, tiny size (n <= 9),
 * so there is no pivoting strategy worth agonising over and no allocation
 * pressure worth caring about.
 */

/**
 * Solve `A x = b` by Gaussian elimination with partial pivoting.
 *
 * `a` is destroyed. Returns `null` when the system is singular, which for the
 * affine fit means the sample points were collinear — a real, common case, not
 * an exceptional one, so it is a return value rather than a throw.
 */
export function solve (a: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const m = Float64Array.from(a)
  const x = Float64Array.from(b)

  for (let col = 0; col < n; col++) {
    let pivot = col
    let best = Math.abs(m[col * n + col])
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(m[row * n + col])
      if (v > best) {
        best = v
        pivot = row
      }
    }
    if (best < 1e-12) return null

    if (pivot !== col) {
      for (let k = 0; k < n; k++) {
        const t = m[col * n + k]
        m[col * n + k] = m[pivot * n + k]
        m[pivot * n + k] = t
      }
      const t = x[col]
      x[col] = x[pivot]
      x[pivot] = t
    }

    const diag = m[col * n + col]
    for (let row = col + 1; row < n; row++) {
      const factor = m[row * n + col] / diag
      if (factor === 0) continue
      for (let k = col; k < n; k++) m[row * n + k] -= factor * m[col * n + k]
      x[row] -= factor * x[col]
    }
  }

  for (let row = n - 1; row >= 0; row--) {
    let sum = x[row]
    for (let k = row + 1; k < n; k++) sum -= m[row * n + k] * x[k]
    x[row] = sum / m[row * n + row]
  }

  return x
}

/**
 * Eigen-decompose a symmetric matrix with the cyclic Jacobi method.
 *
 * Jacobi is the right tool at this size: it is a dozen lines, it is
 * unconditionally stable for symmetric input, and it gives eigenvectors for
 * free. The homography fit needs the eigenvector of `A^T A` belonging to the
 * smallest eigenvalue — the direction the data constrains least, which is the
 * null-space direction we are after.
 *
 * @param input Row-major, `n * n`, symmetric. Not modified.
 * @returns `values[i]` paired with column `i` of `vectors` (`vectors[row * n + i]`).
 */
export function jacobiEigen (
  input: Float64Array,
  n: number,
  maxSweeps = 60,
): { values: Float64Array, vectors: Float64Array } {
  const a = Float64Array.from(input)
  const v = new Float64Array(n * n)
  for (let i = 0; i < n; i++) v[i * n + i] = 1

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) off += a[p * n + q] * a[p * n + q]

    if (off < 1e-24) break

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q]
        if (Math.abs(apq) < 1e-18) continue

        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq)
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c

        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p]
          const akq = a[k * n + q]
          a[k * n + p] = c * akp - s * akq
          a[k * n + q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k]
          const aqk = a[q * n + k]
          a[p * n + k] = c * apk - s * aqk
          a[q * n + k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p]
          const vkq = v[k * n + q]
          v[k * n + p] = c * vkp - s * vkq
          v[k * n + q] = s * vkp + c * vkq
        }
      }
    }
  }

  const values = new Float64Array(n)
  for (let i = 0; i < n; i++) values[i] = a[i * n + i]

  return { values, vectors: v }
}

/** The unit eigenvector of a symmetric `n x n` matrix belonging to its smallest eigenvalue. */
export function smallestEigenvector (input: Float64Array, n: number): Float64Array {
  const { values, vectors } = jacobiEigen(input, n)

  let best = 0
  for (let i = 1; i < n; i++) if (values[i] < values[best]) best = i

  const out = new Float64Array(n)
  let norm = 0
  for (let row = 0; row < n; row++) {
    out[row] = vectors[row * n + best]
    norm += out[row] * out[row]
  }
  norm = Math.sqrt(norm)
  if (norm > 0) for (let row = 0; row < n; row++) out[row] /= norm

  return out
}
