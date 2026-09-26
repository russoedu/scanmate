"""Where to clamp to black and to white, read from the page itself.

Every pixel is a ratio to its local background: paper sits near 1, ink well
below. The black point is the ratio the darkest 1% of pixels reach, the white
point the one the brightest 1% start at, each kept within bounds - black at most
0.4, white between 0.7 and 1.1.

Read what that does on a real page, because it is **not** "paper to white".
Paper is nearly all of a page and noise spreads it both ways, so its brightest
1% sit above 1 and the white point lands on its 1.1 bound; ink is a few percent
of a text page and softened at scan resolution, so the black point lands on its
0.4 bound. On three real scans that held on every one of 21 pages: ``"auto"``
became a gentle stretch from 0.4 to 1.1, leaving paper light grey (about 220)
and deepening ink. It is kept because it read best - on OCR word recall it beat
fixed points that do whiten the paper. For white paper, pass a fixed
``white_point`` below 1.
"""

from __future__ import annotations

import numpy
from scanmate_ink import GrayImage

from .enhance_options_contract import ContrastPoint, ContrastPoints

_BINS = 256
_MAX_RATIO = 1.5
_BLACK_PERCENTILE = 0.01
_WHITE_PERCENTILE = 0.99


def estimate_contrast_points(gray: GrayImage, background: GrayImage) -> ContrastPoints:
    """Read the clamp points off the page's own histogram.

    :param gray: The page, greyscale.
    :param background: Its local background, the same size.
    :returns: The two points, each held within its bounds.
    """
    ratio = gray.pixels.astype(numpy.float64) / numpy.maximum(
        background.pixels.astype(numpy.float64), 1e-3
    )
    # `Math.round`, half UP - not numpy's `rint`, which goes to even and would
    # put a ratio landing exactly between two bins in the wrong one.
    bins = numpy.floor(ratio / _MAX_RATIO * (_BINS - 1) + 0.5)
    numpy.clip(bins, 0, _BINS - 1, out=bins)
    histogram = numpy.bincount(bins.reshape(-1).astype(numpy.int64), minlength=_BINS)

    total = gray.pixels.size

    return ContrastPoints(
        black_point=_clamp(
            _percentile_bin(histogram, total, _BLACK_PERCENTILE) / (_BINS - 1) * _MAX_RATIO,
            0,
            0.4,
        ),
        white_point=_clamp(
            _percentile_bin(histogram, total, _WHITE_PERCENTILE) / (_BINS - 1) * _MAX_RATIO,
            0.7,
            1.1,
        ),
    )


def resolve_contrast_points(
    white_point: ContrastPoint,
    black_point: ContrastPoint,
    gray: GrayImage,
    background: GrayImage,
) -> ContrastPoints:
    """Fixed points pass through; ``"auto"`` ones are read from the page.

    Computed only if needed - two fixed points never touch the histogram.

    :param white_point: A share of the background, or ``"auto"``.
    :param black_point: The same.
    :param gray: The page, greyscale.
    :param background: Its local background.
    :returns: The resolved points.
    """
    if white_point != "auto" and black_point != "auto":
        return ContrastPoints(white_point=float(white_point), black_point=float(black_point))

    auto = estimate_contrast_points(gray, background)

    return ContrastPoints(
        white_point=auto.white_point if white_point == "auto" else float(white_point),
        black_point=auto.black_point if black_point == "auto" else float(black_point),
    )


def _percentile_bin(histogram: numpy.ndarray, total: int, percentile: float) -> int:
    """The bin at which the cumulative count first reaches ``percentile`` of ``total``."""
    target = total * percentile
    cumulative = 0.0
    for bin_index, count in enumerate(histogram.tolist()):
        cumulative += count
        if cumulative >= target:
            return bin_index

    return len(histogram) - 1


def _clamp(value: float, low: float, high: float) -> float:
    """Held between the two, the TypeScript's way round: ``min(high, max(low, v))``."""
    return min(high, max(low, value))
