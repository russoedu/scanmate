"""How noisy a page is, without a clean copy to compare it to (Immerkær, 1996)."""

from __future__ import annotations

import math

import numpy
from scanmate_ink import GrayImage
from scanmate_ink.js_semantics import sequential_total


def estimate_noise_sigma(gray: GrayImage) -> float:
    """The page's noise level, on the ``[0, 1]`` grey scale.

    The mean absolute response of a Laplacian-difference kernel, scaled so that
    stationary Gaussian noise of standard deviation ``sigma`` scores ``sigma``.
    Text and edges occupy a small share of a page and noise is everywhere, so
    on a document the noise dominates: a clean digital render scores close to
    zero, a speckled scan or photocopy far higher.

    :param gray: The page.
    :returns: The estimated sigma, or ``0`` for a page too small to measure.
    """
    width = gray.width
    height = gray.height
    if width < 3 or height < 3:
        return 0.0

    # float64 for the kernel, matching JavaScript's arithmetic on numbers read
    # out of a Float32Array.
    data = gray.pixels.astype(numpy.float64)
    laplacian = (
        data[:-2, :-2] - 2 * data[:-2, 1:-1] + data[:-2, 2:]
        - 2 * data[1:-1, :-2] + 4 * data[1:-1, 1:-1] - 2 * data[1:-1, 2:]
        + data[2:, :-2] - 2 * data[2:, 1:-1] + data[2:, 2:]
    )
    # Summed left to right, row by row - the order the TypeScript's own loop
    # visits them. `numpy.sum` adds pairwise, which rounds differently in
    # general, and this total is divided down into the answer.
    #
    # Stated plainly: on every page measured here - clean and speckled, from
    # 90x140 up to 600x500 - the two orders give the SAME double, so no test
    # distinguishes them and mutation testing reports this line as replaceable.
    # It is kept because it is the guarantee rather than the observation: the
    # orders are equal for these inputs, not equal by construction, and a page
    # that separated them would separate the two ports too.
    total = sequential_total(numpy.abs(laplacian))

    return total * math.sqrt(math.pi / 2) / (6 * (width - 2) * (height - 2))
