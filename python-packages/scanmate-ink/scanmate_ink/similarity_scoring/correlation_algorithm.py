"""How well two ink images actually overlap.

Every stage of the pipeline proposes a transform; this is the referee. It has
to be a *correlation*, not a difference: the scan is darker, or fainter, or
contrast-stretched by the scanner's own firmware, and a sum of absolute
differences would rank a badly aligned pale scan above a well aligned dark one.
Zero-mean normalised cross correlation is invariant to both of those - it only
asks whether the ink rises and falls in the same places.

WHY EVERY SUM HERE GOES THROUGH A HELPER
-----------------------------------------

Five running totals, each accumulated over every pixel. ``np.sum`` would be the
obvious way to write all five and would disagree with the TypeScript on all
five, because it reduces pairwise while a ``+=`` loop does not. At 3072 pixels
that disagreement is routine rather than rare, so each total goes through
:func:`~..js_semantics.sequential_total`, which the goldens then check.

The means are subtracted before the products are formed, exactly as the
TypeScript does, rather than using the algebraically equal
``E[ab] - E[a]E[b]``. The short form is one pass instead of two and is famously
worse: it subtracts two large nearly equal numbers, and on an image whose ink
barely varies it can return a negative variance.
"""

from __future__ import annotations

import math

import numpy as np

from ..js_semantics import sequential_total
from ..raster_codec import BinaryImage, GrayImage

#: Below this the images carry no variation to correlate, and the ratio would
#: be noise divided by noise.
_DEGENERATE_VARIANCE = 1e-12


def correlation(a: GrayImage, b: GrayImage) -> float:
    """Zero-mean normalised cross correlation of two equally sized images, in ``[-1, 1]``.

    :param a: The first image.
    :param b: The second image, the same size.
    :returns: The correlation, or 0 when either image is flat or empty.
    :raises ValueError: When the two images are different sizes.
    """
    if a.width != b.width or a.height != b.height:
        message = "correlation needs two images of the same size"
        raise ValueError(message)

    n = a.pixels.size
    if n == 0:
        return 0

    values_a = a.pixels.astype(np.float64).reshape(-1)
    values_b = b.pixels.astype(np.float64).reshape(-1)
    mean_a = sequential_total(values_a) / n
    mean_b = sequential_total(values_b) / n

    da = values_a - mean_a
    db = values_b - mean_b
    cov = sequential_total(da * db)
    var_a = sequential_total(da * da)
    var_b = sequential_total(db * db)

    denom = math.sqrt(var_a * var_b)

    return cov / denom if denom > _DEGENERATE_VARIANCE else 0


def intersection_over_union(a: BinaryImage, b: BinaryImage) -> float:
    """Intersection over union of two masks.

    The pixel-level version of "did it land on top of it". Unlike
    :func:`correlation` this is all integer arithmetic, so it is exact by
    construction rather than by careful ordering.

    :param a: The first mask.
    :param b: The second mask, the same size.
    :returns: The ratio, or 0 when both masks are empty.
    :raises ValueError: When the two masks are different sizes.
    """
    if a.width != b.width or a.height != b.height:
        message = "intersection_over_union needs two masks of the same size"
        raise ValueError(message)

    union = int(np.bitwise_or(a.pixels, b.pixels).sum(dtype=np.int64))
    intersection = int(np.bitwise_and(a.pixels, b.pixels).sum(dtype=np.int64))

    return intersection / union if union > 0 else 0


def mean(image: GrayImage) -> float:
    """Mean of a single channel image.

    :param image: The image.
    :returns: The mean, or 0 when the image is empty.
    """
    n = image.pixels.size
    if n == 0:
        return 0

    return sequential_total(image.pixels) / n
