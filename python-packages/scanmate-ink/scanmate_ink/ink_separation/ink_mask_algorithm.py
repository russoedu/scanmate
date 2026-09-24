"""Ink to a binary mask, and what you can measure once it is one.

Splitting a continuous ink map into ink-or-paper is a decision rather than a
conversion: :func:`otsu_threshold` picks the cut, :func:`binarize` applies it,
:func:`dilate` gives the result a tolerance band, and :func:`coverage` counts
what survived.

TWO PLACES THE OBVIOUS PYTHON IS THE WRONG PYTHON
-------------------------------------------------

:func:`dilate` rounds its radius with :func:`~..js_semantics.js_round`, not the
built-in ``round``. The built-in rounds half to EVEN and JavaScript rounds half
towards positive infinity, so a radius of 0.5 grows the mask in the TypeScript
and does nothing at all under the built-in. :func:`otsu_threshold` bins with it
too, where - measured - it makes no difference for any in-range value; it is
transcribed rather than simplified because the input type does not promise the
range.

:func:`dilate` is a window-max, and the TypeScript does it as two 1D passes
with an early break. Transcribing those loops literally would be correct and
unbearably slow on a real page, so the passes are done with prefix sums
instead: a window contains ink exactly when its running-count difference is
positive. The arithmetic is integer, so "equivalent" here means identical, not
merely close - the goldens assert it.
"""

from __future__ import annotations

import math

import numpy as np

from ..js_semantics import js_round
from ..raster_codec import BinaryImage, GrayImage

_BINS = 256
_MAX_BIN = _BINS - 1
_BLANK_PAGE_FLOOR = 0.12


def otsu_threshold(image: GrayImage) -> float:
    """Otsu's threshold over a 256-bin histogram of ``[0, 1]`` values.

    :param image: The ink map.
    :returns: The cut, in ``[0, 1]``.
    """
    histogram = [0.0] * _BINS
    for value in image.pixels.astype(np.float64).reshape(-1):
        bin_index = min(_MAX_BIN, max(0, js_round(float(value) * _MAX_BIN)))
        histogram[bin_index] += 1

    total = image.width * image.height
    sum_all = 0.0
    for i in range(_BINS):
        sum_all += i * histogram[i]

    sum_background = 0.0
    weight_background = 0.0
    best = 0
    best_variance = -1.0

    for t in range(_BINS):
        weight_background += histogram[t]
        if weight_background == 0:
            continue
        weight_foreground = total - weight_background
        if weight_foreground == 0:
            break

        sum_background += t * histogram[t]
        mean_background = sum_background / weight_background
        mean_foreground = (sum_all - sum_background) / weight_foreground
        between = weight_background * weight_foreground * (mean_background - mean_foreground) ** 2

        if between > best_variance:
            best_variance = between
            best = t

    return best / _MAX_BIN


def binarize(image: GrayImage, threshold: float | None = None) -> BinaryImage:
    """Ink to a binary mask.

    ``threshold`` defaults to Otsu's, with a floor: a page that is genuinely
    blank has no bimodal split to find, and Otsu will happily cut its noise in
    half and report that 50% of the paper is ink.

    :param image: The ink map.
    :param threshold: An explicit cut; ``None`` asks Otsu.
    :returns: The mask.
    """
    chosen = otsu_threshold(image) if threshold is None else threshold
    t = max(chosen, _BLANK_PAGE_FLOOR)

    return BinaryImage((image.pixels.astype(np.float64) > t).astype(np.uint8))


def _window_hits(mask: np.ndarray, radius: int) -> np.ndarray:
    """One 1D dilation pass along the last axis, by prefix sums.

    :param mask: A ``(rows, columns)`` array of zeros and ones.
    :param radius: Half-width of the window.
    :returns: One where the window holds any set pixel, zero elsewhere.
    """
    columns = mask.shape[1]
    prefix = np.zeros((mask.shape[0], columns + 1), dtype=np.int64)
    np.cumsum(mask, axis=1, out=prefix[:, 1:])

    xs = np.arange(columns)
    start = np.maximum(0, xs - radius)
    stop = np.minimum(columns - 1, xs + radius) + 1

    return (prefix[:, stop] - prefix[:, start] > 0).astype(np.uint8)


def dilate(mask: BinaryImage, radius: float) -> BinaryImage:
    """Morphological dilation by a square, done as two 1D max passes.

    Used to give the original's ink a tolerance band before asking what is new
    in the scan: without it, alignment that is half a pixel off reports the edge
    of every printed character as freshly written.

    :param mask: The mask to grow.
    :param radius: Half-width of the square, rounded the way JavaScript rounds.
    :returns: The dilated mask.
    """
    r = max(0, js_round(radius))
    if r == 0:
        return BinaryImage(mask.pixels.copy())

    horizontal = _window_hits(mask.pixels, r)

    return BinaryImage(_window_hits(horizontal.T, r).T.copy())


def coverage(
    mask: BinaryImage,
    x0: float = 0,
    y0: float = 0,
    x1: float | None = None,
    y1: float | None = None,
) -> float:
    """Fraction of pixels set in ``mask``, restricted to a rectangle when one is given.

    The rectangle is taken in continuous coordinates and snapped OUTWARDS -
    floor on the near edge, ceil on the far one - so a window that clips a pixel
    counts that pixel rather than dropping it.

    :param mask: The mask to measure.
    :param x0: Left edge.
    :param y0: Top edge.
    :param x1: Right edge; the full width when omitted.
    :param y1: Bottom edge; the full height when omitted.
    :returns: The set fraction, or zero for an empty rectangle.
    """
    right_in = mask.width if x1 is None else x1
    bottom_in = mask.height if y1 is None else y1

    left = max(0, math.floor(x0))
    top = max(0, math.floor(y0))
    right = min(mask.width, math.ceil(right_in))
    bottom = min(mask.height, math.ceil(bottom_in))
    if right <= left or bottom <= top:
        return 0

    hits = int(mask.pixels[top:bottom, left:right].sum(dtype=np.int64))

    return hits / ((right - left) * (bottom - top))
