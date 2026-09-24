"""RANSAC, held to the TypeScript's own search.

Every expected value came from running the real ``@scanmate/align`` build
(``tools/parity/goldens/align-transform-fitting.json``).

RANSAC's whole answer is a function of the PRNG call sequence, so the goldens
carry ``iterations`` next to the matrix and these tests assert both. A port that
draws the same numbers in a different order, or calls ``random()`` a different
number of times per sample, lands somewhere else entirely - and the iteration
count says so long before the matrix does.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from scanmate_ink import IDENTITY, Matrix3, Point, create_random

from .fit_transform_algorithm import Correspondence
from .ransac_algorithm import RansacOptions, RansacResult, find_inliers, ransac

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

# Read from the goldens rather than regenerated, so a test failure means the
# SEARCH diverged and not the input to it. `TestTheInputsThemselves` below
# regenerates them separately and pins that too.
CLEAN = _matches(_GOLDENS["sets"]["clean"])
DIRTY = _matches(_GOLDENS["sets"]["dirty"])
HOPELESS = _matches(_GOLDENS["sets"]["hopeless"])

_OUTLIER_SEED = 0xBADF00D


def _through(m: Matrix3, x: float, y: float) -> Point:
    w = m[6] * x + m[7] * y + m[8]

    return Point((m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w)


def _with_outliers(m: Matrix3, total: int, outliers: int) -> list[Correspondence]:
    random = create_random(_OUTLIER_SEED)
    out: list[Correspondence] = []
    for i in range(total):
        x = math.floor(random() * 800)
        y = math.floor(random() * 800)
        honest = _through(m, x, y)
        # Both draws happen for every point, outlier or not, so the set is a
        # pure function of the seed and the two counts.
        dx = random() * 400 - 200
        dy = random() * 400 - 200
        out.append(
            Correspondence(Point(x, y), Point(honest.x + dx, honest.y + dy))
            if i < outliers
            else Correspondence(Point(x, y), honest)
        )

    return out


def _assert_matches_golden(got: RansacResult | None, key: str) -> None:
    """Assert a result against its golden, field by field.

    Field by field rather than as a whole, so a failure names WHICH part moved.
    The iteration count is the sensitive one - it is the first thing to change
    when the PRNG is consumed differently, and it changes while the matrix can
    still look plausible.
    """
    want = _GOLDENS["ransac"][key]
    if want is None:
        assert got is None, f"{key}: expected a refusal, got a fit"

        return

    assert got is not None, f"{key}: expected a fit, got a refusal"
    assert got.iterations == want["iterations"], f"{key}: the search took a different path"
    assert got.inliers == want["inliers"], f"{key}: a different consensus set"
    assert got.inlier_ratio == want["inlierRatio"], f"{key}: inlier ratio"
    assert got.error == want["error"], f"{key}: mean reprojection error"
    assert got.matrix == tuple(want["matrix"]), f"{key}: matrix"


class TestTheInputsThemselves:
    """The correspondence sets, regenerated here from the same seed.

    Worth its own test: every other assertion in this file feeds on these, so a
    silent difference in how the generator is consumed would make the rest
    fail in a way that pointed at RANSAC rather than at the setup.
    """

    def test_clean(self) -> None:
        assert _with_outliers(SIMILARITY_TRUTH, 40, 0) == CLEAN

    def test_dirty(self) -> None:
        assert _with_outliers(SIMILARITY_TRUTH, 40, 14) == DIRTY

    def test_hopeless(self) -> None:
        assert _with_outliers(SIMILARITY_TRUTH, 40, 39) == HOPELESS

    def test_the_dirty_set_really_is_dirty(self) -> None:
        # Guards the goldens rather than the port: if the "outliers" landed
        # within threshold, every robustness test here would pass trivially.
        assert len(find_inliers(DIRTY, SIMILARITY_TRUTH, 2)) == 26


class TestConsensus:
    """Finding the transform the largest consistent subset supports."""

    def test_a_clean_set_is_solved_immediately(self) -> None:
        # Everything agrees, so the `ratio >= 1` early exit fires on the first
        # draw. That branch is reached by nothing else here.
        result = ransac(CLEAN, RansacOptions(model="similarity", threshold=2))
        _assert_matches_golden(result, "clean")
        assert result is not None
        assert result.iterations == 1

    def test_a_third_of_the_matches_being_nonsense_changes_nothing(self) -> None:
        result = ransac(DIRTY, RansacOptions(model="similarity", threshold=2))
        _assert_matches_golden(result, "dirty")
        assert result is not None
        # The whole point: the answer is the truth, not the least-squares
        # compromise the outliers would have dragged it to.
        for got, want in zip(result.matrix, SIMILARITY_TRUTH, strict=True):
            assert math.isclose(got, want, rel_tol=1e-9, abs_tol=1e-9)

    def test_a_different_seed_walks_a_different_search(self) -> None:
        _assert_matches_golden(
            ransac(DIRTY, RansacOptions(model="similarity", threshold=2, seed=99)),
            "dirtyOtherSeed",
        )

    def test_a_budget_that_binds_cuts_the_search_short(self) -> None:
        # 4 iterations, against the 11 the unbudgeted search takes. Pins that
        # the port spends its iterations at the same rate, not merely that it
        # reaches the same place eventually.
        result = ransac(DIRTY, RansacOptions(model="similarity", threshold=2, max_iterations=4))
        _assert_matches_golden(result, "dirtyBudgeted")
        assert result is not None
        assert result.iterations == 4

    def test_everything_inside_the_threshold_exits_early(self) -> None:
        result = ransac(DIRTY, RansacOptions(model="similarity", threshold=10_000))
        _assert_matches_golden(result, "everythingFits")
        assert result is not None
        assert result.inlier_ratio == 1


class TestOtherModels:
    """A larger minimal sample takes a different path through the generator."""

    def test_homography(self) -> None:
        _assert_matches_golden(
            ransac(DIRTY, RansacOptions(model="homography", threshold=2)),
            "dirtyHomography",
        )

    def test_affine(self) -> None:
        _assert_matches_golden(
            ransac(DIRTY, RansacOptions(model="affine", threshold=3)),
            "dirtyAffine",
        )

    def test_more_freedom_costs_more_draws(self) -> None:
        # The property behind the goldens above: homography draws 4 indices per
        # iteration where similarity draws 2, so an all-inlier sample is rarer
        # and the search is longer. This is the reason to prefer the simplest
        # model the situation allows.
        similarity_result = ransac(DIRTY, RansacOptions(model="similarity", threshold=2))
        homography_result = ransac(DIRTY, RansacOptions(model="homography", threshold=2))
        assert similarity_result is not None
        assert homography_result is not None
        assert homography_result.iterations > similarity_result.iterations


class TestRefusals:
    """When there is no honest answer, there must be no answer."""

    def test_a_set_that_is_almost_all_nonsense(self) -> None:
        # 39 of 40 corrupted. A confident fit here would be a fit to whichever
        # handful of outliers happened to agree, which is worse than nothing.
        _assert_matches_golden(
            ransac(HOPELESS, RansacOptions(model="similarity", threshold=2)),
            "hopeless",
        )

    def test_fewer_matches_than_the_model_needs(self) -> None:
        _assert_matches_golden(
            ransac(CLEAN[:1], RansacOptions(model="similarity", threshold=2)),
            "tooFew",
        )

    def test_a_floor_the_best_consensus_cannot_clear(self) -> None:
        # 26 inliers exist; 39 are demanded. Refusing is the contract.
        _assert_matches_golden(
            ransac(DIRTY, RansacOptions(model="similarity", threshold=2, min_inliers=39)),
            "unreachableFloor",
        )


class TestFindInliers:
    """Which correspondences a given transform explains."""

    def test_an_exact_transform_explains_a_clean_set_entirely(self) -> None:
        assert find_inliers(CLEAN, SIMILARITY_TRUTH, 1e-6) == _GOLDENS["ransac"]["findInliers"][
            "exact"
        ]

    def test_it_separates_the_outliers(self) -> None:
        assert find_inliers(DIRTY, SIMILARITY_TRUTH, 2) == _GOLDENS["ransac"]["findInliers"][
            "dirty"
        ]

    def test_a_wide_enough_threshold_admits_everything(self) -> None:
        assert find_inliers(DIRTY, SIMILARITY_TRUTH, 10_000) == _GOLDENS["ransac"]["findInliers"][
            "wide"
        ]

    def test_the_wrong_transform_explains_nothing(self) -> None:
        assert find_inliers(DIRTY, IDENTITY, 0.5) == _GOLDENS["ransac"]["findInliers"]["none"]

    def test_the_boundary_is_inclusive(self) -> None:
        # `<= threshold`, not `<`. A point exactly on the boundary is an
        # inlier, and the off-by-one here is invisible in any random data.
        exact = [Correspondence(Point(0, 0), Point(3, 4))]
        assert find_inliers(exact, IDENTITY, 5) == [0]
        assert find_inliers(exact, IDENTITY, 4.999_999_999) == []
