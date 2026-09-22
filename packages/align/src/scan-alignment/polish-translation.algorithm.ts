import { correlation, downscaleGray, multiply, rebase, translation, warpGray } from '@scanmate/ink'
import type { GrayImage, Matrix3 } from '@scanmate/ink'

import { phaseCorrelate } from '../phase-correlation'

/**
 * Nudge an existing transform by whatever residual translation is still measurable.
 *
 * Exposed because it is occasionally useful on its own: if you already know the
 * transform from a previous page of the same batch, this re-seats it on the
 * current page for a fraction of the cost of a full alignment.
 */
export function polishTranslation (
  originalInk: GrayImage,
  scannedInk: GrayImage,
  matrix: Matrix3,
  workingSize = 512,
): Matrix3 {
  const original = downscaleGray(originalInk, workingSize)
  const scanned = downscaleGray(scannedInk, workingSize)
  const work = rebase(matrix, 1 / original.scale, 1 / scanned.scale)
  const warped = warpGray(scanned.image, work, original.image.width, original.image.height, 0)

  const shift = phaseCorrelate(original.image, warped)
  if (!Number.isFinite(shift.dx) || !Number.isFinite(shift.dy)) return matrix

  const corrected = multiply(work, translation(shift.dx, shift.dy))
  const candidate = rebase(corrected, original.scale, scanned.scale)

  const before = correlation(original.image, warped)
  const after = correlation(
    original.image,
    warpGray(scanned.image, corrected, original.image.width, original.image.height, 0),
  )

  return after > before ? candidate : matrix
}
