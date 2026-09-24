"""RANSAC: fit the model that the largest number of correspondences agree with.

Feature matching on a document produces a lot of confident nonsense, because
the page is full of things that genuinely look identical - every lowercase
"e", every corner of every table cell. Least squares over all of them is
dragged wherever the wrong ones point. RANSAC ignores the average: it draws the
smallest sample that determines a transform, counts how many of the rest that
transform explains, and repeats. A wrong sample agrees with almost nothing; the
right one agrees with everything real on the page.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from scanmate_ink import (
    Matrix3,
    TransformModel,
    create_random,
    is_plausible,
    reprojection_error,
)

from .fit_transform_algorithm import Correspondence, fit_model, minimum_samples

_DEFAULT_SEED = 0x5CA7F1

#: Stands in for JavaScript's +Infinity, which `min` always loses to.
_NEVER_STOP_EARLY = 2**63


@dataclass(frozen=True, slots=True)
class RansacOptions:
    """How hard to look, and what counts as agreement."""

    model: TransformModel
    #: A correspondence is an inlier when it reprojects within this many pixels.
    threshold: float
    max_iterations: int = 2000
    #: Probability of having drawn at least one all-inlier sample. Drives early exit.
    confidence: float = 0.995
    #: Below this many inliers the answer is rejected outright.
    min_inliers: int | None = None
    seed: int = _DEFAULT_SEED


@dataclass(frozen=True, slots=True)
class RansacResult:
    """The consensus transform, and how much of the input agreed with it."""

    matrix: Matrix3
    #: Indices into the input sequence.
    inliers: list[int]
    inlier_ratio: float
    iterations: int
    #: Mean reprojection error over the inliers, in pixels.
    error: float


def ransac(
    matches: Sequence[Correspondence],
    options: RansacOptions,
) -> RansacResult | None:
    """Find the transform the largest consistent subset of ``matches`` supports."""
    model = options.model
    threshold = options.threshold
    max_iterations = options.max_iterations
    confidence = options.confidence
    seed = options.seed

    sample_size = minimum_samples(model)
    min_inliers = (
        options.min_inliers
        if options.min_inliers is not None
        else max(sample_size + 2, math.ceil(len(matches) * 0.08))
    )
    if len(matches) < max(sample_size, min_inliers):
        return None

    random = create_random(seed)
    sample = [0] * sample_size

    best_inliers: list[int] = []
    best_matrix: Matrix3 | None = None
    limit = max_iterations
    iterations = 0

    while iterations < limit and iterations < max_iterations:
        _draw_sample(sample, len(matches), random)
        candidate = fit_model(model, matches, sample)
        if candidate is None or not is_plausible(candidate):
            iterations += 1
            continue

        inliers = find_inliers(matches, candidate, threshold)
        if len(inliers) <= len(best_inliers):
            iterations += 1
            continue

        best_inliers = inliers
        best_matrix = candidate

        # Adaptive stopping: once a large fraction agrees, the chance that more
        # draws find something better collapses, and so does the budget.
        ratio = len(inliers) / len(matches)
        if 0 < ratio < 1:
            denominator = math.log(1 - ratio**sample_size)
            if denominator < 0:
                limit = min(max_iterations, _adaptive_limit(confidence, denominator))
        elif ratio >= 1:
            limit = iterations + 1

        iterations += 1

    if best_matrix is None or len(best_inliers) < min_inliers:
        return None

    # Re-fit on every inlier. The minimal sample only ever located the
    # consensus; the accurate transform comes from all of it.
    refined = fit_model(model, matches, best_inliers)
    if refined is not None and is_plausible(refined):
        refined_inliers = find_inliers(matches, refined, threshold)
        if len(refined_inliers) >= len(best_inliers):
            best_inliers = refined_inliers
        else:
            refined = best_matrix
    else:
        refined = best_matrix

    matrix = refined if refined is not None else best_matrix
    total = 0.0
    for i in best_inliers:
        total += reprojection_error(matrix, matches[i].source, matches[i].target)

    return RansacResult(
        matrix=matrix,
        inliers=best_inliers,
        inlier_ratio=len(best_inliers) / len(matches),
        iterations=iterations,
        error=total / len(best_inliers) if len(best_inliers) > 0 else math.inf,
    )


def _adaptive_limit(confidence: float, denominator: float) -> int:
    """``ceil(log(1 - confidence) / denominator) + 1``, with JavaScript's log(0).

    ``Math.log(0)`` is ``-Infinity`` in JavaScript and a ``ValueError`` in
    Python, and ``confidence = 1`` is the one input a caller can actually pass
    that reaches it. JavaScript carries the infinity through the division (by a
    negative denominator, so ``+Infinity``) and ``Math.min`` then picks
    ``maxIterations`` - meaning "never stop early", which is the right reading
    of "I want certainty". Raising instead would be a divergence, so the
    infinity is reproduced rather than avoided.
    """
    if confidence >= 1:
        return _NEVER_STOP_EARLY

    return math.ceil(math.log(1 - confidence) / denominator) + 1


def find_inliers(
    matches: Sequence[Correspondence],
    matrix: Matrix3,
    threshold: float,
) -> list[int]:
    """Indices of the correspondences ``matrix`` explains to within ``threshold``."""
    inliers: list[int] = []
    for i, match in enumerate(matches):
        if reprojection_error(matrix, match.source, match.target) <= threshold:
            inliers.append(i)

    return inliers


def _draw_sample(into: list[int], count: int, random: Callable[[], float]) -> None:
    """Distinct indices, drawn without replacement.

    "Without replacement" is the intent rather than a guarantee: after 32 failed
    attempts the duplicate is kept, and the fit that follows simply fails on a
    degenerate sample. Reproduced exactly, because the number of times ``random``
    is called is what keeps the whole search in step with the TypeScript.
    """
    for i in range(len(into)):
        candidate = 0
        for _attempt in range(32):
            candidate = min(count - 1, math.floor(random() * count))
            duplicate = False
            for j in range(i):
                if into[j] == candidate:
                    duplicate = True
                    break
            if not duplicate:
                break
        into[i] = candidate
