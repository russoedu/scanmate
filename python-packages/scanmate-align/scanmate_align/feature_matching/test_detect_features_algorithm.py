"""ORB detection and description, against the TypeScript's own output.

Almost all of this is exact, including every descriptor bit. One thing is not,
and it is the third libm seam the port has run into:

    ``math.atan2`` disagrees with ``Math.atan2`` by one unit in the last place
    on 18 of these 107 keypoints.

THE SEAM SITS IN FRONT OF A CLIFF, AND THE CLIFF DOES NOT FIRE
---------------------------------------------------------------

The angle is not a reported number that can be a little wrong. It picks which
of 32 rotation bins the sampling pattern comes from, and two neighbouring bins
give **completely different descriptors**. So a 1-ULP difference that happened
to land on a bin boundary would not shift a value by 1 ULP - it would change
256 bits, and every match downstream with them.

That is worth measuring rather than hoping about. The closest any angle here
comes to a bin boundary is 7.53e-4 radians, which is 3.4e12 ULP. The seam has
twelve orders of magnitude of headroom, which is why the descriptors below are
asserted with ``==`` and not with a tolerance - and
:meth:`TestTheAngleSeam.test_no_angle_is_anywhere_near_a_bin_boundary` is what
keeps that claim honest if the fixture ever changes.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from scanmate_ink import GrayImage, create_random, gaussian, js_round

from .detect_features_algorithm import (
    FeatureOptions,
    Keypoint,
    _angle_bin,
    detect_and_describe,
    detect_fast,
    orientation,
)

_GOLDEN = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "align-feature-matching.json"
    ).read_text(encoding="utf-8")
)

_WIDTH: int = _GOLDEN["size"]["width"]
_HEIGHT: int = _GOLDEN["size"]["height"]
_BASE = GrayImage(np.asarray(_GOLDEN["base"], dtype=np.float32).reshape(_HEIGHT, _WIDTH))
_SHIFTED = GrayImage(np.asarray(_GOLDEN["shifted"], dtype=np.float32).reshape(_HEIGHT, _WIDTH))

_DETECT = _GOLDEN["detectAndDescribe"]
_WANT_KEYPOINTS: list[dict[str, Any]] = _DETECT["keypoints"]
_OPTIONS = FeatureOptions(
    max_features=_DETECT["options"]["maxFeatures"],
    levels=_DETECT["options"]["levels"],
    grid_size=_DETECT["options"]["gridSize"],
)

#: One ULP at an angle of magnitude ~1 radian. atan2 returns `[-pi, pi]`, so
#: this is the right scale for every value here.
_ONE_ULP = 2.220446049250313e-16


def _detected() -> Any:
    return detect_and_describe(_BASE, _OPTIONS)


class TestTheDetectorAsAWhole:
    """Same corners, same order, same descriptors."""

    def test_it_finds_the_same_keypoints(self) -> None:
        got = _detected()
        assert len(got.keypoints) == len(_WANT_KEYPOINTS)

    def test_every_position_score_and_level_is_exact(self) -> None:
        # Position and level are integers scaled by a power of the scale
        # factor, and `score` comes out of a float32 array - none of them has
        # any business being approximate.
        got = _detected()
        for i, (k, want) in enumerate(zip(got.keypoints, _WANT_KEYPOINTS, strict=True)):
            assert (k.x, k.y) == (want["x"], want["y"]), f"keypoint {i} moved"
            assert k.level == want["level"], f"keypoint {i} came from a different level"
            assert k.score == want["score"], f"keypoint {i} scored differently"
            assert k.size == want["size"]

    def test_the_order_is_the_same(self) -> None:
        # Order is not cosmetic: `matchFeatures` indexes descriptors by
        # keypoint position, and the grid distribution's stable sort is what
        # makes the order reproducible at all.
        got = _detected()
        assert [(k.x, k.y, k.level) for k in got.keypoints] == [
            (w["x"], w["y"], w["level"]) for w in _WANT_KEYPOINTS
        ]

    def test_every_descriptor_bit_is_identical(self) -> None:
        # The whole point. 856 words, 27,392 bits, and a single wrongly rounded
        # half in the sampling pattern would move a sample point and flip some
        # of them.
        got = _detected()
        assert got.descriptors.tolist() == _DETECT["descriptors"]

    def test_the_pyramid_really_has_more_than_one_level(self) -> None:
        # A check on the fixture, not the port: with a single level, half the
        # detector would be untested and every assertion above would still pass.
        got = _detected()
        assert {k.level for k in got.keypoints} == {0, 1}


class TestTheAngleSeam:
    """``atan2`` is a third libm difference, and the only inexact thing here."""

    def test_every_angle_is_within_one_ulp(self) -> None:
        got = _detected()
        worst = 0.0
        disagreements = 0
        for k, want in zip(got.keypoints, _WANT_KEYPOINTS, strict=True):
            if k.angle != want["angle"]:
                disagreements += 1
                worst = max(worst, abs(k.angle - want["angle"]))

        assert worst <= _ONE_ULP * 2, (
            f"{disagreements} angles differ, worst {worst} - that is more than a rounding "
            "difference and the bin assertions below are no longer safe"
        )

    def test_the_bin_is_identical_even_where_the_angle_is_not(self) -> None:
        # This is the assertion that matters. The angle is only ever used to
        # choose one of 32 rotation bins, and neighbouring bins give completely
        # different descriptors - so a bin that agrees means a descriptor that
        # agrees, and a bin that did not would change 256 bits at once.
        got = _detected()
        for i, (k, want) in enumerate(zip(got.keypoints, _WANT_KEYPOINTS, strict=True)):
            assert _angle_bin(k.angle) == _angle_bin(want["angle"]), f"keypoint {i} changed bin"

    def test_no_angle_is_anywhere_near_a_bin_boundary(self) -> None:
        """The headroom that makes the exact descriptor assertions robust.

        Measured: the closest any angle comes to a boundary is 7.53e-4 radians,
        or 3.4e12 ULP. If a future fixture put a keypoint on a boundary, the
        descriptors would stop being reproducible across libms and the
        ``==`` above would start failing on one platform and not the other -
        which is a confusing way to find out. This says so first.
        """
        two_pi = math.pi * 2
        closest = min(
            min(
                (pos := math.fmod(math.fmod(k["angle"], two_pi) + two_pi, two_pi)
                 / two_pi * 32) - math.floor(pos),
                math.ceil(pos) - pos,
            )
            for k in _WANT_KEYPOINTS
        )
        margin_radians = closest * two_pi / 32
        assert margin_radians > _ONE_ULP * 1e6, (
            f"a keypoint sits {margin_radians} radians from a bin boundary - too close for the "
            "1-ULP atan2 difference to be safe, so the descriptors cannot be asserted exactly"
        )


class TestThePiecesUnderneath:
    """``detect_fast`` and ``orientation``, which have no golden of their own.

    Neither is exported from ``@scanmate/align``, so the golden writer cannot
    reach either through the built bundle - and reimplementing them there to
    get a golden would only prove that two copies of the same misunderstanding
    agree. They are covered through the detector above; these are the
    properties that make a failure there readable.
    """

    def test_fast_finds_the_corners_of_a_filled_box(self) -> None:
        # The case the detector's own COMPASS_MINIMUM comment is about:
        # requiring 3 compass points instead of 2 silently discards the corner
        # of a plain filled rectangle, and this fixture has two of them.
        page = np.full((_HEIGHT, _WIDTH), 0.05, dtype=np.float32)
        page[30:70, 40:100] = 0.9
        corners = detect_fast(GrayImage(page), 0.08, 24)

        found = {(c.x, c.y) for c in corners}
        # Each box corner produces a detection within a pixel or two of itself.
        for corner in ((40, 30), (99, 30), (40, 69), (99, 69)):
            assert any(
                abs(x - corner[0]) <= 2 and abs(y - corner[1]) <= 2 for x, y in found
            ), f"no detection near the box corner at {corner}"

    def test_fast_finds_nothing_on_a_blank_page(self) -> None:
        blank = GrayImage(np.full((_HEIGHT, _WIDTH), 0.5, dtype=np.float32))
        assert detect_fast(blank, 0.08, 24) == []

    def test_orientation_points_at_the_ink(self) -> None:
        # The centroid is the whole trick behind rotation invariance, so the
        # direction has to be right, not merely stable. Ink to the right of
        # centre gives an angle near 0; below centre, near +pi/2.
        right = np.zeros((_HEIGHT, _WIDTH), dtype=np.float32)
        right[55:65, 65:75] = 1.0
        assert orientation(GrayImage(right), 60, 60, 15) == pytest.approx(0, abs=0.2)

        below = np.zeros((_HEIGHT, _WIDTH), dtype=np.float32)
        below[65:75, 55:65] = 1.0
        assert orientation(GrayImage(below), 60, 60, 15) == pytest.approx(math.pi / 2, abs=0.2)

    def test_orientation_of_an_empty_patch_is_zero(self) -> None:
        # `atan2(0, 0)` is 0 rather than undefined, in both languages.
        blank = GrayImage(np.zeros((_HEIGHT, _WIDTH), dtype=np.float32))
        assert orientation(blank, 60, 60, 15) == 0.0


class TestTheDetectorHonoursItsOptions:
    """Properties, not parity - but each is a promise a caller relies on."""

    def test_max_features_is_a_per_level_allowance_not_a_global_cap(self) -> None:
        """And the name of this test used to say otherwise, which was wrong.

        `per_level` is `ceil(max_features / levels)`, applied to each level
        independently. When the budget divides evenly the total does come out
        at or below `max_features`, which is what an earlier version of this
        test asserted - and it held only by luck of divisibility. The
        `indivisibleBudget` golden is the counterexample: 5 features over 2
        levels is 3 each, and the real answer is 6.

        So the promise is per level, and this asserts the promise that exists.
        The trim inside `_distribute` is what keeps even that true, and the
        numbers here are chosen so it actually fires - a mutation run found
        both the `max_features=20` and `max_features=16` versions passing with
        the trim removed.
        """
        got = detect_and_describe(_BASE, FeatureOptions(max_features=8, levels=2, grid_size=4))
        per_level = -(-8 // 2)
        for level in {k.level for k in got.keypoints}:
            assert sum(1 for k in got.keypoints if k.level == level) <= per_level

    def test_an_indivisible_budget_really_does_overshoot(self) -> None:
        # Stated as its own test because it is surprising, and because the
        # golden is what makes it a fact about the TypeScript rather than an
        # opinion about this port.
        case = next(c for c in _GOLDEN["moreDetectors"] if c["label"] == "indivisibleBudget")
        assert len(case["keypoints"]) > case["options"]["maxFeatures"]

    def test_the_budget_is_tight_enough_for_the_trim_to_fire(self) -> None:
        # Guards the test above rather than the port. The trim only runs when
        # the grid hands back MORE than the budget, and "more" is strict: with
        # a per-level budget of 8 and 8 occupied cells it returns exactly 8 and
        # the trim never fires. A mutation run found both the `max_features=20`
        # and `max_features=16` versions of this passing with the trim removed;
        # 8 (per-level 4, against 8 occupied cells) is what actually exercises
        # it.
        per_level = -(-8 // 2)
        occupied = len(
            {
                (
                    min(3, math.floor(c.x / (_WIDTH / 4))),
                    min(3, math.floor(c.y / (_HEIGHT / 4))),
                )
                for c in detect_fast(_BASE, 0.08, math.ceil(15 * math.sqrt(2)) + 2)
            }
        )
        assert occupied > per_level, (
            f"{occupied} occupied cells against a budget of {per_level} - the grid no longer "
            "overshoots, so the trim is untested"
        )

    def test_a_pyramid_deeper_than_the_image_stops_rather_than_crashing(self) -> None:
        # The break is a crash guard, not a tidiness one. Level 9 of a 160-wide
        # page at scale factor 2 asks for `round(160 / 512)` = 0 pixels, and
        # `resize_gray` divides by that. Ten levels is well past anything a
        # real caller would ask for, which is exactly why the guard is there.
        got = detect_and_describe(
            _BASE, FeatureOptions(max_features=60, levels=10, scale_factor=2.0, grid_size=4)
        )
        assert {k.level for k in got.keypoints} == {0, 1}

    def test_descriptors_stay_in_step_with_keypoints(self) -> None:
        # A descriptor is located by its keypoint's index, so a keypoint kept
        # without its descriptor (or the reverse) silently misaligns the whole
        # array from that point on.
        got = _detected()
        assert len(got.descriptors) == len(got.keypoints) * 8

    def test_a_blank_page_yields_nothing_rather_than_failing(self) -> None:
        blank = GrayImage(np.full((_HEIGHT, _WIDTH), 0.5, dtype=np.float32))
        got = detect_and_describe(blank, _OPTIONS)
        assert got.keypoints == []
        assert len(got.descriptors) == 0

    def test_the_shifted_page_is_detected_too(self) -> None:
        # Used by the matcher tests; asserted here so a failure there points at
        # the matcher rather than at this.
        assert len(detect_and_describe(_SHIFTED, _OPTIONS).keypoints) > 0


def test_keypoints_are_immutable() -> None:
    # Frozen, because `matchFeatures` holds references into this list and a
    # mutated coordinate would silently change a correspondence after the fact.
    keypoint = Keypoint(x=1, y=2, score=3, angle=0, level=0, size=31)
    with pytest.raises(AttributeError):
        keypoint.x = 9  # type: ignore[misc]


class TestTheFixturesThatCloseMutationGaps:
    """Two pages that exist because the main fixture could not reach a branch.

    Both were found by mutation testing, and both are ordinary pages rather
    than contrivances - which is the argument for keeping them.
    """

    @pytest.mark.parametrize(
        "case", _GOLDEN["moreDetectors"], ids=[c["label"] for c in _GOLDEN["moreDetectors"]]
    )
    def test_it_matches_the_golden(self, case: dict[str, Any]) -> None:
        image = GrayImage(
            np.asarray(case["pixels"], dtype=np.float32).reshape(case["height"], case["width"])
        )
        options = FeatureOptions(
            max_features=case["options"]["maxFeatures"],
            levels=case["options"]["levels"],
            grid_size=case["options"]["gridSize"],
            **(
                {"scale_factor": case["options"]["scaleFactor"]}
                if "scaleFactor" in case["options"]
                else {}
            ),
        )
        got = detect_and_describe(image, options)

        assert len(got.keypoints) == len(case["keypoints"])
        for i, (k, want) in enumerate(zip(got.keypoints, case["keypoints"], strict=True)):
            assert (k.x, k.y, k.level) == (want["x"], want["y"], want["level"]), i
            assert k.score == want["score"], i
        assert got.descriptors.tolist() == case["descriptors"]

    def test_the_odd_page_asks_for_half_a_pixel_in_both_axes(self) -> None:
        # The whole reason it is 161 x 121 with a scale factor of 2. Both axes,
        # because the detector rounds them independently - a mutation run
        # caught the first version of this fixture, which was 161 x 120 and
        # left the height's own `Math.round` free to be wrong.
        case = next(c for c in _GOLDEN["moreDetectors"] if c["label"] == "oddWidth")
        scale = case["options"]["scaleFactor"]
        for axis in ("width", "height"):
            requested = case[axis] / scale
            assert requested % 1 == 0.5, f"{axis} no longer lands on a half"
            # And the two roundings really do disagree on it.
            assert js_round(requested) != round(requested)
            assert js_round(requested) == math.floor(requested) + 1

    def test_the_rule_page_produces_adjacent_equal_scores(self) -> None:
        # The only way to tell the non-maximum suppression's `>` from a `>=`.
        # Every interior pixel along a one-pixel line sees an identical ring,
        # so their scores are exactly equal - with `>` the run survives, with
        # `>=` none of it does.
        case = next(c for c in _GOLDEN["moreDetectors"] if c["label"] == "rule")
        image = GrayImage(
            np.asarray(case["pixels"], dtype=np.float32).reshape(case["height"], case["width"])
        )
        corners = detect_fast(image, 0.08, 24)
        adjacent_ties = sum(
            1
            for c in corners
            for d in corners
            if (c.x, c.y) != (d.x, d.y)
            and abs(c.x - d.x) <= 1
            and abs(c.y - d.y) <= 1
            and c.score == d.score
        )
        assert adjacent_ties > 0, (
            "the rule no longer produces ties, so the `>` boundary is untested"
        )


class TestWhatIsUnreachableByConstruction:
    """Two guards no input can trip, and the invariants that make that true.

    Both showed up as surviving mutants. Neither is a gap: removing them
    changes nothing because nothing can reach them - and asserting WHY is more
    useful than contriving an input that cannot occur in practice.
    """

    def test_the_border_keeps_every_sample_inside_the_image(self) -> None:
        # `_describe` returns None when a sample point falls outside. It never
        # does: the border is `ceil(halfPatch * sqrt(2)) + 2`, and the furthest
        # a rotated pattern offset can reach is `halfPatch * sqrt(2)`.
        half_patch = (31 - 1) / 2
        border = math.ceil(half_patch * math.sqrt(2)) + 2
        furthest = max(
            abs(math.cos(a) * half_patch - math.sin(a) * half_patch)
            for a in ((b / 32) * 2 * math.pi for b in range(32))
        )
        assert furthest < border, (
            f"a rotated sample can reach {furthest} from the corner but the border is only "
            f"{border} - the out-of-bounds guard in _describe is now reachable and needs a test"
        )

    def test_no_corner_can_fall_outside_its_grid_cell(self) -> None:
        # `_distribute` clamps the cell index to `grid_size - 1`. It never
        # needs to: a corner's x is strictly less than the width, so
        # `floor(x / (width / grid))` is at most `grid - 1` already. The clamp
        # is defensive and removing it changes nothing, which is why no test
        # here can catch that - so the invariant is asserted instead.
        for grid in (4, 8, 16):
            cell = _WIDTH / grid
            assert math.floor((_WIDTH - 1) / cell) <= grid - 1

    def test_the_sampling_pattern_never_rounds_an_exact_half(self) -> None:
        # Which is why the js_round in `_steered_patterns` cannot be caught by
        # any descriptor golden: 32,768 values and not one of them is a half.
        # Recorded so a future seed change that DOES produce one is a visible
        # event rather than a silent loss of coverage.
        from .detect_features_algorithm import _steered_patterns

        _steered_patterns(31, 0xB81EF)  # populate the cache, which is the real path
        random = create_random(0xB81EF)
        halves = sum(
            1
            for _ in range(256 * 4)
            if abs((v := gaussian(random) * (31 / 5)) - math.floor(v) - 0.5) < 1e-18
        )
        assert halves == 0
