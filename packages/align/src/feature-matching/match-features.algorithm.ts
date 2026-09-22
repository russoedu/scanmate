import type { PointMatch } from '@scanmate/ink'
import { DESCRIPTOR_WORDS } from './detect-features.use-case'
import type { FeatureSet } from './detect-features.use-case'

/**
 * Brute-force descriptor matching.
 *
 * Brute force is the right algorithm here, not a concession. A page yields
 * around a thousand keypoints per side; a million 256-bit comparisons is eight
 * million XOR-and-popcount operations, which is milliseconds. Building an index
 * to avoid that would cost more than it saves and would only return
 * approximate neighbours.
 *
 * The filters matter more than the search does:
 *
 * - **Ratio test.** Keep a match only when the best candidate is clearly better
 *   than the runner-up. On a page of repeated letterforms the nearest neighbour
 *   is often meaningless, and the giveaway is that the second nearest is just
 *   as close.
 * - **Cross-check.** Both sides must name each other. One-directional bests are
 *   not symmetric, and the asymmetric ones are usually wrong.
 * - **Displacement gate.** The images are already roughly aligned when this
 *   runs, so a correspondence that jumps half the page is not a correspondence.
 */

export interface MatchOptions {
  /** Lowe's ratio. Lower is stricter. */
  ratio?:           number
  /** Reject matches further apart than this many bits out of 256. */
  maxDistance?:     number
  /** Require both descriptors to pick each other. */
  crossCheck?:      boolean
  /** Reject correspondences that move further than this, in pixels. `Infinity` disables the gate. */
  maxDisplacement?: number
}

/**
 * "No candidate yet", as a value an Int32Array can actually hold.
 *
 * `Number.MAX_SAFE_INTEGER` cannot: writing it to an Int32Array truncates it to
 * -1, and every subsequent "is this closer?" comparison then answers no.
 */
const UNSET = 0x7FFFFFFF

export function matchFeatures (
  source: FeatureSet,
  target: FeatureSet,
  options: MatchOptions = {},
): PointMatch[] {
  const {
    ratio = 0.8,
    maxDistance = 96,
    crossCheck = true,
    maxDisplacement = Infinity,
  } = options

  const n = source.keypoints.length
  const m = target.keypoints.length
  if (n === 0 || m === 0) return []

  const bestForSource = new Int32Array(n).fill(-1)
  const bestDistance = new Int32Array(n).fill(UNSET)
  const secondDistance = new Int32Array(n).fill(UNSET)
  const bestForTarget = new Int32Array(m).fill(-1)
  const bestTargetDistance = new Int32Array(m).fill(UNSET)

  const gated = Number.isFinite(maxDisplacement)
  const gate = maxDisplacement * maxDisplacement

  for (let i = 0; i < n; i++) {
    const a = source.keypoints[i]
    const offsetA = i * DESCRIPTOR_WORDS
    let first = UNSET
    let second = UNSET
    let firstIndex = -1

    for (let j = 0; j < m; j++) {
      const b = target.keypoints[j]
      if (gated) {
        const dx = a.x - b.x
        const dy = a.y - b.y
        if (dx * dx + dy * dy > gate) continue
      }

      const distance = hamming(source.descriptors, offsetA, target.descriptors, j * DESCRIPTOR_WORDS)

      if (distance < first) {
        second = first
        first = distance
        firstIndex = j
      } else if (distance < second) {
        second = distance
      }

      if (distance < bestTargetDistance[j]) {
        bestTargetDistance[j] = distance
        bestForTarget[j] = i
      }
    }

    bestForSource[i] = firstIndex
    bestDistance[i] = first
    secondDistance[i] = second
  }

  const matches: PointMatch[] = []
  for (let i = 0; i < n; i++) {
    const j = bestForSource[i]
    if (j < 0) continue
    if (bestDistance[i] > maxDistance) continue
    if (secondDistance[i] !== UNSET && bestDistance[i] > ratio * secondDistance[i]) continue
    if (crossCheck && bestForTarget[j] !== i) continue

    const a = source.keypoints[i]
    const b = target.keypoints[j]
    matches.push({
      source:   { x: a.x, y: a.y },
      target:   { x: b.x, y: b.y },
      distance: bestDistance[i],
    })
  }

  return matches
}

/** Hamming distance between two 256-bit descriptors. */
export function hamming (a: Uint32Array, offsetA: number, b: Uint32Array, offsetB: number): number {
  let total = 0
  for (let k = 0; k < DESCRIPTOR_WORDS; k++) total += popcount(a[offsetA + k] ^ b[offsetB + k])

  return total
}

/** SWAR bit count: pair off, then nibble off, then one multiply to sum the bytes. */
export function popcount (value: number): number {
  let v = value - ((value >> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >> 2) & 0x33333333)
  v = (v + (v >> 4)) & 0x0F0F0F0F

  return (Math.imul(v, 0x01010101) >> 24) & 0xFF
}
