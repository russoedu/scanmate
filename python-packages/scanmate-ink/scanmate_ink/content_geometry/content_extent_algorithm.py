"""Where the printing is.

Feature matching needs the two images at roughly the same scale before its
descriptors mean anything, and nothing in the file headers tells us the dpi the
scanner used. What does tell us is the printing itself: the block of ink on the
page is the same physical object in both images, so the ratio of its measured
sizes is the ratio of the resolutions. Measuring it needs the skew out of the
way first, which is what
:func:`~.estimate_skew_algorithm.estimate_skew` is for.

A FLOOR TURNS A LAST BIT INTO A WHOLE BIN
------------------------------------------

Everywhere else in this package a one-ULP disagreement between Python's and
V8's ``cos`` stays a one-ULP disagreement. Here it does not: the projection is
``floor(x * cos + y * sin - min)``, and a value sitting a hair under an integer
in one runtime and a hair over it in the other lands in a different bucket. The
ink moves whole, and the extent can change by a pixel.

The parity tests measure that rather than assuming it away - at angle zero,
where ``cos`` is exactly 1 and ``sin`` exactly 0, everything is exact, and the
rotated cases are checked against the goldens as they stand.

THE SCATTER-ADD
---------------

``bins[i] += value`` over the pixels in row-major order is a scatter, not a
reduction, and ``np.bincount`` performs it in input order - the same order the
TypeScript's nested loops visit. That is why it is used here rather than
``np.add.at``, which makes no ordering promise, and rather than a hand-rolled
loop, which would be unusably slow on a real page.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from ..js_semantics import sequential_total
from ..plane_geometry import Point
from ..raster_codec import GrayImage

_DEFAULT_TRIM = 0.004


@dataclass(frozen=True, slots=True)
class ContentExtent:
    """The measured block of ink, in the frame it was measured in."""

    #: Extent along the rotated axes, in pixels.
    width: float
    height: float
    #: Centre of the extent, back in unrotated image coordinates.
    center: Point
    #: The angle the extent was measured at, in radians.
    angle: float
    #: Mean ink over the whole image. Near zero means there was nothing to measure.
    density: float


def _trimmed_span(bins: npt.NDArray[np.float64], total: float, trim: float) -> tuple[int, int]:
    """First and last bin holding all but ``trim`` of the mass at each end.

    Transcribed as two running loops rather than a ``searchsorted`` on a
    cumulative sum: the comparison is ``> cutoff`` on a running total, and a
    cumulative sum built by a different summation order would cross the cutoff
    at a different index. The arrays are a few dozen bins long, so the loop
    costs nothing.

    :param bins: The projected mass per bin.
    :param total: The mass across all bins.
    :param trim: Fraction discarded from each end.
    :returns: ``(low, high + 1)``, a half-open bin range.
    """
    cutoff = total * trim

    accumulated = 0.0
    low = 0
    while low < bins.size:
        accumulated += float(bins[low])
        if accumulated > cutoff:
            break
        low += 1

    accumulated = 0.0
    high = bins.size - 1
    while high > low:
        accumulated += float(bins[high])
        if accumulated > cutoff:
            break
        high -= 1

    return low, high + 1


def content_extent(
    ink: GrayImage,
    angle: float = 0,
    trim: float = _DEFAULT_TRIM,
) -> ContentExtent:
    """Extent of the ink along axes rotated by ``angle``, trimming outliers.

    ``trim`` is a fraction of the total ink discarded from each end of each
    axis. A scanner that clips a black strip down one edge, or a speck of dust,
    would otherwise set the page boundary - and since this measurement becomes
    the scale estimate, a 2% error here is a 2% error in every coordinate
    downstream.

    :param ink: The ink map.
    :param angle: The angle to measure along, in radians.
    :param trim: Fraction of the ink discarded from each end of each axis.
    :returns: The extent, its centre and the image's ink density.
    """
    width, height = ink.width, ink.height
    cos = math.cos(angle)
    sin = math.sin(angle)

    corner_x = np.array([0, width, 0, width], dtype=np.float64)
    corner_y = np.array([0, 0, height, height], dtype=np.float64)
    us = corner_x * cos + corner_y * sin
    vs = -corner_x * sin + corner_y * cos
    min_u, max_u = float(us.min()), float(us.max())
    min_v, max_v = float(vs.min()), float(vs.max())

    u_bins_length = math.ceil(max_u - min_u) + 2
    v_bins_length = math.ceil(max_v - min_v) + 2

    data = ink.pixels.astype(np.float64)
    px = (np.arange(width, dtype=np.float64) + 0.5)[None, :]
    py = (np.arange(height, dtype=np.float64) + 0.5)[:, None]
    u_index = np.floor(px * cos + py * sin - min_u).astype(np.intp)
    v_index = np.floor(-px * sin + py * cos - min_v).astype(np.intp)

    # `value <= 0: continue` - paper contributes nothing. Numerically this is a
    # no-op, since binning a zero adds an exact zero and summing one leaves the
    # total unchanged; mutation testing confirms `>= 0` gives identical results
    # everywhere. It is kept because it is what the TypeScript does, and
    # because skipping the paper is most of the work on a real page.
    inked = data > 0
    values = data[inked]
    u_bins = np.bincount(
        np.broadcast_to(u_index, data.shape)[inked],
        weights=values,
        minlength=u_bins_length,
    )
    v_bins = np.bincount(
        np.broadcast_to(v_index, data.shape)[inked],
        weights=values,
        minlength=v_bins_length,
    )
    total = sequential_total(values)

    if total <= 0:
        # Nothing printed: report the whole frame rather than an empty box, so
        # the caller falls back to fitting the page frame instead of dividing
        # by zero.
        return ContentExtent(
            width=width,
            height=height,
            center=Point(width / 2, height / 2),
            angle=angle,
            density=0,
        )

    u0, u1 = _trimmed_span(u_bins, total, trim)
    v0, v1 = _trimmed_span(v_bins, total, trim)

    center_u = min_u + (u0 + u1) / 2
    center_v = min_v + (v0 + v1) / 2

    # `max(1, ...)` can never bind: the high loop stops at `high > low`, so
    # `high + 1 - low` is at least 1 already. Transcribed rather than dropped,
    # because it is the TypeScript's own guard and the invariant behind it is
    # not obvious from the two loops.
    return ContentExtent(
        width=max(1, u1 - u0),
        height=max(1, v1 - v0),
        center=Point(center_u * cos - center_v * sin, center_u * sin + center_v * cos),
        angle=angle,
        density=total / (width * height),
    )
