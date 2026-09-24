"""The fitters, held to the TypeScript's own output.

Every expected value in this file was produced by running the real
``@scanmate/align`` build (``tools/parity/goldens/align-transform-fitting.json``),
never by restating the algorithm here - a golden written by hand only proves
that two copies of the same misunderstanding agree.

The comparison is ``==`` on floats, deliberately. These are closed-form fits and
a linear solve over the same inputs in the same order, so equality is
achievable; "close enough" would hide exactly the reordering bug this exists to
catch, and a transform that is right to six places is wrong by a pixel by the
time it has been applied across a page.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pytest
from scanmate_ink import Matrix3, Point

from .fit_transform_algorithm import (
    Correspondence,
    fit_affine,
    fit_homography,
    fit_model,
    fit_similarity,
    minimum_samples,
)

_GOLDENS = json.loads(
    (Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "align-transform-fitting.json")
    .read_text(encoding="utf-8")
)


def _matrix(values: list[float]) -> Matrix3:
    a, b, c, d, e, f, g, h, i = values

    return (a, b, c, d, e, f, g, h, i)


def _matches(raw: list[dict[str, Any]]) -> list[Correspondence]:
    return [
        Correspondence(
            Point(m["source"]["x"], m["source"]["y"]),
            Point(m["target"]["x"], m["target"]["y"]),
        )
        for m in raw
    ]


SIMILARITY_TRUTH = _matrix(_GOLDENS["truth"]["similarity"])
AFFINE_TRUTH = _matrix(_GOLDENS["truth"]["affine"])
HOMOGRAPHY_TRUTH = _matrix(_GOLDENS["truth"]["homography"])

_GRID: list[tuple[float, float]] = [
    (10, 20), (310, 35), (120, 400), (480, 520), (55, 610),
    (640, 90), (275, 250), (700, 700), (15, 730), (590, 305),
]


def _through(m: Matrix3, x: float, y: float) -> Point:
    w = m[6] * x + m[7] * y + m[8]

    return Point((m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w)


def _correspondences(m: Matrix3, count: int = len(_GRID)) -> list[Correspondence]:
    return [Correspondence(Point(x, y), _through(m, x, y)) for x, y in _GRID[:count]]


def _repeated(count: int) -> list[Correspondence]:
    return [Correspondence(Point(5, 5), Point(9, 2)) for _ in range(count)]


class TestMinimumSamples:
    """The floor below which a model is not determined at all."""

    @pytest.mark.parametrize("model", ["similarity", "affine", "homography"])
    def test_matches_the_golden(self, model: str) -> None:
        assert minimum_samples(model) == _GOLDENS["fits"]["minimumSamples"][model]  # type: ignore[arg-type]

    def test_rises_with_the_degrees_of_freedom(self) -> None:
        # Stated separately from the goldens because it is the PROPERTY that
        # makes similarity the robust choice: it needs fewer points, so a
        # random sample is likelier to be all-inliers.
        assert minimum_samples("similarity") < minimum_samples("affine")
        assert minimum_samples("affine") < minimum_samples("homography")


class TestExactFits:
    """Each fitter against a transform its own model can represent."""

    def test_similarity(self) -> None:
        assert fit_similarity(_correspondences(SIMILARITY_TRUTH)) == tuple(
            _GOLDENS["fits"]["similarityExact"]
        )

    def test_affine(self) -> None:
        assert fit_affine(_correspondences(AFFINE_TRUTH)) == tuple(
            _GOLDENS["fits"]["affineExact"]
        )

    def test_homography(self) -> None:
        # The one most likely to drift: `fit_homography` runs a Jacobi eigen
        # solve whose sweep ORDER decides the last bits of every entry.
        assert fit_homography(_correspondences(HOMOGRAPHY_TRUTH)) == tuple(
            _GOLDENS["fits"]["homographyExact"]
        )

    def test_the_exact_fit_recovers_the_transform_it_was_built_from(self) -> None:
        # Not a parity check - a sanity check on the goldens themselves. If
        # this drifted, the goldens would still agree with a port that had the
        # same bug, so it is worth asserting that the fit means what it claims.
        fitted = fit_similarity(_correspondences(SIMILARITY_TRUTH))
        assert fitted is not None
        for got, want in zip(fitted, SIMILARITY_TRUTH, strict=True):
            assert math.isclose(got, want, rel_tol=1e-12, abs_tol=1e-9)


class TestUnderfitting:
    """A model asked to explain something it cannot.

    The least-squares compromise is itself a number the port has to reproduce -
    an "approximately right" answer is still an exactly specified one.
    """

    def test_similarity_on_an_affine_truth(self) -> None:
        assert fit_similarity(_correspondences(AFFINE_TRUTH)) == tuple(
            _GOLDENS["fits"]["similarityOnAffine"]
        )

    def test_affine_on_a_homography_truth(self) -> None:
        assert fit_affine(_correspondences(HOMOGRAPHY_TRUTH)) == tuple(
            _GOLDENS["fits"]["affineOnHomography"]
        )


class TestIndexSelection:
    """``indices`` picks a subset, which is the path RANSAC actually takes.

    The golden indices are deliberately out of order: the fitters must honour
    the order they are handed, not sort it.
    """

    def test_similarity(self) -> None:
        assert fit_similarity(_correspondences(SIMILARITY_TRUTH), [7, 2]) == tuple(
            _GOLDENS["fits"]["similarityFromIndices"]
        )

    def test_affine(self) -> None:
        assert fit_affine(_correspondences(AFFINE_TRUTH), [9, 0, 4]) == tuple(
            _GOLDENS["fits"]["affineFromIndices"]
        )

    def test_homography(self) -> None:
        assert fit_homography(_correspondences(HOMOGRAPHY_TRUTH), [1, 8, 3, 6]) == tuple(
            _GOLDENS["fits"]["homographyFromIndices"]
        )


class TestFitModelDispatch:
    """``fit_model`` must reach exactly the three fitters, and nothing else."""

    def test_similarity(self) -> None:
        assert fit_model("similarity", _correspondences(SIMILARITY_TRUTH)) == tuple(
            _GOLDENS["fits"]["viaFitModelSimilarity"]
        )

    def test_affine(self) -> None:
        assert fit_model("affine", _correspondences(AFFINE_TRUTH)) == tuple(
            _GOLDENS["fits"]["viaFitModelAffine"]
        )

    def test_homography(self) -> None:
        assert fit_model("homography", _correspondences(HOMOGRAPHY_TRUTH)) == tuple(
            _GOLDENS["fits"]["viaFitModelHomography"]
        )

    def test_dispatch_agrees_with_calling_the_fitter_directly(self) -> None:
        points = _correspondences(HOMOGRAPHY_TRUTH)
        assert fit_model("homography", points, [1, 8, 3, 6]) == fit_homography(points, [1, 8, 3, 6])


class TestRefusals:
    """Every ``None``, and each one for a different reason.

    A port that collapses these into a single "not enough points" guard passes
    every test above and fails here, which is the point of listing them apart.
    """

    def test_too_few_points_for_similarity(self) -> None:
        assert fit_similarity(_correspondences(SIMILARITY_TRUTH, 1)) is None
        assert _GOLDENS["fits"]["tooFewForSimilarity"] is None

    def test_too_few_points_for_affine(self) -> None:
        assert fit_affine(_correspondences(AFFINE_TRUTH, 2)) is None
        assert _GOLDENS["fits"]["tooFewForAffine"] is None

    def test_too_few_points_for_homography(self) -> None:
        assert fit_homography(_correspondences(HOMOGRAPHY_TRUTH, 3)) is None
        assert _GOLDENS["fits"]["tooFewForHomography"] is None

    def test_zero_spread_underflows_similarity(self) -> None:
        # Enough points, but every source is the same one: `norm` is 0, so
        # there is no rotation to recover.
        assert fit_similarity(_repeated(4)) is None
        assert _GOLDENS["fits"]["degenerateSimilarity"] is None

    def test_zero_spread_refuses_the_hartley_normaliser(self) -> None:
        # A different guard entirely: the mean distance from the centroid is 0,
        # so the normaliser has nothing to scale by and returns None before any
        # eigen solve happens.
        assert fit_homography(_repeated(4)) is None
        assert _GOLDENS["fits"]["degenerateHomography"] is None

    def test_collinear_sources_make_the_affine_system_singular(self) -> None:
        # A third guard: enough points, real spread, but the normal matrix has
        # no inverse, so `solve` is what fails.
        collinear = [
            Correspondence(Point(i * 10, i * 10), Point(i * 11, i * 9)) for i in range(4)
        ]
        assert fit_affine(collinear) is None
        assert _GOLDENS["fits"]["collinearAffine"] is None


class TestGoldenIntegrity:
    """The goldens must be able to tell a right answer from a wrong one."""

    def test_the_three_truths_are_genuinely_different_models(self) -> None:
        # If the affine truth were secretly a similarity, `similarityOnAffine`
        # would equal `affineExact` and half this file would prove nothing.
        assert SIMILARITY_TRUTH != AFFINE_TRUTH
        assert AFFINE_TRUTH != HOMOGRAPHY_TRUTH
        assert HOMOGRAPHY_TRUTH[6] != 0 or HOMOGRAPHY_TRUTH[7] != 0

    def test_underfitting_really_does_lose_something(self) -> None:
        under = _GOLDENS["fits"]["similarityOnAffine"]
        exact = _GOLDENS["fits"]["affineExact"]
        assert under != exact
