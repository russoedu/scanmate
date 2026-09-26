"""Anchors and field placement, held to the TypeScript exactly.

The runs are built here rather than read from a PDF, because what is pinned is
how runs are *joined* and where the box lands — not how a particular engine
extracted them. That distinction is the whole reason this slice is exact while
reading a text layer is not; see the package README.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from scanmate_ink import ScanmateRect, TextRun

from .field_location_contract import FieldOffset, FieldSpec, LocatablePage
from .locate_anchor_algorithm import MAX_WORD_GAP, locate_anchor
from .resolve_fields_use_case import place_field, resolve_fields

_GOLDEN: dict[str, Any] = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "extract-field-location.json"
    ).read_text(encoding="utf-8")
)


def _runs(name: str) -> list[TextRun]:
    return [
        TextRun(
            x=r["x"],
            y=r["y"],
            width=r["width"],
            height=r["height"],
            angle=r["angle"],
            text=r["text"],
            baseline=r["baseline"],
            font_size=r["fontSize"],
            font_name=r["fontName"],
            ends_line=r["endsLine"],
        )
        for r in _GOLDEN["pages"][name]
    ]


def _specs(raw: list[dict[str, Any]]) -> list[FieldSpec]:
    return [
        FieldSpec(
            anchor=s["anchor"],
            fields={k: FieldOffset(**v) for k, v in s["fields"].items()},
            occurrence=s.get("occurrence", "unique"),
            page=s.get("page"),
            from_corner=s.get("from", "top-left"),
        )
        for s in raw
    ]


def test_the_word_gap_is_the_typescripts() -> None:
    assert MAX_WORD_GAP == _GOLDEN["maxWordGap"]


@pytest.mark.parametrize("name", sorted(_GOLDEN["locateAnchor"]))
def test_locate_anchor_matches_the_typescript(name: str) -> None:
    case = _GOLDEN["locateAnchor"][name]
    matches = locate_anchor(_runs(case["page"]), case["anchor"])

    assert len(matches) == len(case["matches"])
    for match, want in zip(matches, case["matches"], strict=True):
        assert match.box.x == want["box"]["x"]
        assert match.box.y == want["box"]["y"]
        assert match.box.width == want["box"]["width"]
        assert match.box.height == want["box"]["height"]
        assert match.estimated == want["estimated"]


@pytest.mark.parametrize("name", sorted(_GOLDEN["resolveFields"]))
def test_resolve_fields_matches_the_typescript(name: str) -> None:
    case = _GOLDEN["resolveFields"][name]
    page = LocatablePage(page=1, width=612, height=792, text_items=_runs(case["page"]))
    located = resolve_fields([page], _specs(case["specs"]))
    want = case["located"]

    assert [p.kind for p in located.problems] == [p["kind"] for p in want["problems"]]
    assert len(located.regions) == len(want["regions"])
    for region, expected in zip(located.regions, want["regions"], strict=True):
        assert (region.x, region.y, region.width, region.height) == (
            expected["x"],
            expected["y"],
            expected["width"],
            expected["height"],
        )
        assert region.id == expected["id"]
        assert region.page == expected["page"]
    assert len(located.anchors) == len(want["anchors"])


@pytest.mark.parametrize("case", _GOLDEN["placeField"], ids=lambda c: str(c["corner"]))
def test_place_field_matches_the_typescript(case: dict[str, Any]) -> None:
    box = place_field(
        ScanmateRect(x=100, y=200, width=60, height=10),
        FieldOffset(dx=5, dy=-3, width=80, height=14),
        case["corner"],
    )

    assert (box.x, box.y, box.width, box.height) == (
        case["box"]["x"],
        case["box"]["y"],
        case["box"]["width"],
        case["box"]["height"],
    )


class TestHowRunsAreJoined:
    def test_a_label_split_across_two_runs_on_one_line(self) -> None:
        assert len(locate_anchor(_runs("splitAcrossRuns"), "Signature of U.S. person")) == 1

    def test_a_label_wrapped_onto_the_next_line(self) -> None:
        assert len(locate_anchor(_runs("wrapped"), "Signature of U.S. person")) == 1

    def test_a_paragraph_further_down_is_not_a_continuation(self) -> None:
        assert locate_anchor(_runs("farBelow"), "Signature of U.S. person") == []

    def test_two_columns_are_not_two_halves_of_one_label(self) -> None:
        # Further apart than MAX_WORD_GAP line heights: a label and the next
        # one across, not one label.
        assert locate_anchor(_runs("twoColumns"), "Signature of U.S. person") == []

    def test_a_quarter_turned_run_reads_down_the_page(self) -> None:
        assert len(locate_anchor(_runs("rotated"), "Signature")) == 1


class TestHowWordsAreMatched:
    def test_edge_punctuation_is_set_aside(self) -> None:
        assert len(locate_anchor(_runs("punctuation"), "Date")) == 1

    def test_never_inside_a_word(self) -> None:
        # "Date" must not find "Update", so matching is by whole words.
        assert locate_anchor(_runs("punctuation"), "Updat") == []

    def test_an_empty_anchor_finds_nothing(self) -> None:
        assert locate_anchor(_runs("simple"), "") == []

    def test_matches_come_back_in_reading_order(self) -> None:
        matches = locate_anchor(_runs("twice"), "Signature")

        assert [m.box.y for m in matches] == sorted(m.box.y for m in matches)


class TestWhenTheBoxIsEstimated:
    def test_an_anchor_inside_a_longer_run_is_estimated(self) -> None:
        # A run's words are not measured one by one, so an edge falling inside
        # a run is placed in proportion to its characters - close, but said to
        # be an estimate rather than reported as exact.
        match = locate_anchor(_runs("insideARun"), "Signature")[0]

        assert match.estimated is True

    def test_an_anchor_filling_its_run_is_not(self) -> None:
        assert locate_anchor(_runs("simple"), "Signature")[0].estimated is False

    def test_padding_spaces_do_not_make_it_an_estimate(self) -> None:
        # The run's printed characters start past the padding, so an anchor
        # that spans them all still gets the run's own box.
        assert locate_anchor(_runs("padded"), "Signature")[0].estimated is False


class TestWhatGoesWrong:
    def test_an_ambiguous_anchor_places_nothing(self) -> None:
        page = LocatablePage(page=1, width=612, height=792, text_items=_runs("twice"))
        spec = FieldSpec(
            anchor="Signature", fields={"sig": FieldOffset(dx=0, dy=0, width=10, height=10)}
        )
        located = resolve_fields([page], [spec])

        assert located.regions == []
        assert [p.kind for p in located.problems] == ["anchor-ambiguous"]
        assert located.problems[0].occurrences == 2

    def test_an_occurrence_can_be_named(self) -> None:
        page = LocatablePage(page=1, width=612, height=792, text_items=_runs("twice"))
        spec = FieldSpec(
            anchor="Signature",
            occurrence=2,
            fields={"sig": FieldOffset(dx=0, dy=0, width=10, height=10)},
        )
        located = resolve_fields([page], [spec])

        assert located.problems == []
        assert located.regions[0].y == 300

    def test_a_field_off_its_page_is_reported_but_still_placed(self) -> None:
        # Placed, because seeing where it landed is how the mistake gets found.
        page = LocatablePage(page=1, width=612, height=792, text_items=_runs("simple"))
        spec = FieldSpec(
            anchor="Signature", fields={"sig": FieldOffset(dx=0, dy=0, width=2000, height=10)}
        )
        located = resolve_fields([page], [spec])

        assert len(located.regions) == 1
        assert [p.kind for p in located.problems] == ["off-page"]

    def test_two_fields_covering_the_same_ground_are_reported(self) -> None:
        page = LocatablePage(page=1, width=612, height=792, text_items=_runs("simple"))
        spec = FieldSpec(
            anchor="Signature",
            fields={
                "a": FieldOffset(dx=0, dy=20, width=40, height=20),
                "b": FieldOffset(dx=20, dy=30, width=40, height=20),
            },
        )
        located = resolve_fields([page], [spec])

        assert [p.kind for p in located.problems] == ["overlap"]
        assert located.problems[0].ids == ("a", "b")

    def test_an_id_used_twice_is_refused_the_second_time(self) -> None:
        page = LocatablePage(page=1, width=612, height=792, text_items=_runs("simple"))
        specs = [
            FieldSpec(
                anchor="Signature", fields={"sig": FieldOffset(dx=0, dy=20, width=10, height=10)}
            ),
            FieldSpec(
                anchor="Printed name",
                fields={"sig": FieldOffset(dx=0, dy=20, width=10, height=10)},
            ),
        ]
        located = resolve_fields([page], specs)

        assert len(located.regions) == 1
        assert [p.kind for p in located.problems] == ["duplicate-id"]
