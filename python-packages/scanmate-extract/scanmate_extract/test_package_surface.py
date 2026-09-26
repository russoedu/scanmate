"""What this package offers, and what it deliberately does not.

Two lists, and the second matters as much as the first: an export that is
*absent on purpose* has to be written down, or the next reader cannot tell a
decision from an omission. ``scanmate-ink`` does the same for ``resampleRaster``
and ``blurRaster``.
"""

from __future__ import annotations

import json
from pathlib import Path

import scanmate_extract

_GOLDEN = json.loads(
    (
        Path(__file__).parents[3] / "tools" / "parity" / "goldens" / "extract-package-surface.json"
    ).read_text(encoding="utf-8")
)

#: TypeScript export name -> the Python name that carries it.
_EQUIVALENTS = {
    "DEFAULT_DPI_LIMITS": "DEFAULT_DPI_LIMITS",
    "MAX_WORD_GAP": "MAX_WORD_GAP",
    "SCAN_COVERAGE": "SCAN_COVERAGE",
    "classifyPage": "classify_page",
    "locateAnchor": "locate_anchor",
    "nativeDpi": "native_dpi",
    "pageDpi": "page_dpi",
    "pairDpi": "pair_dpi",
    "placeField": "place_field",
    "planPairs": "plan_pairs",
    "resolveFields": "resolve_fields",
    "selectPages": "select_pages",
}

#: Absent on purpose, each because it cannot be a parallel port.
#:
#: Everything here goes through pdf.js, and the two things pdf.js does that no
#: Python engine reproduces are **rasterising a page** and **segmenting a text
#: layer**. A Python `render_page` would produce different pixels; a Python
#: `read_text_layer` would produce a different set of runs entirely, because
#: run segmentation and per-font ascent/descent metrics are pdf.js's own. Since
#: every export below returns or depends on one of those two, none of them can
#: be held to the TypeScript, and a port of them would be a different tool
#: under the same name.
_ABSENT_BY_DESIGN = {
    "A4": "a page size used only by createSyntheticPdf",
    "createSyntheticPdf": "builds a PDF for the TypeScript's own tests",
    "extractPages": "renders pages",
    "extractPageStream": "renders pages",
    "extractPair": "renders pages",
    "extractPairStream": "renders pages",
    "inspectDocument": "reads a text layer",
    "inspectPage": "reads a text layer and measures pdf.js image objects",
    "locateFields": "reads a text layer; resolve_fields is the pure half, and is here",
    "openPdf": "hands back a pdf.js document",
    "readTextLayer": "segments runs the way pdf.js does",
    "renderPage": "rasterises through pdf.js onto a canvas",
}


def test_every_typescript_export_is_either_ported_or_declared_absent() -> None:
    # The check that keeps the absent list honest: a new export upstream lands
    # in neither table and fails here, rather than being quietly missing.
    accounted = set(_EQUIVALENTS) | set(_ABSENT_BY_DESIGN)
    unaccounted = [name for name in _GOLDEN["exports"] if name not in accounted]

    assert unaccounted == []


def test_the_two_tables_do_not_overlap() -> None:
    assert set(_EQUIVALENTS) & set(_ABSENT_BY_DESIGN) == set()


def test_the_tables_describe_the_typescript_and_nothing_else() -> None:
    # A stale entry - an export renamed or removed upstream - would otherwise
    # sit here forever describing something that no longer exists.
    extra = [
        name
        for name in (set(_EQUIVALENTS) | set(_ABSENT_BY_DESIGN))
        if name not in _GOLDEN["exports"]
    ]

    assert extra == []


def test_every_ported_export_is_importable() -> None:
    missing = [name for name in _EQUIVALENTS.values() if not hasattr(scanmate_extract, name)]

    assert missing == []


def test_nothing_absent_by_design_is_exported_after_all() -> None:
    # If one of these ever becomes portable, it has to move between the tables
    # deliberately rather than by accident.
    present = [
        name
        for name in _ABSENT_BY_DESIGN
        if hasattr(scanmate_extract, name) or hasattr(scanmate_extract, _snake(name))
    ]

    assert present == []


def test_every_absent_export_says_why() -> None:
    assert [name for name, reason in _ABSENT_BY_DESIGN.items() if not reason] == []


def _snake(name: str) -> str:
    """``renderPage`` -> ``render_page``, so the check catches either spelling."""
    out: list[str] = []
    for character in name:
        if character.isupper() and out:
            out.append("_")
        out.append(character.lower())

    return "".join(out)
