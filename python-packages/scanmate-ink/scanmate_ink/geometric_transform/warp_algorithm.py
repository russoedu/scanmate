"""Resampling one image onto another image's grid.

The matrix maps **destination coordinates to source coordinates** - we stand on
each output pixel and reach back into the scan for its colour. Doing it the
other way, pushing scan pixels forward, leaves the output full of pinholes
wherever the transform stretches, for the same reason a rotated stencil sprays
gaps.

TWO BILINEAR READS THAT LOOK IDENTICAL AND ARE NOT
--------------------------------------------------

:func:`sample_gray_bilinear` computes ``p00 * (1 - fx) * (1 - fy)``, while the
raster path precomputes ``w00 = (1 - fx) * (1 - fy)`` and then multiplies. Same
algebra, different bracketing, and floating-point multiplication is not
associative, so each is transcribed as written rather than factored into one
helper.

How much that matters differs by path, and the tests say which is which.
Against the gray reader it is directly observable - three sample positions
where the two bracketings give different doubles are pinned in the goldens,
found by search rather than chosen. Against the RASTER readers it is not: the
result is clamped and rounded into a byte immediately, and a one-ULP move in a
value between 0 and 255 flips that byte only within about 3e-14 of a half.
Measured, over 300 random warps each: swapping the bilinear bracketing changed
zero bytes, and so did nesting :func:`_sample_bicubic`'s two loops the other
way round. Both stay transcribed as written anyway - the next caller may not
round to a byte - but no test claims to pin them, because none can.

Their BOUNDS differ too, and that is not an accident either.
:func:`warp_raster` rejects a sample at ``u < -1`` or ``u > width``, while
:func:`sample_gray_bilinear` rejects at ``u <= -1`` or ``u >= width``. The
closed and open ends land differently on exact integers, which is precisely
where a page edge sits.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt

from ..plane_geometry import Matrix3
from ..raster_codec import GrayImage, Raster
from .resize_gray_algorithm import box_blur_raster

Interpolation = Literal["nearest", "bilinear", "bicubic"]

_RGBA = 4
_BYTE_MAX = 255
_WHITE: tuple[int, int, int, int] = (255, 255, 255, 255)
_PREFILTER_THRESHOLD = 1.25


@dataclass(frozen=True, slots=True)
class WarpOptions:
    """How :func:`warp_raster` fills, samples and prefilters."""

    #: RGBA fill for destination pixels that fall outside the source.
    background: tuple[int, int, int, int] = _WHITE
    interpolation: Interpolation = "bilinear"
    #: Low-pass the source before minifying, so shrinking a 300 dpi scan does
    #: not alias the text into stripes. On by default; it costs one blur.
    prefilter: bool = True


def _destination_grid(
    matrix: Matrix3,
    width: int,
    height: int,
) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.float64], npt.NDArray[np.bool_]]:
    """Map every destination pixel centre back into continuous source indices.

    Pixel ``k`` spans ``[k, k + 1)`` with its centre at ``k + 0.5``, so the
    sample index is that centre minus a half. Getting this off by a half pixel
    is the classic resampling bug, and it shifts the whole page rather than
    breaking anything visibly.

    :param matrix: Destination to source.
    :param width: Destination width.
    :param height: Destination height.
    :returns: ``(u, v, finite)``, where ``finite`` is false where ``w`` is zero.
    """
    m0, m1, m2, m3, m4, m5, m6, m7, m8 = matrix
    dx = (np.arange(width, dtype=np.float64) + 0.5)[None, :]
    dy = (np.arange(height, dtype=np.float64) + 0.5)[:, None]

    w = m6 * dx + m7 * dy + m8
    finite = w != 0
    safe = np.where(finite, w, 1.0)
    u = (m0 * dx + m1 * dy + m2) / safe - 0.5
    v = (m3 * dx + m4 * dy + m5) / safe - 0.5

    return np.broadcast_to(u, (height, width)), np.broadcast_to(v, (height, width)), finite


def _clamp_index(value: npt.NDArray[np.intp], length: int) -> npt.NDArray[np.intp]:
    """Pull an index inside the image, repeating the edge pixel outside it.

    :param value: Candidate indices.
    :param length: The axis length.
    :returns: Indices in ``[0, length)``.
    """
    return np.clip(value, 0, length - 1)


def sample_gray_bilinear(image: GrayImage, u: float, v: float, fill: float = 0) -> float:
    """Bilinear read at a fractional index, returning ``fill`` outside the image.

    :param image: The image to read.
    :param u: Fractional column index.
    :param v: Fractional row index.
    :param fill: Returned when the index is outside the image.
    :returns: The interpolated value.
    """
    width, height = image.width, image.height
    if u <= -1 or v <= -1 or u >= width or v >= height:
        return fill

    pixels = image.pixels
    x0, y0 = math.floor(u), math.floor(v)
    fx, fy = u - x0, v - y0

    cx0, cx1 = min(max(x0, 0), width - 1), min(max(x0 + 1, 0), width - 1)
    cy0, cy1 = min(max(y0, 0), height - 1), min(max(y0 + 1, 0), height - 1)

    p00, p10 = float(pixels[cy0, cx0]), float(pixels[cy0, cx1])
    p01, p11 = float(pixels[cy1, cx0]), float(pixels[cy1, cx1])

    return p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy


def warp_gray(
    source: GrayImage,
    matrix: Matrix3,
    width: int,
    height: int,
    fill: float = 0,
) -> GrayImage:
    """Warp a single channel image. Used for scoring, where colour is noise.

    :param source: The image to read from.
    :param matrix: Destination to source.
    :param width: Destination width.
    :param height: Destination height.
    :param fill: Value for destination pixels outside the source.
    :returns: The warped image.
    """
    u, v, finite = _destination_grid(matrix, width, height)
    data = source.pixels.astype(np.float64)
    src_width, src_height = source.width, source.height

    inside = finite & (u > -1) & (v > -1) & (u < src_width) & (v < src_height)
    x0 = np.floor(np.where(inside, u, 0)).astype(np.intp)
    y0 = np.floor(np.where(inside, v, 0)).astype(np.intp)
    fx = np.where(inside, u, 0) - x0
    fy = np.where(inside, v, 0) - y0

    cx0, cx1 = _clamp_index(x0, src_width), _clamp_index(x0 + 1, src_width)
    cy0, cy1 = _clamp_index(y0, src_height), _clamp_index(y0 + 1, src_height)

    sampled = (
        data[cy0, cx0] * (1 - fx) * (1 - fy)
        + data[cy0, cx1] * fx * (1 - fy)
        + data[cy1, cx0] * (1 - fx) * fy
        + data[cy1, cx1] * fx * fy
    )

    return GrayImage(np.where(inside, sampled, fill).astype(np.float32))


def _apply_prefilter(source: Raster, matrix: Matrix3) -> Raster:
    """Blur the source when the warp is a minification.

    ``sqrt(|det|)`` of the linear part is how many source pixels land on one
    destination pixel along an average direction; when that is comfortably
    above one, a point sample is reading one of them and discarding the rest.

    :param source: The raster about to be warped.
    :param matrix: Destination to source.
    :returns: The source, blurred or untouched.
    """
    det = abs(matrix[0] * matrix[4] - matrix[1] * matrix[3])
    scale = math.sqrt(det)
    if not math.isfinite(scale) or scale <= _PREFILTER_THRESHOLD:
        return source

    return box_blur_raster(source, (scale - 1) / 2)


def _catmull_rom_weights(t: npt.NDArray[np.float64]) -> list[npt.NDArray[np.float64]]:
    """Catmull-Rom basis at ``t``, in the TypeScript's own bracketing.

    :param t: The fractional position within a pixel.
    :returns: The four weights, in index order.
    """
    t2 = t * t
    t3 = t2 * t

    return [
        0.5 * (-t3 + 2 * t2 - t),
        0.5 * (3 * t3 - 5 * t2 + 2),
        0.5 * (-3 * t3 + 4 * t2 + t),
        0.5 * (t3 - t2),
    ]


def _sample_nearest(
    data: npt.NDArray[np.float64],
    u: npt.NDArray[np.float64],
    v: npt.NDArray[np.float64],
) -> npt.NDArray[np.float64]:
    """Point sample at the rounded index.

    :param data: The source, ``(height, width, 4)`` float64.
    :param u: Fractional column indices.
    :param v: Fractional row indices.
    :returns: The sampled pixels.
    """
    height, width = data.shape[0], data.shape[1]
    # `floor(x + 0.5)` is the vector form of `js_round`: JavaScript's Math.round,
    # not numpy's `rint`, which would round half to EVEN and disagree on every
    # sample landing exactly between two pixels.
    x = _clamp_index(np.floor(u + 0.5).astype(np.intp), width)
    y = _clamp_index(np.floor(v + 0.5).astype(np.intp), height)

    return data[y, x]


def _sample_bilinear(
    data: npt.NDArray[np.float64],
    u: npt.NDArray[np.float64],
    v: npt.NDArray[np.float64],
) -> npt.NDArray[np.float64]:
    """Bilinear read with PRECOMPUTED corner weights.

    Deliberately bracketed differently from :func:`sample_gray_bilinear`; the
    module docstring says why the two are not shared.

    :param data: The source, ``(height, width, 4)`` float64.
    :param u: Fractional column indices.
    :param v: Fractional row indices.
    :returns: The sampled pixels.
    """
    height, width = data.shape[0], data.shape[1]
    x0, y0 = np.floor(u).astype(np.intp), np.floor(v).astype(np.intp)
    fx, fy = (u - x0)[..., None], (v - y0)[..., None]

    cx0, cx1 = _clamp_index(x0, width), _clamp_index(x0 + 1, width)
    cy0, cy1 = _clamp_index(y0, height), _clamp_index(y0 + 1, height)

    return (
        data[cy0, cx0] * ((1 - fx) * (1 - fy))
        + data[cy0, cx1] * (fx * (1 - fy))
        + data[cy1, cx0] * ((1 - fx) * fy)
        + data[cy1, cx1] * (fx * fy)
    )


def _sample_bicubic(
    data: npt.NDArray[np.float64],
    u: npt.NDArray[np.float64],
    v: npt.NDArray[np.float64],
) -> npt.NDArray[np.float64]:
    """Catmull-Rom over a 4x4 neighbourhood: sharper strokes than bilinear when upscaling.

    The row totals are summed before the column total, and both sums run in
    index order, matching the TypeScript's nesting. Swapping that nesting is
    not observable through :func:`warp_raster` - see the module docstring - so
    it is faithfulness rather than a pinned contract.

    :param data: The source, ``(height, width, 4)`` float64.
    :param u: Fractional column indices.
    :param v: Fractional row indices.
    :returns: The sampled pixels.
    """
    height, width = data.shape[0], data.shape[1]
    x0, y0 = np.floor(u).astype(np.intp), np.floor(v).astype(np.intp)
    wx = _catmull_rom_weights(u - x0)
    wy = _catmull_rom_weights(v - y0)

    total = np.zeros((*u.shape, _RGBA), dtype=np.float64)
    for j in range(4):
        y = _clamp_index(y0 - 1 + j, height)
        row_total = np.zeros_like(total)
        for i in range(4):
            x = _clamp_index(x0 - 1 + i, width)
            row_total = row_total + data[y, x] * wx[i][..., None]
        total = total + row_total * wy[j][..., None]

    return total


_SAMPLERS = {
    "nearest": _sample_nearest,
    "bilinear": _sample_bilinear,
    "bicubic": _sample_bicubic,
}


def warp_raster(
    source: Raster,
    matrix: Matrix3,
    width: int,
    height: int,
    options: WarpOptions | None = None,
) -> Raster:
    """Warp an RGBA raster onto a ``width x height`` canvas.

    :param source: The raster to read from.
    :param matrix: Destination to source.
    :param width: Destination width.
    :param height: Destination height.
    :param options: Fill, interpolation and prefilter.
    :returns: The warped raster.
    """
    settings = options or WarpOptions()
    src = _apply_prefilter(source, matrix) if settings.prefilter else source
    data = src.pixels.astype(np.float64)

    u, v, finite = _destination_grid(matrix, width, height)
    inside = finite & (u >= -1) & (v >= -1) & (u <= src.width) & (v <= src.height)
    safe_u = np.where(inside, u, 0)
    safe_v = np.where(inside, v, 0)

    sampled = _SAMPLERS[settings.interpolation](data, safe_u, safe_v)
    filled = np.where(
        inside[..., None],
        sampled,
        np.asarray(settings.background, dtype=np.float64),
    )

    return Raster(np.rint(np.clip(filled, 0, _BYTE_MAX)).astype(np.uint8))
