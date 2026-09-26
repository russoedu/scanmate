"""Everything the TypeScript exports has a Python equivalent, and nothing is missing.

A port can be bit-exact in every algorithm and still be unusable, by quietly
not exposing one of them. This is the check that the two packages offer the
same thing.
"""

from __future__ import annotations

import json
from pathlib import Path

import scanmate_seal

_GOLDEN = json.loads(
    (
        Path(__file__).parents[3] / "tools" / "parity" / "goldens" / "seal-package-surface.json"
    ).read_text(encoding="utf-8")
)

#: TypeScript export name -> the Python name that carries it.
_EQUIVALENTS = {
    "findSignatureFields": "find_signature_fields",
    "verifySignatures": "verify_signatures",
}

#: Exported by the TypeScript as types, which erase at build time and so never
#: appear in the golden's runtime export list. In Python they are real objects,
#: and a consumer annotating a function needs them importable.
_TYPES = ["SealReport", "SignatureCheck", "SignatureField", "SignatureProblem", "Signer"]


def test_every_typescript_export_has_a_python_equivalent() -> None:
    missing = [
        name
        for name in _GOLDEN["exports"]
        if not hasattr(scanmate_seal, _EQUIVALENTS.get(name, name))
    ]

    assert missing == []


def test_the_equivalents_table_still_describes_the_typescript() -> None:
    # Otherwise the test above passes by describing a package that changed:
    # an export renamed upstream would leave a stale entry here mapping a name
    # that no longer exists, and nothing would say so.
    assert sorted(_EQUIVALENTS) == sorted(_GOLDEN["exports"])


def test_the_types_a_consumer_annotates_with_are_importable() -> None:
    missing = [name for name in _TYPES if not hasattr(scanmate_seal, name)]

    assert missing == []


def test_nothing_is_exported_that_is_not_declared() -> None:
    # `__all__` is the package's promise. A name reachable but undeclared is
    # one nobody can rely on and everybody will use anyway.
    declared = set(scanmate_seal.__all__)
    expected = {_EQUIVALENTS[name] for name in _GOLDEN["exports"]} | set(_TYPES)

    assert declared == expected
