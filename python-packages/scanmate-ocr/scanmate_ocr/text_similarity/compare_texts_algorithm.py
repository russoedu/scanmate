"""Every measure of how alike an expected text and an actual one are."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, TypeAlias

from scanmate_ink import NormaliseOptions, normalise_text

from .similarity_metrics_algorithm import (
    cosine,
    dice,
    jaccard,
    jaro_winkler,
    levenshtein,
    utf16_length,
    word_distance,
    word_recall,
)

#: Which measure a caller scores a page on.
ScoreMetric: TypeAlias = Literal[
    "levenshtein_similarity", "word_recall", "jaccard", "dice", "cosine"
]


@dataclass(frozen=True, slots=True)
class TextMetrics:
    """How alike two texts are, measured every way."""

    #: Characters of edit between the normalised texts.
    levenshtein: int
    #: ``1 - levenshtein / longer length``.
    levenshtein_similarity: float
    #: Share of distinct words in common.
    jaccard: float
    #: Character-bigram overlap.
    dice: float
    #: Word-frequency cosine.
    cosine: float
    #: Only meaningful on short strings; reported for completeness.
    jaro_winkler: float
    #: Character error rate: edits over the expected length. Can exceed 1.
    character_error_rate: float
    #: Word error rate: word edits over the expected word count. Can exceed 1.
    word_error_rate: float
    #: Share of expected words present, each used once.
    word_recall: float
    #: Actual length over expected length - near 0 when a page read as nothing,
    #: and ``inf`` when nothing was expected and something was read.
    length_ratio: float
    #: Normalised expected length, in characters: the weight this text carries
    #: in a total.
    characters: int


def compare_texts(
    expected: str, actual: str, options: NormaliseOptions | None = None
) -> TextMetrics:
    """Normalise both texts the same way, then measure them every way.

    :param expected: The text that should be there.
    :param actual: The text that was read.
    :param options: How to normalise before comparing.
    :returns: Every measure.
    """
    a = normalise_text(expected, options)
    b = normalise_text(actual, options)
    a_words = [] if a == "" else a.split(" ")
    b_words = [] if b == "" else b.split(" ")
    edits = levenshtein(a, b)
    a_length = utf16_length(a)
    b_length = utf16_length(b)
    longest = max(a_length, b_length)

    return TextMetrics(
        levenshtein=edits,
        levenshtein_similarity=1.0 if longest == 0 else 1 - edits / longest,
        jaccard=jaccard(a_words, b_words),
        dice=dice(a, b),
        cosine=cosine(a_words, b_words),
        jaro_winkler=jaro_winkler(a, b),
        character_error_rate=(
            (0.0 if b_length == 0 else 1.0) if a_length == 0 else edits / a_length
        ),
        word_error_rate=(
            (0.0 if len(b_words) == 0 else 1.0)
            if len(a_words) == 0
            else word_distance(a_words, b_words) / len(a_words)
        ),
        word_recall=word_recall(a_words, b_words),
        length_ratio=(
            (1.0 if b_length == 0 else math.inf) if a_length == 0 else b_length / a_length
        ),
        characters=a_length,
    )
