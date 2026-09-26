"""Approximate search, held to the TypeScript exactly."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from .approximate_search_algorithm import (
    SearchOptions,
    approximate_search,
    best_match,
    word_span,
)

_GOLDEN: dict[str, Any] = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "scan-approximate-search.json"
    ).read_text(encoding="utf-8")
)


def _options(case: dict[str, Any]) -> SearchOptions | None:
    return None if case["minScore"] is None else SearchOptions(min_score=case["minScore"])


@pytest.mark.parametrize("name", sorted(_GOLDEN["approximateSearch"]))
def test_matches_the_typescript(name: str) -> None:
    case = _GOLDEN["approximateSearch"][name]
    matches = approximate_search(case["needle"], case["text"], _options(case))

    assert len(matches) == len(case["matches"])
    for match, want in zip(matches, case["matches"], strict=True):
        assert (match.start, match.end) == (want["start"], want["end"])
        assert match.distance == want["distance"]
        assert match.score == want["score"]


@pytest.mark.parametrize("name", sorted(_GOLDEN["approximateSearch"]))
def test_best_match_matches_the_typescript(name: str) -> None:
    case = _GOLDEN["approximateSearch"][name]
    best = best_match(case["needle"], case["text"], _options(case))

    if case["best"] is None:
        assert best is None

        return
    assert best is not None
    assert (best.start, best.end) == (case["best"]["start"], case["best"]["end"])


@pytest.mark.parametrize("name", sorted(_GOLDEN["wordSpan"]))
def test_word_span_matches_the_typescript(name: str) -> None:
    case = _GOLDEN["wordSpan"][name]
    span = word_span(case["text"], case["start"], case["end"])

    assert (span.start, span.end) == (case["span"]["start"], case["span"]["end"])


class TestWhyItIsNotJustAnIncludes:
    def test_one_misread_letter_is_still_a_match(self) -> None:
        # An exact `in` would call a perfectly good scan incomplete.
        found = best_match("Initial Subscription Term", "The lnitial Subscription Terrn begins")

        assert found is not None
        assert found.distance == 2

    def test_and_it_says_how_far_off_it_was(self) -> None:
        found = best_match("Subscription Term", "The Initial Subscription Term begins")

        assert found is not None
        assert (found.distance, found.score) == (0, 1)

    def test_something_absent_is_absent(self) -> None:
        assert best_match("Termination Notice", "The Initial Subscription Term begins") is None

    def test_overlapping_matches_keep_only_the_best(self) -> None:
        assert len(approximate_search("aaaa", "aaaaaa")) == 1


class TestFiguresAreHeldToMoreThanCloseness:
    def test_a_figure_is_found_when_it_is_there(self) -> None:
        assert best_match("1,250.00", "the sum of 1,250.00 is due") is not None

    def test_a_figure_is_not_found_inside_a_bigger_one(self) -> None:
        # 1,250.00 is not in 11,250.00, however similar the characters are.
        assert best_match("1,250.00", "the sum of 11,250.00 is due") is None

    def test_a_different_figure_is_not_an_approximate_match(self) -> None:
        # One digit apart is 87% similar and completely wrong.
        assert best_match("1,250.00", "the sum of 7,250.00 is due") is None

    def test_a_digit_may_not_touch_the_match_from_outside(self) -> None:
        assert best_match("1,250.00", "the sum of 1,250.005 is due") is None


class TestALoneLetterIsAnIdentifier:
    def test_it_must_be_there_as_a_word(self) -> None:
        assert best_match("Schedule A", "see Schedule A attached") is not None

    def test_a_different_letter_is_not_close_enough(self) -> None:
        # One letter in ten is 90% similar, which is why closeness alone will
        # not do here.
        assert best_match("Schedule A", "see Schedule B attached") is None

    def test_a_letter_buried_in_a_word_does_not_count(self) -> None:
        assert best_match("Option B", "see Optional Bundle attached") is None


class TestTheScoreBar:
    def test_a_looser_bar_admits_more(self) -> None:
        assert best_match("Subscription", "Subscrlptlon", SearchOptions(min_score=0.8)) is not None

    def test_a_stricter_bar_admits_less(self) -> None:
        assert best_match("Subscription", "Subscrlptlon", SearchOptions(min_score=0.95)) is None


class TestTheEdges:
    def test_an_empty_needle_finds_nothing(self) -> None:
        assert approximate_search("", "anything") == []

    def test_an_empty_text_holds_nothing(self) -> None:
        assert approximate_search("something", "") == []

    def test_offsets_are_utf16_code_units(self) -> None:
        # As JavaScript's string indices are, so a caller slicing the text with
        # them gets the same span in both ports. An emoji is one Python
        # character and two JavaScript ones.
        text = "\U0001F600 Subscription Term"
        found = best_match("Subscription Term", text)

        assert found is not None
        assert found.start == 3
        # The "S" sits at Python index 2 and at code-unit index 3, and the
        # returned offset is the second - which is what makes the two ports
        # agree, and what means a caller must not slice a Python string with it.
        assert text.index("Subscription") == 2
