"""Separable resampling: area-average going down, bilinear going up.

Going down matters more than it sounds. Point-sampling a 300 dpi scan to half
size drops every other row, and on a page of 9pt text that deletes roughly half
the strokes - the thumbnail the matcher sees is not a smaller version of the
page, it is a different page. Averaging over the exact source footprint of each
destination pixel is what keeps the ink where it was.

THIS RESAMPLER IS MATCHABLE; THE CODEC'S IS NOT
-----------------------------------------------

``raster_codec`` deliberately ships no ``resample_raster``, because resizing
there means libvips, and Pillow's LANCZOS disagrees with libvips' lanczos3 on
78.8% of pixels - measured. Everything here is scanmate's own arithmetic on
typed arrays, so it is matched bit for bit instead, and the goldens assert it
with ``==``.

WHAT THAT COSTS, AND WHERE
--------------------------

Two things have to be reproduced rather than improved on:

- The intermediate is **float32**. The horizontal pass writes into a
  ``Float32Array`` before the vertical pass reads it, so the rounding between
  the two passes is part of the answer.
- The area average accumulates **left to right**. ``total += src[i] * w`` in a
  loop is not ``np.sum`` of the same products - numpy sums pairwise, which is
  more accurate and a different number. Every accumulation here is a
  ``cumsum``, which is sequential by construction.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from ..js_semantics import js_round
from ..raster_codec import GrayImage, Raster

_RGBA = 4


def _sequential_sum(values: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
    """Sum the last axis strictly left to right, the way a ``+=`` loop does.

    :param values: A ``(rows, terms)`` array.
    :returns: One running-order total per row.
    """
    if values.shape[1] == 0:
        return np.zeros(values.shape[0], dtype=np.float64)

    return np.cumsum(values, axis=1)[:, -1]


def _area_plan(
    src_length: int,
    dst_length: int,
    ratio: float,
) -> tuple[npt.NDArray[np.intp], npt.NDArray[np.float64]]:
    """Which source samples each destination sample averages, and how much of each.

    A source pixel spans ``[i, i + 1)``, and the destination pixel covers
    ``[x * ratio, x * ratio + ratio)``, so the weight is the overlap of the two
    - partial at both ends, one in the middle. Entries outside a destination
    pixel's span carry weight zero, which contributes an exact zero and so is
    indistinguishable from the ``continue`` the TypeScript does there.

    :param src_length: Samples available.
    :param dst_length: Samples wanted.
    :param ratio: ``src_length / dst_length``, greater than one.
    :returns: ``(indices, weights)``, both ``(dst_length, terms)``.
    """
    xs = np.arange(dst_length, dtype=np.float64)
    start = xs * ratio
    end = start + ratio
    first = np.maximum(0, np.floor(start)).astype(np.intp)
    last = np.minimum(src_length, np.ceil(end)).astype(np.intp)

    terms = max(1, int((last - first).max()))
    offsets = np.arange(terms, dtype=np.intp)
    indices = first[:, None] + offsets[None, :]

    covered = indices < last[:, None]
    overlap = np.minimum(end[:, None], indices + 1) - np.maximum(start[:, None], indices)
    weights = np.where(covered & (overlap > 0), overlap, 0.0)

    return np.minimum(indices, src_length - 1), weights


def _resample_axis(
    source: npt.NDArray[np.float32],
    dst_length: int,
) -> npt.NDArray[np.float64]:
    """Resample along the LAST axis, picking the branch the ratio calls for.

    :param source: A ``(rows, src_length)`` float32 array.
    :param dst_length: Samples wanted along the last axis.
    :returns: A ``(rows, dst_length)`` float64 array, not yet narrowed.
    """
    src_length = source.shape[1]
    ratio = src_length / dst_length
    data = source.astype(np.float64)

    if ratio > 1:
        indices, weights = _area_plan(src_length, dst_length, ratio)
        gathered = data[:, indices]
        totals = _sequential_sum((gathered * weights).reshape(-1, weights.shape[1]))
        divisors = _sequential_sum(weights)
        averaged = np.divide(
            totals.reshape(data.shape[0], dst_length),
            divisors,
            out=np.zeros((data.shape[0], dst_length)),
            where=(divisors > 0)[None, :],
        )

        return averaged

    ys = np.arange(dst_length, dtype=np.float64)
    position = np.clip((ys + 0.5) * ratio - 0.5, 0, src_length - 1)
    i0 = np.floor(position).astype(np.intp)
    i1 = np.minimum(src_length - 1, i0 + 1)
    frac = position - i0

    interpolated: npt.NDArray[np.float64] = data[:, i0] * (1 - frac) + data[:, i1] * frac

    return interpolated


def resize_gray(src: GrayImage, width: int, height: int) -> GrayImage:
    """Resize a single channel image to exactly ``width x height``.

    The two passes are separate on purpose rather than for speed: the
    horizontal one narrows to float32 before the vertical one reads it, and
    fusing them would skip that rounding and quietly stop matching.

    :param src: The image to resize.
    :param width: Target width.
    :param height: Target height.
    :returns: The resized image.
    """
    if width == src.width and height == src.height:
        return GrayImage(src.pixels.copy())

    horizontal = _resample_axis(src.pixels, width).astype(np.float32)
    vertical = _resample_axis(np.ascontiguousarray(horizontal.T), height).astype(np.float32)

    return GrayImage(np.ascontiguousarray(vertical.T))


@dataclass(frozen=True, slots=True)
class Downscaled:
    """A shrunk image and the factor that was actually applied to it."""

    image: GrayImage
    #: What the ROUNDED pixel counts imply, not what was requested - every
    #: coordinate recovered in the smaller frame is scaled back up by this.
    scale: float


def downscale_gray(src: GrayImage, max_dimension: int) -> Downscaled:
    """Shrink so the longer side is at most ``max_dimension``.

    :param src: The image to shrink.
    :param max_dimension: The longest side allowed.
    :returns: The image and the factor applied.
    """
    longest = max(src.width, src.height)
    if longest <= max_dimension:
        return Downscaled(GrayImage(src.pixels.copy()), 1)

    scale = max_dimension / longest
    width = max(1, js_round(src.width * scale))
    height = max(1, js_round(src.height * scale))

    return Downscaled(resize_gray(src, width, height), width / src.width)


def _sliding_means(channels: npt.NDArray[np.uint8], radius: int) -> npt.NDArray[np.uint8]:
    """One sliding-window mean pass along the FIRST axis, rounded into bytes.

    The TypeScript keeps a running ``Int32Array`` sum and a running count. The
    window it describes is ``[max(0, i - r), min(length - 1, i + r)]`` and the
    sum is over integers, so prefix sums reproduce it exactly rather than
    approximately - there is no floating-point accumulation to disagree about.

    :param channels: A ``(length, values)`` uint8 array.
    :param radius: Half-width of the window.
    :returns: The same shape, each value the rounded window mean.
    """
    length = channels.shape[0]
    prefix = np.zeros((length + 1, channels.shape[1]), dtype=np.int64)
    np.cumsum(channels, axis=0, out=prefix[1:])

    positions = np.arange(length)
    first = np.maximum(0, positions - radius)
    last = np.minimum(length - 1, positions + radius) + 1
    totals = prefix[last] - prefix[first]
    counts = (last - first).astype(np.float64)[:, None]

    # A `Uint8ClampedArray` store clamps and rounds HALF TO EVEN, which is what
    # `np.rint` does and what `astype(np.uint8)` - a truncation - does not.
    rounded: npt.NDArray[np.uint8] = np.rint(totals / counts).astype(np.uint8)

    return rounded


def box_blur_raster(src: Raster, radius: float) -> Raster:
    """Box blur an RGBA raster with two sliding-window passes.

    Lives here rather than with the other blurs because its only caller is the
    warp prefilter, and because it has to work in bytes: a summed-area table
    over four channels of a 12 megapixel scan is 400 MB, which is not a thing
    to allocate inside a function app.

    :param src: The raster to blur.
    :param radius: Half-width of the window, rounded the way JavaScript rounds.
    :returns: The blurred raster.
    """
    r = max(0, js_round(radius))
    if r == 0:
        return Raster(src.pixels.copy())

    height, width = src.height, src.width
    # The horizontal pass narrows to bytes before the vertical one reads it, so
    # the two are sequenced through a uint8 intermediate rather than fused.
    horizontal = _sliding_means(src.pixels.transpose(1, 0, 2).reshape(width, -1), r)
    rows = horizontal.reshape(width, height, _RGBA).transpose(1, 0, 2)
    vertical = _sliding_means(np.ascontiguousarray(rows).reshape(height, -1), r)

    return Raster(vertical.reshape(height, width, _RGBA))
