import { invert, multiply, smallestEigenvector, solve } from '@scanmate/ink'
import type { Matrix3, PointMatch, TransformModel } from '@scanmate/ink'

/**
 * Fitting a transform to a set of correspondences.
 *
 * Three models, and the choice between them is a bet about what the scan went
 * through. A flatbed scanner moves the page in one plane, so a **similarity**
 * (turn it, resize it, slide it) is the whole story and its four parameters
 * are pinned down by very few points — which is exactly what you want when
 * most of your matches are wrong. A sheet-fed scanner can stretch one axis;
 * that needs **affine**. A photograph taken at an angle needs the full
 * **homography**, and pays for those eight parameters by being far easier to
 * fit to nonsense.
 *
 * Prefer the simplest model the physical situation allows.
 */

/** Correspondences the fitters consume. `distance` is ignored here. */
export type Correspondence = Pick<PointMatch, 'source' | 'target'>

/** How many correspondences the model needs before it is determined at all. */
export function minimumSamples (model: TransformModel): number {
  switch (model) {
    case 'similarity': { return 2
    }
    case 'affine': { return 3
    }
    case 'homography': { return 4
    }
  }
}

export function fitModel (
  model: TransformModel,
  matches: readonly Correspondence[],
  indices?: readonly number[],
): Matrix3 | null {
  switch (model) {
    case 'similarity': { return fitSimilarity(matches, indices)
    }
    case 'affine': { return fitAffine(matches, indices)
    }
    case 'homography': { return fitHomography(matches, indices)
    }
  }
}

/**
 * Least-squares similarity, in closed form.
 *
 * No iteration and no matrix inverse: centre both point sets, and the rotation
 * and scale fall out of two dot products. That closed form is why similarity
 * survives a RANSAC sample that affine would choke on.
 */
export function fitSimilarity (
  matches: readonly Correspondence[],
  indices?: readonly number[],
): Matrix3 | null {
  const picked = select(matches, indices)
  if (picked.length < 2) return null

  let sx = 0
  let sy = 0
  let tx = 0
  let ty = 0
  for (const m of picked) {
    sx += m.source.x
    sy += m.source.y
    tx += m.target.x
    ty += m.target.y
  }
  const n = picked.length
  sx /= n
  sy /= n
  tx /= n
  ty /= n

  let dot = 0
  let cross = 0
  let norm = 0
  for (const m of picked) {
    const px = m.source.x - sx
    const py = m.source.y - sy
    const qx = m.target.x - tx
    const qy = m.target.y - ty
    dot += px * qx + py * qy
    cross += px * qy - py * qx
    norm += px * px + py * py
  }

  if (norm < 1e-12) return null

  const a = dot / norm
  const b = cross / norm
  if (Math.hypot(a, b) < 1e-9) return null

  return [
    a, -b, tx - a * sx + b * sy,
    b, a, ty - b * sx - a * sy,
    0, 0, 1,
  ]
}

/** Least-squares affine: two independent 3x3 normal systems sharing one matrix. */
export function fitAffine (
  matches: readonly Correspondence[],
  indices?: readonly number[],
): Matrix3 | null {
  const picked = select(matches, indices)
  if (picked.length < 3) return null

  const m = new Float64Array(9)
  const bx = new Float64Array(3)
  const by = new Float64Array(3)

  for (const match of picked) {
    const { x, y } = match.source
    const { x: u, y: v } = match.target

    m[0] += x * x
    m[1] += x * y
    m[2] += x
    m[4] += y * y
    m[5] += y
    m[8] += 1

    bx[0] += x * u
    bx[1] += y * u
    bx[2] += u
    by[0] += x * v
    by[1] += y * v
    by[2] += v
  }
  m[3] = m[1]
  m[6] = m[2]
  m[7] = m[5]

  const row0 = solve(m, bx, 3)
  const row1 = solve(m, by, 3)
  if (row0 === null || row1 === null) return null

  return [row0[0], row0[1], row0[2], row1[0], row1[1], row1[2], 0, 0, 1]
}

/**
 * Direct Linear Transform with Hartley normalisation.
 *
 * The normalisation is not optional polish. Raw pixel coordinates put entries
 * like `x * u` (order 10^6) next to a constant 1 in the same row, and the
 * eigen solve then answers a question dominated by the big column. Centring
 * each point set and scaling it to a mean radius of `sqrt(2)` puts every
 * column on the same footing; the result is mapped back afterwards.
 */
export function fitHomography (
  matches: readonly Correspondence[],
  indices?: readonly number[],
): Matrix3 | null {
  const picked = select(matches, indices)
  if (picked.length < 4) return null

  const sourceNorm = normalizer(picked.map(m => m.source))
  const targetNorm = normalizer(picked.map(m => m.target))
  if (sourceNorm === null || targetNorm === null) return null

  // Accumulate A^T A directly: 9x9 regardless of how many points there are.
  const ata = new Float64Array(81)
  const row = new Float64Array(9)

  for (const match of picked) {
    const p = apply(sourceNorm, match.source.x, match.source.y)
    const q = apply(targetNorm, match.target.x, match.target.y)

    row.set([-p.x, -p.y, -1, 0, 0, 0, q.x * p.x, q.x * p.y, q.x])
    accumulate(ata, row)
    row.set([0, 0, 0, -p.x, -p.y, -1, q.y * p.x, q.y * p.y, q.y])
    accumulate(ata, row)
  }

  const h = smallestEigenvector(ata, 9)
  const normalized: Matrix3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8]]

  let denormalized: Matrix3
  try {
    denormalized = multiply(invert(targetNorm), multiply(normalized, sourceNorm))
  } catch {
    return null
  }

  const scale = denormalized[8]
  if (!Number.isFinite(scale) || Math.abs(scale) < 1e-12) return null

  return denormalized.map(v => v / scale) as unknown as Matrix3
}

function accumulate (ata: Float64Array, row: Float64Array): void {
  for (let i = 0; i < 9; i++) {
    const vi = row[i]
    if (vi === 0) continue
    for (let j = 0; j < 9; j++) ata[i * 9 + j] += vi * row[j]
  }
}

/** Translate to the centroid and scale so the mean distance from it is `sqrt(2)`. */
function normalizer (points: readonly { x: number, y: number }[]): Matrix3 | null {
  let cx = 0
  let cy = 0
  for (const p of points) {
    cx += p.x
    cy += p.y
  }
  cx /= points.length
  cy /= points.length

  let distance = 0
  for (const p of points) distance += Math.hypot(p.x - cx, p.y - cy)
  distance /= points.length

  // Explicit about NaN: a degenerate point set must fail, not divide.
  if (Number.isNaN(distance) || distance <= 1e-9) return null

  const s = Math.SQRT2 / distance

  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1]
}

function apply (m: Matrix3, x: number, y: number): { x: number, y: number } {
  return { x: m[0] * x + m[1] * y + m[2], y: m[3] * x + m[4] * y + m[5] }
}

function select (
  matches: readonly Correspondence[],
  indices?: readonly number[],
): readonly Correspondence[] {
  return indices === undefined ? matches : indices.map(i => matches[i])
}
