"""Nudge an existing transform by whatever residual translation is still measurable."""

from __future__ import annotations

import math

from scanmate_ink import (
    GrayImage,
    Matrix3,
    correlation,
    downscale_gray,
    multiply,
    rebase,
    translation,
    warp_gray,
)

from ..phase_correlation import phase_correlate


def polish_translation(
    original_ink: GrayImage,
    scanned_ink: GrayImage,
    matrix: Matrix3,
    working_size: int = 512,
) -> Matrix3:
    """Re-seat a known transform on this page.

    Exposed because it is occasionally useful on its own: if you already know
    the transform from a previous page of the same batch, this re-seats it on
    the current page for a fraction of the cost of a full alignment.

    :param original_ink: Ink map of the page as printed.
    :param scanned_ink: Ink map of the page as scanned.
    :param matrix: The transform to nudge.
    :param working_size: Longest side the measurement runs at.
    :returns: The nudged transform, or ``matrix`` unchanged when the nudge does
        not improve the ink correlation.
    """
    original = downscale_gray(original_ink, working_size)
    scanned = downscale_gray(scanned_ink, working_size)
    work = rebase(matrix, 1 / original.scale, 1 / scanned.scale)
    warped = warp_gray(scanned.image, work, original.image.width, original.image.height, 0)

    shift = phase_correlate(original.image, warped)
    if not math.isfinite(shift.dx) or not math.isfinite(shift.dy):
        return matrix

    corrected = multiply(work, translation(shift.dx, shift.dy))
    candidate = rebase(corrected, original.scale, scanned.scale)

    before = correlation(original.image, warped)
    after = correlation(
        original.image,
        warp_gray(scanned.image, corrected, original.image.width, original.image.height, 0),
    )

    return candidate if after > before else matrix
