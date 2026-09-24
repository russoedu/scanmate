"""Every name ``@scanmate/ink`` exports, accounted for.

Every other test in this package checks that a function AGREES with its
TypeScript counterpart. None of them checks that the counterpart was ported at
all: a whole export could be missing and the suite would stay green. This is
the one that would notice.

The golden is read out of the TypeScript's own built ``index.d.ts``, so adding
an export there and forgetting it here fails rather than drifting.

THE ABSENCES ARE THE INTERESTING PART
--------------------------------------

Six exports are deliberately not ported, and each is a decision worth failing
over if it is ever made silently rather than written down:

- ``resampleRaster`` and ``blurRaster`` go through libvips. Pillow's LANCZOS
  disagrees with libvips' lanczos3 on 78.8% of pixels, and libvips' blur is an
  integer APPROXIMATION of a Gaussian rather than a Gaussian - both measured.
  A Python "equivalent" would be a different operation wearing the same name,
  which is worse than not having one. ``resize_gray`` and ``box_blur_raster``
  are scanmate's OWN resampler and blur, are ported, and are bit-exact.
- ``ImageWithResolution`` is a codec convenience the port has no caller for.
- ``DecodeOptions`` and ``EncodeOptions`` are options objects, which is how
  TypeScript spells named arguments. Python has them in the language, so
  ``decode_image`` and ``encode_image`` take keyword arguments and there is no
  object to name.

This file lives at the package root rather than in a slice because its subject
is the package, not any one of them - the same reason the TypeScript's
``index.ts`` is where it is.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import scanmate_ink

_GOLDEN = json.loads(
    (
        Path(__file__).parents[3] / "tools" / "parity" / "goldens" / "package-surface.json"
    ).read_text(encoding="utf-8"),
)

#: Exports that are not ported, each with the reason. See the module docstring.
_ABSENT_BY_DESIGN = {
    "resampleRaster": "libvips; Pillow's LANCZOS differs on 78.8% of pixels",
    "ResampleOptions": "options for resampleRaster, which is absent",
    "blurRaster": "libvips; its blur is an integer approximation of a Gaussian",
    "ImageWithResolution": "a codec convenience with no caller in the port",
    "DecodeOptions": "the port takes keyword arguments, which is the same thing in Python",
    "EncodeOptions": "the port takes keyword arguments, which is the same thing in Python",
}

#: TypeScript names whose Python spelling is not a mechanical snake_case of it.
_RENAMED = {
    "IDENTITY": "IDENTITY",
    "DEFAULT_BLEED": "DEFAULT_BLEED",
    "DEFAULT_NORMALISE": "DEFAULT_NORMALISE",
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


def test_every_export_is_ported_or_recorded_as_absent() -> None:
    """The whole surface, name by name.

    A failure here means one of two things, and the message says which: a name
    the TypeScript exports that nothing here provides, or an absence that was
    never written down.
    """
    surface = set(scanmate_ink.__all__)
    missing = []

    for exported in _GOLDEN["exports"]:
        if exported in _ABSENT_BY_DESIGN:
            assert python_name(exported) not in surface, f"{exported} is listed absent but exported"
            continue
        if python_name(exported) not in surface:
            missing.append(f"{exported} -> {python_name(exported)}")

    assert missing == []


def test_the_absences_are_still_absent_for_the_reasons_given() -> None:
    """The two that matter carry a measured reason, not a shrug.

    Recorded as a test so that porting one later is a deliberate act: the
    reason has to be removed from the table, and that is a diff a reviewer
    sees.
    """
    assert set(_ABSENT_BY_DESIGN) <= set(_GOLDEN["exports"])
    assert "78.8%" in _ABSENT_BY_DESIGN["resampleRaster"]
    assert "approximation" in _ABSENT_BY_DESIGN["blurRaster"]

    # The two that ARE ported, and are the reason the absences cost nothing:
    # scanmate's own resampler and blur, both bit-exact.
    assert "resize_gray" in scanmate_ink.__all__
    assert "box_blur_raster" in scanmate_ink.__all__


def test_the_barrel_exports_exactly_what_it_lists() -> None:
    """``__all__`` and the module agree, in both directions.

    A name in ``__all__`` that the module does not have makes
    ``from scanmate_ink import *`` raise, and only at the call site.
    """
    for name in scanmate_ink.__all__:
        assert hasattr(scanmate_ink, name), name

    assert len(scanmate_ink.__all__) == len(set(scanmate_ink.__all__))


def test_the_port_adds_nothing_the_typescript_does_not_have_without_saying_so() -> None:
    """Extras are allowed, and have to be explainable.

    ``js_semantics`` and ``random_stream`` exist only because Python needs
    them - JavaScript's rounding and its ``+=`` accumulation order are free in
    the original - so they are listed here rather than left to look like
    scope creep.
    """
    expected_extra = {
        # Python-only: the original gets these from the language.
        "random_stream",
        "with_options",
        # Python-only: named because a dataclass cannot express an anonymous
        # nested optional object, and a tuple return needs a name to be read.
        "OriginalMetadata",
        "Downscaled",
        "SkewOptions",
        "StagePhase",
    }
    ported = {python_name(name) for name in _GOLDEN["exports"]}
    extra = set(scanmate_ink.__all__) - ported

    assert extra <= expected_extra, sorted(extra - expected_extra)
