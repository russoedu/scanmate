"""``scanmate-ocr`` - how alike two texts are, measured exactly.

.. code-block:: python

    from scanmate_ocr import compare_texts

    metrics = compare_texts(expected, read)
    metrics.word_recall            # is what should be there, there?
    metrics.character_error_rate   # what anyone who works with OCR expects to see

Two halves, both pure: how alike two texts are, and whether a printed figure is
still the figure that was printed - decided by matching its ink rather than by
reading it.

**This package does not run OCR.** Reading a page is Tesseract's job, and this
is everything you do either side of the answer. See the README.
"""

from .print_verification import (
    CONTRAST,
    FIGURE_CHARACTERS,
    JOIN,
    MATCH_HEIGHT,
    MAX_PRINTED_SCORE,
    MIN_MARGIN,
    MIN_PRINTED_SCORE,
    MIN_RIVALS,
    MIN_SCORE,
    MIN_TEXT_RIVALS,
    PER_CHARACTER,
    TEXT_CHARACTERS,
    CellOptions,
    CellVerification,
    PrintAbstention,
    PrintCheck,
    PrintPolarity,
    Templates,
    TemplateStore,
    VerifyOptions,
    collect_into,
    collect_templates,
    cut,
    glyph_cells,
    glyph_words,
    place_glyphs,
    print_polarity,
    printed_characters,
    template_key,
    verify_printed_run,
)
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
    "CONTRAST",
    "FIGURE_CHARACTERS",
    "JOIN",
    "MATCH_HEIGHT",
    "MAX_PRINTED_SCORE",
    "MIN_MARGIN",
    "MIN_PRINTED_SCORE",
    "MIN_RIVALS",
    "MIN_SCORE",
    "MIN_TEXT_RIVALS",
    "PER_CHARACTER",
    "TEXT_CHARACTERS",
    "CellOptions",
    "CellVerification",
    "PrintAbstention",
    "PrintCheck",
    "PrintPolarity",
    "ScoreMetric",
    "TemplateStore",
    "Templates",
    "VerifyOptions",
    "collect_into",
    "collect_templates",
    "cut",
    "glyph_cells",
    "glyph_words",
    "place_glyphs",
    "print_polarity",
    "printed_characters",
    "template_key",
    "verify_printed_run",
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
