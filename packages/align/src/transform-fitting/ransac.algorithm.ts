import { createRandom, isPlausible, reprojectionError } from '@scanmate/ink'
import type { Matrix3, TransformModel } from '@scanmate/ink'
import { fitModel, minimumSamples } from './fit-transform.algorithm'
import type { Correspondence } from './fit-transform.algorithm'

/**
 * RANSAC: fit the model that the largest number of correspondences agree with.
 *
 * Feature matching on a document produces a lot of confident nonsense, because
 * the page is full of things that genuinely look identical — every lowercase
 * "e", every corner of every table cell. Least squares over all of them is
 * dragged wherever the wrong ones point. RANSAC ignores the average: it draws
 * the smallest sample that determines a transform, counts how many of the rest
 * that transform explains, and repeats. A wrong sample agrees with almost
 * nothing; the right one agrees with everything real on the page.
 */

export interface RansacOptions {
  model:          TransformModel
  /** A correspondence is an inlier when it reprojects within this many pixels. */
  threshold:      number
  maxIterations?: number
  /** Probability of having drawn at least one all-inlier sample. Drives early exit. */
  confidence?:    number
  /** Below this many inliers the answer is rejected outright. */
  minInliers?:    number
  seed?:          number
}

export interface RansacResult {
  matrix:      Matrix3
  /** Indices into the input array. */
  inliers:     number[]
  inlierRatio: number
  iterations:  number
  /** Mean reprojection error over the inliers, in pixels. */
  error:       number
}

export function ransac (
  matches: readonly Correspondence[],
  options: RansacOptions,
): RansacResult | null {
  const {
    model,
    threshold,
    maxIterations = 2000,
    confidence = 0.995,
    seed = 0x5CA7F1,
  } = options

  const sampleSize = minimumSamples(model)
  const minInliers = options.minInliers ?? Math.max(sampleSize + 2, Math.ceil(matches.length * 0.08))
  if (matches.length < Math.max(sampleSize, minInliers)) return null

  const random = createRandom(seed)
  const sample: number[] = Array.from({ length: sampleSize }, () => 0)

  let bestInliers: number[] = []
  let bestMatrix: Matrix3 | null = null
  let limit = maxIterations
  let iterations = 0

  for (; iterations < limit && iterations < maxIterations; iterations++) {
    drawSample(sample, matches.length, random)
    const candidate = fitModel(model, matches, sample)
    if (candidate === null || !isPlausible(candidate)) continue

    const inliers = findInliers(matches, candidate, threshold)
    if (inliers.length <= bestInliers.length) continue

    bestInliers = inliers
    bestMatrix = candidate

    // Adaptive stopping: once a large fraction agrees, the chance that more
    // draws find something better collapses, and so does the budget.
    const ratio = inliers.length / matches.length
    if (ratio > 0 && ratio < 1) {
      const denominator = Math.log(1 - ratio ** sampleSize)
      if (denominator < 0) limit = Math.min(maxIterations, Math.ceil(Math.log(1 - confidence) / denominator) + 1)
    } else if (ratio >= 1) {
      limit = iterations + 1
    }
  }

  if (bestMatrix === null || bestInliers.length < minInliers) return null

  // Re-fit on every inlier. The minimal sample only ever located the consensus;
  // the accurate transform comes from all of it.
  let refined = fitModel(model, matches, bestInliers)
  if (refined !== null && isPlausible(refined)) {
    const refinedInliers = findInliers(matches, refined, threshold)
    if (refinedInliers.length >= bestInliers.length) bestInliers = refinedInliers
    else refined = bestMatrix
  } else {
    refined = bestMatrix
  }

  const matrix = refined ?? bestMatrix
  let total = 0
  for (const i of bestInliers) total += reprojectionError(matrix, matches[i].source, matches[i].target)

  return {
    matrix,
    inliers:     bestInliers,
    inlierRatio: bestInliers.length / matches.length,
    iterations,
    error:       bestInliers.length > 0 ? total / bestInliers.length : Infinity,
  }
}

export function findInliers (
  matches: readonly Correspondence[],
  matrix: Matrix3,
  threshold: number,
): number[] {
  const inliers: number[] = []
  for (const [i, match] of matches.entries())
    if (reprojectionError(matrix, match.source, match.target) <= threshold) inliers.push(i)

  return inliers
}

/** Distinct indices, drawn without replacement. */
function drawSample (into: number[], count: number, random: () => number): void {
  for (let i = 0; i < into.length; i++) {
    let candidate = 0
    for (let attempt = 0; attempt < 32; attempt++) {
      candidate = Math.min(count - 1, Math.floor(random() * count))
      let duplicate = false
      for (let j = 0; j < i; j++)
        if (into[j] === candidate) {
          duplicate = true
          break
        }
      if (!duplicate) break
    }
    into[i] = candidate
  }
}
