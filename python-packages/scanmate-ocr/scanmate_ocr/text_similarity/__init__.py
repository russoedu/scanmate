"""How alike two texts are, measured several ways."""

from .compare_texts_algorithm import ScoreMetric, TextMetrics, compare_texts
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

__all__ = [
    "ScoreMetric",
    "TextMetrics",
    "compare_texts",
    "cosine",
    "dice",
    "jaccard",
    "jaro_winkler",
    "levenshtein",
    "levenshtein_similarity",
    "utf16_length",
    "utf16_units",
    "word_distance",
    "word_recall",
]
