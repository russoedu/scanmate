"""Which way up the printing is.

:func:`~.content_extent_algorithm.content_extent` cannot measure the block of
ink until the skew is out of the way, so this runs first and hands it an angle.

WHY THE SEARCH LOOP IS TRANSCRIBED RATHER THAN TIDIED
------------------------------------------------------

The refinement loops advance by ``deg += step`` with a fractional step, so the
angles they visit are the ones floating-point addition produces, not the ones
``np.arange`` or ``np.linspace`` would produce. Starting from 5.0 in steps of
0.2, the sixth value is 6.000000000000001 rather than 6. A rewritten loop
visits slightly different angles, scores them, and can pick a different one.

The ``+ 1e-9`` on the upper bound is part of that and is kept exactly where the
TypeScript has it: without it the accumulated error drops the final angle of
each sweep about half the time.

The argmax is a strict ``>``, so the FIRST angle reaching the best score wins.
With a fractional step the scores at adjacent angles are close together, which
is precisely when a ``>=`` would pick a different one.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from ..js_semantics import sequential_total
from ..raster_codec import GrayImage

_DEFAULT_MAX_ANGLE_DEG = 12
_TO_RAD = math.pi / 180
#: Span and step of each refinement sweep, coarse to fine.
_REFINEMENTS = ((1, 0.2), (0.2, 0.04))
#: Guard on the sweep's upper bound; see the module docstring.
_SWEEP_EPSILON = 1e-9


@dataclass(frozen=True, slots=True)
class SkewOptions:
    """How far :func:`estimate_skew` looks."""

    #: Largest skew to consider, in degrees, in either direction.
    max_angle_deg: float = _DEFAULT_MAX_ANGLE_DEG
    #: Longest side of the image the search runs on. Skew does not need detail.
    working_size: int | None = None


def profile_sharpness(ink: GrayImage, angle: float) -> float:
    """Sum of squares of the ink profile projected onto the axis perpendicular to ``angle``.

    :param ink: The ink map.
    :param angle: The angle to project along, in radians.
    :returns: The sharpness score; larger means the ink stacks into fewer bins.
    """
    width, height = ink.width, ink.height
    cos = math.cos(angle)
    sin = math.sin(angle)
    offset = max(0, -width * sin)
    bins_length = math.ceil(height * cos + width * abs(sin)) + 2

    data = ink.pixels.astype(np.float64)
    y_cos = (np.arange(height, dtype=np.float64) + 0.5)[:, None] * cos + offset
    px = (np.arange(width, dtype=np.float64) + 0.5)[None, :]
    index = np.floor(y_cos - px * sin).astype(np.intp)

    keep = (data > 0) & (index >= 0) & (index < bins_length)
    bins = np.bincount(
        np.broadcast_to(index, data.shape)[keep],
        weights=data[keep],
        minlength=bins_length,
    )

    return sequential_total(bins * bins)


def estimate_skew(ink: GrayImage, options: SkewOptions | None = None) -> float:
    """The page's own skew, in radians, from the sharpness of its ink profile.

    Rotate the page until the rows of text stack up: at the right angle every
    line of type falls into one bin of the projection histogram and the profile
    is a comb of tall spikes; a degree off and each line smears across several
    bins. Sum of squares rewards exactly that concentration - same total ink,
    fewer bins, bigger number. Searched coarse to fine so the cost stays flat.

    :param ink: The ink map.
    :param options: How far to look.
    :returns: The estimated skew, in radians.
    """
    settings = options or SkewOptions()
    max_angle_deg = settings.max_angle_deg

    best = 0.0
    best_score = -math.inf
    deg = -max_angle_deg
    while deg <= max_angle_deg:
        score = profile_sharpness(ink, deg * _TO_RAD)
        if score > best_score:
            best_score = score
            best = deg
        deg += 1

    for span, step in _REFINEMENTS:
        local_best = best
        deg = best - span
        while deg <= best + span + _SWEEP_EPSILON:
            score = profile_sharpness(ink, deg * _TO_RAD)
            if score > best_score:
                best_score = score
                local_best = deg
            deg += step
        best = local_best

    return best * _TO_RAD
