"""The pipeline contracts, measured against the TypeScript's own declarations.

This slice is types and nothing else, so there are no values to compare - the
TypeScript's types are erased before anything runs. What CAN drift is the
SHAPE, and silently: a field added to an interface and forgotten on the
dataclass breaks nothing here and everything downstream.

So the goldens are read out of the emitted ``.d.ts`` files, which are the
build's own statement of what each interface holds, and every check below is
against those rather than against a list kept by hand. The naming difference is
the one thing that has to be translated: TypeScript writes ``durationMs``,
Python writes ``duration_ms``, so the comparison is on snake_cased names.

WHAT IS DELIBERATELY NOT THE SAME
----------------------------------

Two shapes are not one-to-one, and both are checked rather than waved through.
``PdfTextRun`` is ``Required<TextRun>`` in TypeScript, which Python has no
equivalent of, so it redeclares the optional fields as required - and the test
asserts both classes carry exactly the same field names, so adding one to
either alone fails. ``ReadablePage``'s ``metadata`` is an inline nested object
type in TypeScript; here it is a named :class:`OriginalMetadata`, because an
anonymous two-deep optional object is not a thing a dataclass can express
without inventing a name anyway.
"""

from __future__ import annotations

import dataclasses
import json
import re
from pathlib import Path
from typing import get_args

import pytest

from ..plane_geometry import Point, ScanmateOrientedRect, ScanmateRect
from ..raster_codec import create_raster
from ..region_bleed import Bleed, resolve_bleed, resolve_region_bleed
from .page_region_contract import PageRegion
from .scan_page_contract import (
    AlignedImage,
    AlignedPage,
    OriginalMetadata,
    PageImage,
    ReadablePage,
    ScanPage,
)
from .stage_event_contract import PipelineStage, StageEvent, StagePhase
from .text_run_contract import PdfTextRun, TextRun

_GOLDEN = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "pipeline-contract.json"
    ).read_text(encoding="utf-8"),
)

#: The TypeScript interface for each dataclass here.
_SHAPES = {
    "PageRegion": PageRegion,
    "PageImage": PageImage,
    "ScanPage": ScanPage,
    "AlignedImage": AlignedImage,
    "AlignedPage": AlignedPage,
    "StageEvent": StageEvent,
    "TextRun": TextRun,
}

#: Fields a Python class inherits from a base the golden also names, so they
#: are checked against that base rather than counted twice here.
_INHERITED = {
    "PageRegion": (ScanmateRect, Bleed),
    "AlignedImage": (PageImage,),
    "AlignedPage": (ScanPage,),
    "TextRun": (ScanmateOrientedRect,),
}


def snake(name: str) -> str:
    """TypeScript's camelCase as Python's snake_case.

    :param name: A TypeScript member name.
    :returns: The Python field name it corresponds to.
    """
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def own_fields(cls: type, bases: tuple[type, ...]) -> list[str]:
    """The dataclass fields a class declares itself.

    :param cls: The dataclass.
    :param bases: Bases whose fields belong to them instead.
    :returns: The names it adds.
    """
    inherited = {field.name for base in bases for field in dataclasses.fields(base)}

    return [field.name for field in dataclasses.fields(cls) if field.name not in inherited]


@pytest.mark.parametrize("name", list(_SHAPES))
def test_every_interface_has_the_same_members(name: str) -> None:
    """Names and order, against the emitted declarations.

    Order as well as membership, because these are dataclasses and the order
    is part of their constructor. It costs nothing to keep and it is one more
    way a hand-edit shows up.

    :param name: The interface the golden holds.
    """
    expected = [snake(member) for member, _ in _GOLDEN["interfaces"][name]["members"]]

    assert own_fields(_SHAPES[name], _INHERITED.get(name, ())) == expected


@pytest.mark.parametrize("name", list(_SHAPES))
def test_optionality_matches(name: str) -> None:
    """A field the TypeScript marks ``?`` must have a default here, and only those.

    This is the check that would have caught making ``dpi`` optional, or
    ``detail`` required - both of which would compile, run, and be wrong.

    :param name: The interface the golden holds.
    """
    declared = {field.name: field for field in dataclasses.fields(_SHAPES[name])}

    for member, optional in _GOLDEN["interfaces"][name]["members"]:
        field = declared[snake(member)]
        has_default = (
            field.default is not dataclasses.MISSING
            or field.default_factory is not dataclasses.MISSING
        )

        assert has_default is optional, f"{name}.{member}"


def test_page_region_really_is_both_a_rectangle_and_a_bleed() -> None:
    """``extends ScanmateRect, Bleed`` - and the reason it has to hold.

    The point of the inheritance is that a region can be handed straight to
    the bleed resolver. A flat dataclass carrying the same eleven fields would
    look identical and could not do this.
    """
    assert _GOLDEN["interfaces"]["PageRegion"]["extends"] == ["ScanmateRect", "Bleed"]

    region = PageRegion(x=10, y=20, width=100, height=40, page=1, id="signature", bleed_bottom=20)

    assert isinstance(region, ScanmateRect)
    assert isinstance(region, Bleed)
    assert resolve_region_bleed(region, resolve_bleed()).bottom == 20


@pytest.mark.parametrize("name", ["AlignedImage", "AlignedPage", "TextRun"])
def test_the_inheritance_the_golden_records_is_the_inheritance_here(name: str) -> None:
    """Every ``extends`` in the declarations is a real base class here.

    :param name: The interface the golden holds.
    """
    expected = _GOLDEN["interfaces"][name]["extends"]
    bases = {base.__name__ for base in _SHAPES[name].__mro__}

    assert set(expected) <= bases


def test_pdf_text_run_is_the_required_version_of_text_run() -> None:
    """Same fields, none of them optional.

    ``Required<TextRun>`` has no Python equivalent, so the fields are
    redeclared - which is exactly the kind of duplication that rots. This is
    what stops it: a field added to one and not the other fails here.
    """
    assert _GOLDEN["aliases"]["PdfTextRun"] == "Required<TextRun>"

    run_fields = [f.name for f in dataclasses.fields(TextRun)]
    pdf_fields = [f.name for f in dataclasses.fields(PdfTextRun)]

    assert run_fields == pdf_fields

    for field in dataclasses.fields(PdfTextRun):
        assert field.default is dataclasses.MISSING, field.name
        assert field.default_factory is dataclasses.MISSING, field.name


def test_the_pipeline_stages_are_the_same_eight() -> None:
    """The ``Literal``'s own members, against the golden's union.

    Read out with :func:`typing.get_args` rather than compared to a list
    written here. A ``Literal`` has no runtime behaviour, so dropping a stage
    from it changes nothing that any other test in this file can see - which
    is exactly what happened before this used ``get_args``.
    """
    expected = re.findall(r"'([a-z]+)'", _GOLDEN["aliases"]["PipelineStage"])

    assert list(get_args(PipelineStage)) == expected
    assert len(expected) == 8

    event = StageEvent(stage="align", phase="done", page=1, index=1, total=3, duration_ms=12.5)

    assert event.stage in expected


def test_the_two_phases_are_start_and_done() -> None:
    """Same check for the smaller union, for the same reason."""
    assert list(get_args(StagePhase)) == ["start", "done"]


def test_a_start_event_carries_no_duration_and_a_done_event_may() -> None:
    """``durationMs`` is documented as present on ``done`` only.

    The type cannot enforce that, and neither does this - it pins that the
    field is optional, which is what lets a ``start`` event omit it honestly
    instead of reporting a zero that reads as an instantaneous page.
    """
    start = StageEvent(stage="ocr", phase="start", page=2, index=2, total=5)

    assert start.duration_ms is None
    assert start.detail is None


def test_a_readable_page_carries_only_the_originals_text_layer() -> None:
    """A scan's own text layer has nowhere to live, and that is the design.

    Hidden or stale text in a scan must not vouch for what the paper shows.
    The TypeScript nests ``metadata.original.textItems`` to say so; here the
    nesting is a named :class:`OriginalMetadata` with one field, which says the
    same thing and gives the reason a place to sit.
    """
    assert "original" in _GOLDEN["aliases"]["ReadablePage"]
    assert "scanned" not in _GOLDEN["aliases"]["ReadablePage"]

    raster = create_raster(4, 4)
    side = PageImage(raster=raster, width=4, height=4, image=None, dpi=None)
    aligned = AlignedImage(
        raster=raster,
        width=4,
        height=4,
        image=None,
        dpi=None,
        matrix=(1, 0, 0, 0, 1, 0, 0, 0, 1),
        inverse=(1, 0, 0, 0, 1, 0, 0, 0, 1),
        confidence=0.9,
    )
    run = TextRun(x=1, y=2, width=3, height=4, text="total", baseline=Point(1, 6))
    page = ReadablePage(
        page=1,
        original=side,
        scanned=side,
        aligned=aligned,
        metadata=OriginalMetadata(text_items=(run,)),
    )

    assert page.metadata.text_items == (run,)
    assert [f.name for f in dataclasses.fields(OriginalMetadata)] == ["text_items"]


def test_a_page_image_must_state_what_it_does_not_know() -> None:
    """``image`` and ``dpi`` are required, and nullable - not optional.

    The TypeScript writes ``Uint8Array | null`` and ``number | null``, which
    are required members whose value may be null. Giving them Python defaults
    of ``None`` would read almost the same and mean something different: a
    producer could forget to say. A bare image file genuinely has no
    resolution, and the difference between "none" and "not asked" is the
    difference between a measurement that is skipped and one that is invented.
    """
    with pytest.raises(TypeError):
        PageImage(raster=create_raster(2, 2), width=2, height=2)  # type: ignore[call-arg]

    side = PageImage(raster=create_raster(2, 2), width=2, height=2, image=None, dpi=None)

    assert side.image is None
    assert side.dpi is None
