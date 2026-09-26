"""Everything the TypeScript exports has a Python equivalent, and nothing is missing.

A port can be exact in every algorithm and still be unusable, by quietly not
exposing one of them.
"""

from __future__ import annotations

import json
from pathlib import Path

import scanmate_merge

_GOLDEN = json.loads(
    (
        Path(__file__).parents[3] / "tools" / "parity" / "goldens" / "merge-package-surface.json"
    ).read_text(encoding="utf-8")
)

#: TypeScript export name -> the Python name that carries it.
_EQUIVALENTS = {
    "MIN_RECORDED_DPI": "MIN_RECORDED_DPI",
    "MergeSourceError": "MergeSourceError",
    "PAPER": "PAPER",
    "PdfPasswordError": "PdfPasswordError",
    "isPdf": "is_pdf",
    "markPages": "mark_pages",
    "mergeDocuments": "merge_documents",
    "openPdf": "open_pdf",
    "placeImage": "place_image",
    "readSource": "read_source",
    "resolveDpi": "resolve_dpi",
    "toUserSpace": "to_user_space",
    "viewportSize": "viewport_size",
    "viewportTransform": "viewport_transform",
}

#: Exported by the TypeScript as types, which erase at build time and so never
#: appear in the golden's runtime list. In Python they are real objects, and a
#: consumer annotating a function needs them importable.
_TYPES = [
    "Affine",
    "Embedding",
    "MarkOptions",
    "MarkResult",
    "MergeMetadata",
    "MergeOptions",
    "MergeResult",
    "MergedPage",
    "PageDimensions",
    "PageGeometry",
    "PageMark",
    "PageSize",
    "Placement",
    "ResolvedSource",
    "SourceKind",
]


def test_every_typescript_export_has_a_python_equivalent() -> None:
    missing = [
        name
        for name in _GOLDEN["exports"]
        if not hasattr(scanmate_merge, _EQUIVALENTS.get(name, name))
    ]

    assert missing == []


def test_the_equivalents_table_still_describes_the_typescript() -> None:
    # Otherwise the test above passes by describing a package that changed: an
    # export renamed upstream would leave a stale entry here mapping a name
    # that no longer exists, and nothing would say so.
    assert sorted(_EQUIVALENTS) == sorted(_GOLDEN["exports"])


def test_the_types_a_consumer_annotates_with_are_importable() -> None:
    assert [name for name in _TYPES if not hasattr(scanmate_merge, name)] == []


def test_nothing_is_exported_that_is_not_declared() -> None:
    # `__all__` is the package's promise. A name reachable but undeclared is
    # one nobody can rely on and everybody will use anyway.
    declared = set(scanmate_merge.__all__)
    expected = {_EQUIVALENTS[name] for name in _GOLDEN["exports"]} | set(_TYPES)

    assert declared == expected
