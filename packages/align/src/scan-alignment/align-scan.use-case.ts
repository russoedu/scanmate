import { decodeImage, decompose, encodeImage, inkMap, invert, toGrayscale, warpRaster } from '@scanmate/ink'
import type { ScanmateSource, Matrix3, TransformModel } from '@scanmate/ink'

import { estimateCoarse } from '../coarse-estimation'
import type { AlignOptions, AlignResult, ModelAttempt } from './align-result.contract'
import { createReferee, toConfidence } from './alignment-referee.use-case'
import type { Agreement } from './alignment-referee.use-case'
import { fitResidual, prepareMatches } from './feature-refinement.algorithm'
import type { ResidualFit } from './feature-refinement.algorithm'
import { DEFAULT_MODELS, prefers, sweepOrder } from './model-selection.policy'

/** The best fit so far in a sweep, with everything needed to return it without recomputing. */
interface Contender {
  model:      TransformModel
  fit:        ResidualFit
  agreement:  Agreement
  confidence: number
  attempt:    ModelAttempt
}

/**
 * Align a scan onto the page it was made from.
 *
 * ## What this is for
 *
 * Two questions about a returned form are easy to answer once the scan sits
 * exactly on top of the original, and near-impossible before:
 *
 * 1. *Was anything in the printed text changed?* Run OCR on both and diff.
 *    That only works if the two are the same page at the same size, otherwise
 *    the OCR engine's own layout analysis is comparing different documents.
 * 2. *Was the box at (x, y) signed?* That is a question about a fixed
 *    rectangle, and a fixed rectangle only means something once both images
 *    agree on where (x, y) is. See the pixel comparison.
 *
 * ## The pipeline
 *
 * ```text
 *   decode ─► ink ─► coarse guess ─► rough warp ─► features ─┬─► RANSAC(similarity) ─► score ─┐
 *                    (scale/skew)                   (ORB)     ├─► RANSAC(affine)     ─► score ─┼─► warp
 *                                                             └─► RANSAC(homography) ─► score ─┘
 *   └──────────────────── once, whatever the model ───────────┘   └──── per model, cheap ────┘
 * ```
 *
 * The coarse guess exists to make the feature stage possible at all: binary
 * descriptors compare fixed pixel offsets, so they only match between images
 * at comparable scale, and nothing in a JPEG tells you what dpi it was scanned
 * at. Once the scan has been resampled to roughly the right size, matching is
 * easy and RANSAC can throw away the inevitable wrong matches - a page of text
 * is full of genuinely identical-looking corners.
 *
 * ## Choosing the model
 *
 * With `model: 'all'`, the default, everything left of the fork is done once:
 * decoding, ink separation, the coarse search, ORB on both pages and matching
 * are nearly all of the cost and do not depend on the transform family. Only
 * RANSAC and one scoring warp run per model, and neither is expensive - RANSAC
 * touches no pixels. The sweep tries models cheapest first, stops as soon as one
 * reaches `confidenceTarget`, and a more complex model must beat a simpler one by
 * `modelPreferenceMargin` to replace it. The full-resolution warp and the
 * encode happen once, for the winner.
 *
 * If no model finds a consensus (a nearly blank form has few corners to find),
 * the coarse estimate is returned on its own, and `method` says so.
 *
 * ## Why it is asynchronous
 *
 * The estimator is CPU-bound with no I/O to wait on, and an earlier version of
 * this function was synchronous to say so. The codec changed that: decoding and
 * encoding now run in libvips on libuv's threadpool, roughly an order of
 * magnitude faster than the pure-JavaScript codec they replaced, and during
 * those two stages the event loop genuinely is free. Between them it is not -
 * the coarse search, ORB and RANSAC all run to completion on this thread - so
 * to align several pages at once, still put this in a worker thread.
 */
export async function alignScan (
  original: ScanmateSource,
  scanned: ScanmateSource,
  options: AlignOptions = {},
): Promise<AlignResult> {
  const startedAt = Date.now()
  const {
    model = 'all',
    confidenceTarget = 0.9,
    models = DEFAULT_MODELS,
    modelPreferenceMargin = 0.02,
    workingSize = 1400,
    coarseSize = 512,
    maxFeatures = 1200,
    ransacThreshold = 3,
    minInliers = 12,
    maxSkewDeg = 12,
    maxScaleRatio = 6,
    maxDisplacementRatio = 0.12,
    ink,
    interpolation = 'bilinear',
    background = [255, 255, 255, 255],
    output = 'png',
    quality = 92,
    seed = 0x5CA7F1,
  } = options

  const candidates = model === 'all' ? sweepOrder(models) : [model]

  const originalRaster = await decodeImage(original)
  const scannedRaster = await decodeImage(scanned)

  const originalInk = inkMap(toGrayscale(originalRaster), ink)
  const scannedInk = inkMap(toGrayscale(scannedRaster), ink)

  // --- Model-independent, and nearly all of the cost: done once. ---

  const coarse = estimateCoarse(originalInk, scannedInk, {
    workingSize: coarseSize,
    maxSkewDeg,
    maxScaleRatio,
  })
  const prepared = prepareMatches(originalInk, scannedInk, coarse, {
    workingSize,
    maxFeatures,
    maxDisplacementRatio,
    seed,
  })
  const judge = createReferee(originalInk, scannedInk, workingSize)

  // --- Per model: RANSAC, one scoring warp. ---

  const attempts: ModelAttempt[] = []
  let best: Contender | null = null

  for (const candidate of candidates) {
    const fit = fitResidual(prepared, coarse, candidate, { ransacThreshold, minInliers, seed })
    if (fit === null) {
      attempts.push({
        model:             candidate,
        confidence:        null,
        inliers:           0,
        inlierRatio:       0,
        reprojectionError: NaN,
        rejected:          true,
        selected:          false,
      })
      continue
    }

    const agreement = judge(fit.matrix)
    const confidence = toConfidence(agreement)
    const attempt: ModelAttempt = {
      model:             candidate,
      confidence,
      inliers:           fit.inliers,
      inlierRatio:       fit.inlierRatio,
      reprojectionError: fit.reprojectionError,
      rejected:          false,
      selected:          false,
    }
    attempts.push(attempt)

    if (prefers({ model: candidate, confidence }, best, modelPreferenceMargin))
      best = { model: candidate, fit, agreement, confidence, attempt }

    if (best !== null && best.confidence >= confidenceTarget) break
  }

  // --- Once, for the winner: the full-resolution warp and the encode. ---

  const matrix: Matrix3 = best === null ? coarse.matrix : best.fit.matrix
  const agreement = best === null ? judge(matrix) : best.agreement
  // The coarse estimate is a similarity; that is what it reports when it stands alone.
  const selectedModel: TransformModel = best === null ? 'similarity' : best.model
  if (best !== null) best.attempt.selected = true

  const raster = warpRaster(scannedRaster, matrix, originalRaster.width, originalRaster.height, {
    background,
    interpolation,
    prefilter: true,
  })

  return {
    raster,
    image:       output === 'none' ? null : await encodeImage(raster, { format: output, quality }),
    // The aligned pixels sit on the original's canvas, so they are at its resolution.
    dpi:         null,
    width:       raster.width,
    height:      raster.height,
    matrix,
    inverse:     invert(matrix),
    transform:   decompose(matrix, selectedModel),
    confidence:  toConfidence(agreement),
    method:      best === null ? 'coarse' : 'features',
    diagnostics: {
      coarseScore:    coarse.score,
      coarseStrategy: coarse.strategy,
      skewDeg:        {
        original: (coarse.skew.original * 180) / Math.PI,
        scanned:  (coarse.skew.scanned * 180) / Math.PI,
      },
      features:              prepared.features,
      matches:               prepared.matches.length,
      inliers:               best?.fit.inliers ?? 0,
      inlierRatio:           best?.fit.inlierRatio ?? 0,
      reprojectionError:     best?.fit.reprojectionError ?? NaN,
      correlation:           agreement.correlation,
      intersectionOverUnion: agreement.iou,
      selectedModel,
      attempts,
      durationMs:            Date.now() - startedAt,
    },
  }
}
