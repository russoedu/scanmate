"""A first, cheap answer good enough to make the expensive one possible.

Descriptor matching has a blind spot: BRIEF compares fixed pixel offsets, so a
scan at 300 dpi and a page rendered at 150 describe the same corner with two
unrelated bit strings. Something has to establish roughly how big the scan is
before the matcher runs, and nothing in the file says.

So guess, several ways, and let the pixels judge:

- **frame** - assume the scan is the whole page, so the frames correspond.
- **content** - assume the *printing* corresponds. Robust to a scan with wider
  margins, which the frame guess gets badly wrong.
- **deskew** - measure each page's own skew, and match the printing in the
  frame where each sits straight. This is the one that usually wins.

Each gets a phase-correlation nudge, then all of them are warped and scored on
ink correlation. Guessing several times and measuring is far more robust than
one clever guess, and at this resolution each attempt costs very little.

WHAT THIS SLICE INHERITS
-------------------------

Everything :mod:`..phase_correlation` inherits, because it calls it: the FFT's
``sin(+/- pi / 4)`` seam and the Hann window's ``Math.cos`` one. The nudge it
produces feeds a matrix that is then scored, so the tolerance follows it
through - but only into the *polished* candidates, and only as far as the
correlation score. Which candidate WINS is a comparison between scores that are
far apart, so it is exact.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from scanmate_ink import (
    ContentExtent,
    GrayImage,
    Matrix3,
    Point,
    SkewOptions,
    content_extent,
    correlation,
    downscale_gray,
    estimate_skew,
    is_plausible,
    multiply,
    rebase,
    similarity,
    translation,
    warp_gray,
)

from ..phase_correlation import phase_correlate


@dataclass(frozen=True, slots=True)
class CoarseOptions:
    """How hard to look, and what to refuse."""

    #: Longest side of the images the search runs on.
    working_size: int = 512
    #: Largest per-page skew considered, in degrees.
    max_skew_deg: float = 12
    #: Largest scale ratio between the two images that will be entertained.
    max_scale_ratio: float = 6


@dataclass(frozen=True, slots=True)
class PageSkew:
    """Each page's own measured skew, in radians."""

    original: float
    scanned: float


@dataclass(frozen=True, slots=True)
class CoarseResult:
    """The winning guess, and how it did."""

    #: Maps full-resolution original coordinates to full-resolution scan
    #: coordinates.
    matrix: Matrix3
    #: Ink correlation achieved by this transform, in ``[-1, 1]``.
    score: float
    #: Which guess won, for diagnostics.
    strategy: str
    skew: PageSkew


@dataclass(frozen=True, slots=True)
class _Candidate:
    strategy: str
    matrix: Matrix3


def estimate_coarse(
    original_ink: GrayImage,
    scanned_ink: GrayImage,
    options: CoarseOptions | None = None,
) -> CoarseResult:
    """Guess the scan's scale and skew, several ways, and keep the best.

    :param original_ink: Ink map of the page as it was printed.
    :param scanned_ink: Ink map of the page as it came back.
    :param options: Search settings; the defaults are the TypeScript's.
    :returns: The winning transform, its score, and both pages' skew.
    """
    opts = CoarseOptions() if options is None else options

    original = downscale_gray(original_ink, opts.working_size)
    scanned = downscale_gray(scanned_ink, opts.working_size)

    skew_options = SkewOptions(max_angle_deg=opts.max_skew_deg)
    original_skew = estimate_skew(original.image, skew_options)
    scanned_skew = estimate_skew(scanned.image, skew_options)

    original_flat = content_extent(original.image, 0)
    scanned_flat = content_extent(scanned.image, 0)
    original_tilted = content_extent(original.image, original_skew)
    scanned_tilted = content_extent(scanned.image, scanned_skew)

    candidates: list[_Candidate] = []

    frame_scale = _geometric_mean(
        scanned.image.width / original.image.width,
        scanned.image.height / original.image.height,
    )
    _push(
        candidates,
        "frame",
        similarity(
            frame_scale,
            0,
            Point(original.image.width / 2, original.image.height / 2),
            Point(scanned.image.width / 2, scanned.image.height / 2),
        ),
        opts.max_scale_ratio,
    )

    if original_flat.density > 0 and scanned_flat.density > 0:
        _push(
            candidates,
            "content",
            _from_extents(original_flat, scanned_flat, 0),
            opts.max_scale_ratio,
        )

    if original_tilted.density > 0 and scanned_tilted.density > 0:
        _push(
            candidates,
            "deskew",
            _from_extents(original_tilted, scanned_tilted, scanned_skew - original_skew),
            opts.max_scale_ratio,
        )

    best_matrix: Matrix3 = similarity(
        frame_scale if math.isfinite(frame_scale) else 1,
        0,
        Point(original.image.width / 2, original.image.height / 2),
        Point(scanned.image.width / 2, scanned.image.height / 2),
    )
    best_score = -math.inf
    best_strategy = "fallback"

    for candidate in candidates:
        for variant in _with_translation_polish(candidate, original.image, scanned.image):
            warped = warp_gray(
                scanned.image,
                variant.matrix,
                original.image.width,
                original.image.height,
                0,
            )
            score = correlation(original.image, warped)
            # Strict `>`, so the FIRST candidate to reach a score keeps it. The
            # order candidates are built in is therefore part of the answer.
            if score > best_score:
                best_matrix = variant.matrix
                best_score = score
                best_strategy = variant.strategy

    return CoarseResult(
        # Measured on two independently shrunk copies; hand back
        # full-resolution pixels.
        matrix=rebase(best_matrix, original.scale, scanned.scale),
        score=0 if best_score == -math.inf else best_score,
        strategy=best_strategy,
        skew=PageSkew(original=original_skew, scanned=scanned_skew),
    )


def _with_translation_polish(
    candidate: _Candidate,
    original: GrayImage,
    scanned: GrayImage,
) -> list[_Candidate]:
    """The coarse matrix, plus a copy nudged by whatever phase correlation says is left over."""
    warped = warp_gray(scanned, candidate.matrix, original.width, original.height, 0)

    try:
        shift = phase_correlate(original, warped)
    except ValueError:
        # The TypeScript catches everything `phaseCorrelate` can throw, which
        # is the size mismatch and nothing else - `warped` is built at the
        # original's size, so this is unreachable in practice and defensive in
        # both languages.
        return [candidate]

    if not math.isfinite(shift.dx) or not math.isfinite(shift.dy):
        return [candidate]
    if abs(shift.dx) < 0.25 and abs(shift.dy) < 0.25:
        return [candidate]

    # `warped` sits in the original's frame, so a residual shift of d means the
    # original at p matches the warp at p + d: sample d further along.
    return [
        candidate,
        _Candidate(
            strategy=f"{candidate.strategy}+phase",
            matrix=multiply(candidate.matrix, translation(shift.dx, shift.dy)),
        ),
    ]


def _from_extents(original: ContentExtent, scanned: ContentExtent, angle: float) -> Matrix3:
    scale = _geometric_mean(scanned.width / original.width, scanned.height / original.height)

    return similarity(scale, angle, original.center, scanned.center)


def _push(
    into: list[_Candidate],
    strategy: str,
    matrix: Matrix3,
    max_scale_ratio: float,
) -> None:
    if is_plausible(matrix, max_scale_ratio):
        into.append(_Candidate(strategy=strategy, matrix=matrix))


def _geometric_mean(a: float, b: float) -> float:
    """Geometric rather than arithmetic mean of the two axis ratios.

    The quantity is a ratio, and the mean of a ratio and its reciprocal should
    be one. Arithmetic mean says 1.25.
    """
    if math.isnan(a) or math.isnan(b) or a <= 0 or b <= 0:
        return math.nan

    return math.sqrt(a * b)
