import { conjugateScale, downscaleGray, multiply, rebase, warpGray } from '@scanmate/ink'
import type { GrayImage, Matrix3, PointMatch, TransformModel } from '@scanmate/ink'

import type { CoarseResult } from '../coarse-estimation'
import { detectAndDescribe, matchFeatures } from '../feature-matching'
import { ransac } from '../transform-fitting'

/**
 * Feature refinement, in two halves so that trying several models costs one
 * feature pass rather than one per model.
 *
 * Matching is done between the original and the *coarsely corrected* scan, and
 * that is what makes the whole thing work: the two now sit at the same scale and
 * nearly the same angle, so a fixed-offset binary descriptor describes the same
 * thing on both, and a correspondence that jumps across the page can be rejected
 * on sight. What RANSAC recovers is only the small residual, which is then
 * composed onto the coarse transform.
 *
 * Everything in {@link prepareMatches} - two downscales, a rough warp, ORB on
 * both pages and the brute-force matcher - is independent of which transform
 * family is about to be fitted, and it is nearly all of the cost. Only
 * {@link fitResidual} depends on the model, and it touches no pixels at all.
 */

export interface MatchingOptions {
  workingSize:          number
  maxFeatures:          number
  maxDisplacementRatio: number
  seed:                 number
}

/** Everything the model fits share. Compute once, fit many. */
export interface PreparedMatches {
  matches:  PointMatch[]
  features: { original: number, scanned: number }
  /** How much the original was shrunk to its working frame; lifts a residual back to full resolution. */
  scale:    number
}

export function prepareMatches (
  originalInk: GrayImage,
  scannedInk: GrayImage,
  coarse: CoarseResult,
  options: MatchingOptions,
): PreparedMatches {
  const original = downscaleGray(originalInk, options.workingSize)
  const scanned = downscaleGray(scannedInk, options.workingSize)

  // The coarse matrix speaks full-resolution pixels; restate it between the two
  // working frames, which were shrunk by different amounts.
  const coarseWork = rebase(coarse.matrix, 1 / original.scale, 1 / scanned.scale)
  const rough = warpGray(scanned.image, coarseWork, original.image.width, original.image.height, 0)

  const originalFeatures = detectAndDescribe(original.image, { maxFeatures: options.maxFeatures, seed: options.seed })
  const scannedFeatures = detectAndDescribe(rough, { maxFeatures: options.maxFeatures, seed: options.seed })

  const diagonal = Math.hypot(original.image.width, original.image.height)
  const matches = matchFeatures(originalFeatures, scannedFeatures, {
    maxDisplacement: diagonal * options.maxDisplacementRatio,
  })

  return {
    matches,
    features: { original: originalFeatures.keypoints.length, scanned: scannedFeatures.keypoints.length },
    scale:    original.scale,
  }
}

export interface FittingOptions {
  ransacThreshold: number
  minInliers:      number
  seed:            number
}

/** One model's answer: the full transform, and how much of the evidence agreed with it. */
export interface ResidualFit {
  /** Maps full-resolution original coordinates to full-resolution scan coordinates. */
  matrix:            Matrix3
  inliers:           number
  inlierRatio:       number
  /** Mean RANSAC reprojection error over the inliers, in working-resolution pixels. */
  reprojectionError: number
}

/** Fit one model to the shared matches, or `null` when RANSAC finds no consensus worth trusting. */
export function fitResidual (
  prepared: PreparedMatches,
  coarse: CoarseResult,
  model: TransformModel,
  options: FittingOptions,
): ResidualFit | null {
  const consensus = ransac(prepared.matches, {
    model,
    threshold:  options.ransacThreshold,
    minInliers: options.minInliers,
    seed:       options.seed,
  })
  if (consensus === null) return null

  // RANSAC's matrix maps the original's working frame onto the rough warp,
  // which lives in that same frame. Scale it back up, then compose: original ->
  // rough -> scan.
  const residual = conjugateScale(consensus.matrix, prepared.scale)

  return {
    matrix:            multiply(coarse.matrix, residual),
    inliers:           consensus.inliers.length,
    inlierRatio:       consensus.inlierRatio,
    reprojectionError: consensus.error,
  }
}
