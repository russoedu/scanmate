"""Every text measure, held to the TypeScript exactly.

`==`, not `approx`: these are the numbers a page is scored on, and a port that
is right to six places is a port that disagrees about whether a document passed.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pytest

from .compare_texts_algorithm import compare_texts
from .similarity_metrics_algorithm import (
    cosine,
    dice,
    jaccard,
    jaro_winkler,
    levenshtein,
    levenshtein_similarity,
    utf16_length,
    utf16_units,
    word_distance,
    word_recall,
)

_GOLDEN: dict[str, Any] = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "ocr-text-similarity.json"
    ).read_text(encoding="utf-8")
)

#: TypeScript field name -> the Python attribute that carries it.
_FIELDS = [
    ("levenshtein", "levenshtein"),
    ("levenshteinSimilarity", "levenshtein_similarity"),
    ("jaccard", "jaccard"),
    ("dice", "dice"),
    ("cosine", "cosine"),
    ("jaroWinkler", "jaro_winkler"),
    ("characterErrorRate", "character_error_rate"),
    ("wordErrorRate", "word_error_rate"),
    ("wordRecall", "word_recall"),
    ("lengthRatio", "length_ratio"),
    ("characters", "characters"),
]


@pytest.mark.parametrize("name", sorted(_GOLDEN["compareTexts"]))
def test_compare_texts_matches_the_typescript(name: str) -> None:
    case = _GOLDEN["compareTexts"][name]
    metrics = compare_texts(case["expected"], case["actual"])

    for js, py in _FIELDS:
        want = case["metrics"][js]
        # JSON has no Infinity, so JSON.stringify writes null for it - which is
        # what `lengthRatio` is when nothing was expected and something read.
        expected = math.inf if want is None else want

        assert getattr(metrics, py) == expected, js


@pytest.mark.parametrize("name", sorted(_GOLDEN["onStrings"]))
def test_the_string_measures_match_the_typescript(name: str) -> None:
    case = _GOLDEN["onStrings"][name]
    pair = _GOLDEN["compareTexts"][name]
    a, b = pair["expected"], pair["actual"]

    assert levenshtein(a, b) == case["levenshtein"]
    assert levenshtein_similarity(a, b) == case["levenshteinSimilarity"]
    assert dice(a, b) == case["dice"]
    assert jaro_winkler(a, b) == case["jaroWinkler"]


@pytest.mark.parametrize("name", sorted(_GOLDEN["onWordLists"]))
def test_the_word_measures_match_the_typescript(name: str) -> None:
    case = _GOLDEN["onWordLists"][name]

    assert jaccard(case["a"], case["b"]) == case["jaccard"]
    assert cosine(case["a"], case["b"]) == case["cosine"]
    assert word_recall(case["a"], case["b"]) == case["wordRecall"]
    assert word_distance(case["a"], case["b"]) == case["wordDistance"]


class TestUtf16Semantics:
    """A JavaScript string is UTF-16 code units, and Python's is not.

    They differ only outside the Basic Multilingual Plane - and where they
    differ, every length-derived measure moves. A port that used Python
    characters would agree on every ordinary page and disagree on the one that
    had an emoji in it.
    """

    def test_an_astral_character_is_two_units(self) -> None:
        assert utf16_length("\U0001F600") == 2
        assert len("\U0001F600") == 1

    def test_the_units_are_a_surrogate_pair(self) -> None:
        assert utf16_units("\U0001F600") == [0xD83D, 0xDE00]

    def test_a_bmp_character_is_one_unit(self) -> None:
        assert utf16_units("é") == [0xE9]

    def test_similarity_counts_units_not_characters(self) -> None:
        # The case that proves the point: these differ in one code unit out of
        # ten, so the similarity is 0.9. Counting Python characters gives nine
        # and 0.888..., and nothing else in the suite would notice.
        a, b = "fee \U0001F600 due", "fee \U0001F601 due"

        assert levenshtein_similarity(a, b) == 0.9
        assert levenshtein_similarity(a, b) != 1 - 1 / len(a)


class TestTheEdgeCases:
    def test_two_empty_texts_are_identical(self) -> None:
        metrics = compare_texts("", "")

        assert metrics.levenshtein_similarity == 1
        assert metrics.character_error_rate == 0
        assert metrics.length_ratio == 1

    def test_expecting_nothing_and_reading_something_is_an_infinite_ratio(self) -> None:
        # Not an error and not zero: there is no denominator, and saying so is
        # more useful than a number that looks comparable.
        assert compare_texts("", "something").length_ratio == math.inf

    def test_a_page_that_read_as_nothing_has_a_ratio_near_zero(self) -> None:
        # The signal that an OCR pass failed outright rather than misread.
        assert compare_texts("a page of text", "").length_ratio == 0

    def test_error_rates_can_exceed_one(self) -> None:
        # Deliberately not clamped: reading far more than was expected is a
        # different failure from reading it wrong, and the number says which.
        assert compare_texts("a", "aaaaaaaa").character_error_rate > 1

    @pytest.mark.parametrize("metric", [jaccard, cosine, word_recall])
    def test_two_empty_word_lists_are_identical(self, metric: Any) -> None:
        assert metric([], []) == 1

    def test_dice_needs_two_characters_to_have_a_bigram(self) -> None:
        assert dice("a", "b") == 0
        # Equal strings short-circuit, so this is 1 rather than 0.
        assert dice("a", "a") == 1

    def test_jaro_winkler_rewards_a_shared_prefix(self) -> None:
        assert jaro_winkler("martha", "marhta") > jaro_winkler("martha", "arthma")

    def test_word_recall_uses_each_found_word_once(self) -> None:
        # Otherwise one "aa" in the reading would satisfy every "aa" expected,
        # and a page that lost a repeat would score perfectly.
        assert word_recall(["aa", "aa"], ["aa"]) == 0.5
