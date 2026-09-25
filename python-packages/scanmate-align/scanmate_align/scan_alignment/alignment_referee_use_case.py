"""How well a proposed transform actually lines the two pages up.

Every candidate in a model sweep is judged the same way, on the same two
downscaled ink maps, so the downscales - and the original's mask - are done once
when the referee is created rather than once per candidate. What is left per
call is one warp and two scores.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from scanmate_ink import (
    GrayImage,
    Matrix3,
    binarize,
    correlation,
    downscale_gray,
    intersection_over_union,
    rebase,
    warp_gray,
)

#: Longest side the referee judges at. Enough to see a stroke line up; cheap
#: enough to call per model.
_REFEREE_SIZE = 800


@dataclass(frozen=True, slots=True)
class Agreement:
    """What one candidate transform achieved."""

    #: Ink correlation after warping, in ``[-1, 1]``.
    correlation: float
    #: Ink mask overlap after warping, in ``[0, 1]``.
    iou: float


def create_referee(
    original_ink: GrayImage,
    scanned_ink: GrayImage,
    working_size: int,
) -> Callable[[Matrix3], Agreement]:
    """Build a judge that scores any transform against these two pages.

    :param original_ink: Ink map of the page as printed.
    :param scanned_ink: Ink map of the page as scanned.
    :param working_size: Caller's working size; capped at 800.
    :returns: A callable taking a matrix and returning its agreement.
    """
    size = min(working_size, _REFEREE_SIZE)
    original = downscale_gray(original_ink, size)
    scanned = downscale_gray(scanned_ink, size)
    original_mask = binarize(original.image)

    def judge(matrix: Matrix3) -> Agreement:
        work = rebase(matrix, 1 / original.scale, 1 / scanned.scale)
        warped = warp_gray(
            scanned.image, work, original.image.width, original.image.height, 0
        )

        return Agreement(
            correlation=correlation(original.image, warped),
            iou=intersection_over_union(original_mask, binarize(warped)),
        )

    return judge


def to_confidence(agreement: Agreement) -> float:
    """A correlation as a confidence.

    Clamped to ``[0, 1]``, because anti-correlated ink is no alignment at all.

    :param agreement: What the referee measured.
    :returns: The confidence, in ``[0, 1]``.
    """
    return max(0, min(1, agreement.correlation))
