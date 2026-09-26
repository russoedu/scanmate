"""What this package offers, and what has not been ported yet.

Three lists, and the last two carry the honesty: an export that is *absent on
purpose* is a decision, one that is *not ported yet* is work outstanding, and a
reader can tell them apart. The test fails if an export upstream lands in none
of them.
"""

from __future__ import annotations

import json
from pathlib import Path

import scanmate_ocr

_GOLDEN = json.loads(
    (
        Path(__file__).parents[3] / "tools" / "parity" / "goldens" / "ocr-package-surface.json"
    ).read_text(encoding="utf-8")
)

#: TypeScript export name -> the Python name that carries it.
_EQUIVALENTS = {
    "compareTexts": "compare_texts",
    "cosine": "cosine",
    "dice": "dice",
    "jaccard": "jaccard",
    "jaroWinkler": "jaro_winkler",
    "levenshtein": "levenshtein",
    "levenshteinSimilarity": "levenshtein_similarity",
    "wordDistance": "word_distance",
    "wordRecall": "word_recall",
}

#: Absent on purpose: reading a page is Tesseract's, and a Python wrapper of a
#: different Tesseract build is not a parallel port of a WASM one - the
#: recognised text is the engine's output, not this package's computation.
_ABSENT_BY_DESIGN = {
    "createTesseractEngine": "builds a tesseract.js worker",
    "DEFAULT_TESSERACT_OPTIONS": "options for that worker",
    "ocrPages": "runs the engine over rendered pages",
    "readRun": "runs the engine over one run",
    "recheckRun": "re-runs the engine at a higher resolution",
    "DEFAULT_RECHECK_PASSES": "how many times to re-run the engine",
    "judgeRun": "scores what the engine returned",
    "judgeRuns": "scores what the engine returned",
    "claimWords": "works on what the engine returned",
    "matchWords": "works on what the engine returned",
}

#: Not ported yet, and named so that "missing" never has to be guessed at.
#: Every one of these takes a rendered page's pixels, so porting them needs
#: image-driven goldens rather than value-driven ones.
_NOT_YET_PORTED = {
    "FIGURE_CHARACTERS": "print verification",
    "TEXT_CHARACTERS": "print verification",
    "collectInto": "print verification",
    "collectTemplates": "print verification",
    "glyphCells": "print verification",
    "glyphWords": "print verification",
    "placeGlyphs": "print verification",
    "printPolarity": "print verification",
    "templateKey": "print verification",
    "verifyPrintedRun": "print verification",
}


def test_every_typescript_export_is_accounted_for() -> None:
    accounted = set(_EQUIVALENTS) | set(_ABSENT_BY_DESIGN) | set(_NOT_YET_PORTED)
    unaccounted = [name for name in _GOLDEN["exports"] if name not in accounted]

    assert unaccounted == []


def test_the_three_lists_do_not_overlap() -> None:
    assert set(_EQUIVALENTS) & set(_ABSENT_BY_DESIGN) == set()
    assert set(_EQUIVALENTS) & set(_NOT_YET_PORTED) == set()
    assert set(_ABSENT_BY_DESIGN) & set(_NOT_YET_PORTED) == set()


def test_the_lists_describe_the_typescript_and_nothing_else() -> None:
    # A stale entry would otherwise sit here forever describing an export that
    # no longer exists.
    named = set(_EQUIVALENTS) | set(_ABSENT_BY_DESIGN) | set(_NOT_YET_PORTED)
    extra = [name for name in named if name not in _GOLDEN["exports"]]

    assert extra == []


def test_every_ported_export_is_importable() -> None:
    missing = [name for name in _EQUIVALENTS.values() if not hasattr(scanmate_ocr, name)]

    assert missing == []


def test_nothing_declared_unported_is_exported_after_all() -> None:
    # When one of these lands, it has to move between the lists deliberately.
    surprises = [
        name
        for name in set(_ABSENT_BY_DESIGN) | set(_NOT_YET_PORTED)
        if hasattr(scanmate_ocr, name)
    ]

    assert surprises == []
