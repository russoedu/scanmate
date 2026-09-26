"""``scanmate-ocr`` - how alike two texts are, measured exactly.

.. code-block:: python

    from scanmate_ocr import compare_texts

    metrics = compare_texts(expected, read)
    metrics.word_recall            # is what should be there, there?
    metrics.character_error_rate   # what anyone who works with OCR expects to see

**This package does not run OCR.** Reading a page is Tesseract's job, and this
is everything you do with the answer. See the README for what that means and
what is still to come.
"""

from .text_similarity import (
    ScoreMetric,
    TextMetrics,
    compare_texts,
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
