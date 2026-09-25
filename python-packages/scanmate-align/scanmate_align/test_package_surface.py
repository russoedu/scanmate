"""Every name ``@scanmate/align`` exports, accounted for.

Every other test in this package checks that a function AGREES with its
TypeScript counterpart. None of them checks that the counterpart was ported at
all: a whole export could be missing and the suite would stay green. This is
the one that would notice, and it is the same guard ``scanmate-ink`` carries.

THE CHECKLIST IS EMPTY, AND THAT IS THE POINT

While ``scan_alignment`` was unported, the eleven names it would bring were
listed in :data:`_NOT_YET_PORTED` and this file asserted they were **still
missing**. When the slice landed, both halves fired at once: the "every ported
export is present" test said nothing was missing, and the "still unported" test
said the table was stale. That is the guard working in both directions rather
than only the reassuring one.

The table stays, empty, because the next slice of this repository to be ported
will want it - and an empty table with a docstring is a cheaper thing to find
than the idea behind it.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import scanmate_align

_GOLDEN = json.loads(
    (
        Path(__file__).parents[3] / "tools" / "parity" / "goldens" / "align-package-surface.json"
    ).read_text(encoding="utf-8"),
)

#: Exports not ported yet, each with the slice that will bring it. Not
#: decisions - unfinished work, which is why this is separate from ink's
#: ``_ABSENT_BY_DESIGN``: a name here is a promise, not a trade-off.
#:
#: Empty now. ``scan_alignment`` was the last slice, and when it landed this
#: table went from eleven entries to none.
_NOT_YET_PORTED: dict[str, str] = {}

#: TypeScript names whose Python spelling is not a mechanical snake_case of it.
_RENAMED = {
    "DEFAULT_MODELS": "DEFAULT_MODELS",
    "DESCRIPTOR_WORDS": "DESCRIPTOR_WORDS",
}


def python_name(exported: str) -> str:
    """The name this port gives a TypeScript export.

    Types keep their PascalCase; functions and constants become snake_case.

    :param exported: The TypeScript name.
    :returns: The Python name to look for.
    """
    if exported in _RENAMED:
        return _RENAMED[exported]
    if exported[0].isupper():
        return exported

    return re.sub(r"(?<!^)(?=[A-Z])", "_", exported).lower()


def test_every_ported_export_is_present() -> None:
    """The finished slices, name by name."""
    surface = set(scanmate_align.__all__)
    missing = [
        f"{exported} -> {python_name(exported)}"
        for exported in _GOLDEN["exports"]
        if exported not in _NOT_YET_PORTED and python_name(exported) not in surface
    ]

    assert missing == []


def test_the_unported_names_are_still_unported() -> None:
    """The checklist, enforced in the other direction.

    A name that lands without being struck off this table means the table is
    stale, and a stale table is how a surface guard quietly stops guarding.
    """
    surface = set(scanmate_align.__all__)
    arrived = [
        exported for exported in _NOT_YET_PORTED if python_name(exported) in surface
    ]

    assert arrived == [], (
        f"{arrived} are ported now - remove them from _NOT_YET_PORTED so this guard keeps "
        "covering the rest"
    )


def test_the_unported_names_are_names_the_typescript_actually_exports() -> None:
    # Guards the table itself: a typo in `_NOT_YET_PORTED` would silently
    # excuse a real export from the check above.
    assert set(_NOT_YET_PORTED) <= set(_GOLDEN["exports"])


def test_the_barrel_exports_exactly_what_it_lists() -> None:
    """``__all__`` and the module agree, in both directions.

    A name in ``__all__`` that the module does not have makes
    ``from scanmate_align import *`` raise, and only at the call site.
    """
    for name in scanmate_align.__all__:
        assert hasattr(scanmate_align, name), name

    assert len(scanmate_align.__all__) == len(set(scanmate_align.__all__))


def test_the_port_adds_nothing_the_typescript_does_not_have_without_saying_so() -> None:
    """Extras are allowed, and have to be explainable."""
    expected_extra = {
        # Python-only, and both for the same reason: a dataclass cannot
        # express TypeScript's anonymous `{ original, scanned }`, and a field
        # needs a named type to be one.
        #
        # They are two types rather than one because they mean different
        # things - radians from the coarse stage, degrees in the diagnostics -
        # and giving them one name would invite the mistake the units already
        # make easy.
        "PageSkew",
        "SkewDegrees",
    }
    ported = {python_name(name) for name in _GOLDEN["exports"]}
    extra = set(scanmate_align.__all__) - ported

    assert extra <= expected_extra, sorted(extra - expected_extra)
