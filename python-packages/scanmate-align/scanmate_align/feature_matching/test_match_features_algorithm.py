"""Descriptor matching, against the TypeScript's own output.

Entirely exact. The descriptors it consumes are bit-identical (see
``test_detect_features_algorithm``), and everything here is integer work on
them, so there is nothing for a libm to disagree about.

The goldens are layered smallest-unit-first, because a failure in
``match_features`` alone would not say which part moved:

1. :func:`popcount` over values including negative ones - JavaScript's ``^``
   and ``>>`` coerce to **signed** 32-bit, so a descriptor word with its top
   bit set arrives there negative, and a port that does the SWAR arithmetic in
   Python's unbounded integers sign-extends forever and gets it wrong.
2. :func:`hamming` over whole descriptors built by hand, so the distances are
   known independently of any detector.
3. :func:`match_features` over five option sets that each exercise a different
   filter.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from scanmate_ink import GrayImage

from .detect_features_algorithm import FeatureOptions, FeatureSet, detect_and_describe
from .match_features_algorithm import (
    UNSET,
    MatchOptions,
    hamming,
    match_features,
    popcount,
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
_OPTIONS = FeatureOptions(
    max_features=_GOLDEN["detectAndDescribe"]["options"]["maxFeatures"],
    levels=_GOLDEN["detectAndDescribe"]["options"]["levels"],
    grid_size=_GOLDEN["detectAndDescribe"]["options"]["gridSize"],
)

#: Built once: the detector is the slow part and every case below shares it.
_DETECTED_BASE = detect_and_describe(_BASE, _OPTIONS)
_DETECTED_SHIFTED = detect_and_describe(_SHIFTED, _OPTIONS)

#: The five golden option sets, translated from the TypeScript's camelCase.
_MATCH_OPTIONS: dict[str, MatchOptions] = {
    "defaults": MatchOptions(),
    "noCrossCheck": MatchOptions(cross_check=False),
    "strictRatio": MatchOptions(ratio=0.5),
    "gateAbove": MatchOptions(max_displacement=12),
    "gateBelow": MatchOptions(max_displacement=3),
}
_MATCH_CASES: list[dict[str, Any]] = _GOLDEN["matchFeatures"]


class TestPopcount:
    """The SWAR bit count, over both signs of the 32-bit range."""

    @pytest.mark.parametrize(
        "case", _GOLDEN["popcount"], ids=[str(c["value"]) for c in _GOLDEN["popcount"]]
    )
    def test_it_matches_the_golden(self, case: dict[str, int]) -> None:
        assert popcount(case["value"]) == case["bits"]

    def test_the_negative_cases_are_actually_present(self) -> None:
        # The whole reason this is transcribed rather than replaced by
        # `int.bit_count()`. If the goldens only held non-negative values, a
        # port that ignored JavaScript's signed coercion would pass.
        assert any(c["value"] < 0 for c in _GOLDEN["popcount"])

    def test_it_agrees_with_the_obvious_implementation_on_the_low_32_bits(self) -> None:
        # A cross-check on the transcription itself: whatever the sign games,
        # the ANSWER is just the set bits of the low 32.
        for case in _GOLDEN["popcount"]:
            assert popcount(case["value"]) == (case["value"] & 0xFFFFFFFF).bit_count()


class TestHamming:
    """Distance between whole descriptors."""

    @pytest.mark.parametrize(
        "case", _GOLDEN["hamming"], ids=[c["label"] for c in _GOLDEN["hamming"]]
    )
    def test_it_matches_the_golden(self, case: dict[str, Any]) -> None:
        a = np.asarray(case["a"], dtype=np.uint32)
        b = np.asarray(case["b"], dtype=np.uint32)
        assert hamming(a, 0, b, 0) == case["distance"]

    def test_the_extremes_are_what_they_should_be(self) -> None:
        # Guards the goldens: if `complementary` stopped being 256, every
        # distance assertion above would still pass while measuring nothing.
        by_label = {c["label"]: c["distance"] for c in _GOLDEN["hamming"]}
        assert by_label["identical"] == 0
        assert by_label["complementary"] == 256
        assert by_label["singleBitDescriptor"] == 1
        # The top bit of a word, which is the one `1 << 31` produces and the
        # one a port is most likely to lose entirely.
        assert by_label["topBitDescriptor"] == 1

    def test_it_reads_from_the_offsets_it_is_given(self) -> None:
        # Descriptors are packed contiguously, so the offset is how a keypoint
        # is located at all. Reading from 0 regardless would compare the first
        # descriptor against itself forever.
        packed = np.asarray([0] * 8 + [0xFFFFFFFF] * 8, dtype=np.uint32)
        assert hamming(packed, 0, packed, 0) == 0
        assert hamming(packed, 0, packed, 8) == 256
        assert hamming(packed, 8, packed, 8) == 0


class TestMatchFeatures:
    """The five filters, each exercised by an option set that changes the answer."""

    @pytest.mark.parametrize("case", _MATCH_CASES, ids=[c["label"] for c in _MATCH_CASES])
    def test_it_matches_the_golden(self, case: dict[str, Any]) -> None:
        got = match_features(_DETECTED_BASE, _DETECTED_SHIFTED, _MATCH_OPTIONS[case["label"]])
        want = case["matches"]

        assert len(got) == len(want), f"{case['label']}: different number of matches"
        for i, (g, w) in enumerate(zip(got, want, strict=True)):
            assert (g.source.x, g.source.y) == (w["source"]["x"], w["source"]["y"]), i
            assert (g.target.x, g.target.y) == (w["target"]["x"], w["target"]["y"]), i
            assert g.distance == w["distance"], i

    def test_the_option_sets_actually_differ(self) -> None:
        # Guards the goldens rather than the port. Five cases that all returned
        # the same matches would look like thorough coverage and test one path.
        counts = {c["label"]: len(c["matches"]) for c in _MATCH_CASES}
        assert len(set(counts.values())) >= 4, f"option sets barely differ: {counts}"

    def test_cross_check_only_ever_removes_matches(self) -> None:
        # It is a filter, not a search: turning it on cannot find a
        # correspondence that turning it off did not.
        with_check = {(m.source.x, m.source.y) for m in
                      match_features(_DETECTED_BASE, _DETECTED_SHIFTED, MatchOptions())}
        without = {(m.source.x, m.source.y) for m in
                   match_features(_DETECTED_BASE, _DETECTED_SHIFTED,
                                  MatchOptions(cross_check=False))}
        assert with_check <= without

    def test_a_tighter_gate_keeps_fewer(self) -> None:
        # The real shift is (5, 3), about 5.83 pixels, so a gate of 3 cuts most
        # of it and a gate of 12 lets it through.
        above = match_features(_DETECTED_BASE, _DETECTED_SHIFTED, MatchOptions(max_displacement=12))
        below = match_features(_DETECTED_BASE, _DETECTED_SHIFTED, MatchOptions(max_displacement=3))
        assert len(below) < len(above)

    def test_an_infinite_gate_disables_it_rather_than_rejecting_everything(self) -> None:
        # `gated` is `isfinite(max_displacement)`. A port that squared infinity
        # and compared against it would reject nothing by luck; one that
        # mishandled the branch would reject everything.
        assert math.isinf(MatchOptions().max_displacement)
        assert len(match_features(_DETECTED_BASE, _DETECTED_SHIFTED, MatchOptions())) > 0

    def test_the_matches_really_describe_the_shift(self) -> None:
        # Not parity - a check that the fixture means something. If the
        # descriptors stopped matching the right corners, every assertion above
        # would still pass against a golden of equally wrong answers.
        matches = match_features(_DETECTED_BASE, _DETECTED_SHIFTED, MatchOptions())
        dxs = [m.target.x - m.source.x for m in matches]
        dys = [m.target.y - m.source.y for m in matches]
        assert sorted(dxs)[len(dxs) // 2] == pytest.approx(5, abs=1.5)
        assert sorted(dys)[len(dys) // 2] == pytest.approx(3, abs=1.5)


class TestEmptyInputs:
    """Nothing to match is not an error."""

    def test_an_empty_source(self) -> None:
        empty = FeatureSet(keypoints=[], descriptors=np.zeros(0, dtype=np.uint32))
        assert match_features(empty, _DETECTED_SHIFTED) == []

    def test_an_empty_target(self) -> None:
        empty = FeatureSet(keypoints=[], descriptors=np.zeros(0, dtype=np.uint32))
        assert match_features(_DETECTED_BASE, empty) == []

    def test_both_empty(self) -> None:
        empty = FeatureSet(keypoints=[], descriptors=np.zeros(0, dtype=np.uint32))
        assert match_features(empty, empty) == []


def test_unset_is_the_value_an_int32_array_can_hold() -> None:
    # The TypeScript's comment explains why this is not MAX_SAFE_INTEGER:
    # writing that to an Int32Array truncates it to -1, and every subsequent
    # "is this closer?" then answers no. The value is kept here because it is
    # COMPARED against - `second_distance[i] != UNSET` is a real branch - so a
    # different sentinel would take it at different times.
    assert UNSET == 0x7FFFFFFF
    assert UNSET == 2**31 - 1
    # And it is unreachable as a real distance, which is what makes it usable
    # as a sentinel at all: 256 bits is the most two descriptors can differ by.
    assert UNSET > 256
