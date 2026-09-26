"""Where a short text occurs inside a long one, allowing for OCR's errors."""

from .approximate_search_algorithm import (
    ApproximateMatch,
    SearchOptions,
    Span,
    approximate_search,
    best_match,
    word_span,
)

__all__ = [
    "ApproximateMatch",
    "SearchOptions",
    "Span",
    "approximate_search",
    "best_match",
    "word_span",
]
