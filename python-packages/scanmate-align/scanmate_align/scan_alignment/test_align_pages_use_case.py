"""The multi-page wrapper.

No golden of its own, deliberately. It runs :func:`align_scan` once per page and
attaches the result, so a golden here would re-assert what
``test_align_scan_use_case`` already pins, for six times the runtime. What is
worth testing is the wrapper's own behaviour: the order, what survives the trip,
and the progress events - which are the only logging seam the pipeline has, and
therefore the only thing a caller can build monitoring on.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from scanmate_ink import (
    DocumentOptions,
    PageImage,
    ScanOptions,
    ScanPage,
    StageEvent,
    create_synthetic_document,
    simulate_scan,
)

from .align_pages_use_case import AlignPagesOptions, align_pages
from .align_result_contract import AlignOptions

_GOLDEN = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "align-scan-alignment.json"
    ).read_text(encoding="utf-8")
)

#: The same held-down options the scan goldens use, so this file costs seconds
#: rather than minutes.
_OPTIONS = AlignOptions(
    working_size=_GOLDEN["options"]["workingSize"],
    coarse_size=_GOLDEN["options"]["coarseSize"],
    max_features=_GOLDEN["options"]["maxFeatures"],
    output=_GOLDEN["options"]["output"],
)

_PAGE = create_synthetic_document(DocumentOptions(width=200, height=260, seed=42))


def _page(number: int, rotation: float) -> ScanPage:
    """One page pair, with a dpi on each side so the pass-through can be checked."""
    scanned = simulate_scan(_PAGE.raster, ScanOptions(rotation_deg=rotation, seed=31)).raster

    return ScanPage(
        page=number,
        original=PageImage(
            raster=_PAGE.raster,
            image=None,
            width=_PAGE.raster.width,
            height=_PAGE.raster.height,
            dpi=200,
        ),
        scanned=PageImage(
            raster=scanned,
            image=None,
            width=scanned.width,
            height=scanned.height,
            dpi=300,
        ),
    )


@pytest.fixture(scope="module")
def pages() -> list[ScanPage]:
    # Page numbers that are NOT 1..n, because `page` is the number in the
    # original document and `index` is the position in this run. A wrapper that
    # confused the two would pass against 1, 2, 3.
    return [_page(4, 0.9), _page(7, 1.4)]


@pytest.fixture(scope="module")
def aligned(pages: list[ScanPage]) -> list[Any]:
    return align_pages(pages, AlignPagesOptions(align=_OPTIONS))


class TestWhatComesBack:
    """One aligned page per input page, in order."""

    def test_one_result_per_page_in_order(self, pages: list[ScanPage], aligned: list[Any]) -> None:
        assert len(aligned) == len(pages)
        assert [p.page for p in aligned] == [p.page for p in pages]

    def test_every_page_carries_its_alignment(self, aligned: list[Any]) -> None:
        for page in aligned:
            assert page.aligned is not None
            assert page.aligned.method in {"features", "coarse"}
            # The promise of the package: the aligned pixels sit on the
            # original's canvas.
            assert page.aligned.width == _PAGE.raster.width
            assert page.aligned.height == _PAGE.raster.height

    def test_what_the_producer_attached_survives(
        self, pages: list[ScanPage], aligned: list[Any]
    ) -> None:
        # The whole reason the wrapper copies rather than rebuilds. A stage that
        # dropped the dpi each side was rendered at would put every downstream
        # measurement on a fabricated scale.
        for before, after in zip(pages, aligned, strict=True):
            assert after.original is before.original
            assert after.scanned is before.scanned
            assert after.original.dpi == 200
            assert after.scanned.dpi == 300

    def test_an_empty_list_is_not_an_error(self) -> None:
        assert align_pages([], AlignPagesOptions(align=_OPTIONS)) == []


class TestTheProgressSeam:
    """The only logging seam the pipeline has."""

    def test_it_reports_start_and_done_for_every_page(self, pages: list[ScanPage]) -> None:
        events: list[StageEvent] = []
        align_pages(pages, AlignPagesOptions(align=_OPTIONS, on_progress=events.append))

        assert [(e.phase, e.page) for e in events] == [
            ("start", 4),
            ("done", 4),
            ("start", 7),
            ("done", 7),
        ]
        assert all(e.stage == "align" for e in events)

    def test_index_counts_the_run_and_page_names_the_document(
        self, pages: list[ScanPage]
    ) -> None:
        # Two different numbers that a wrapper is easy to conflate: `index` is
        # one-based position in THIS run, `page` is the page number in the
        # original. The fixture uses pages 4 and 7 so they cannot coincide.
        events: list[StageEvent] = []
        align_pages(pages, AlignPagesOptions(align=_OPTIONS, on_progress=events.append))

        assert [e.index for e in events] == [1, 1, 2, 2]
        assert [e.page for e in events] == [4, 4, 7, 7]
        assert all(e.total == 2 for e in events)

    def test_only_the_done_event_carries_a_duration_and_a_detail(
        self, pages: list[ScanPage]
    ) -> None:
        events: list[StageEvent] = []
        align_pages(pages, AlignPagesOptions(align=_OPTIONS, on_progress=events.append))

        for event in events:
            if event.phase == "start":
                assert event.duration_ms is None
                assert event.detail is None
            else:
                assert event.duration_ms is not None
                assert event.duration_ms >= 0
                assert event.detail is not None
                assert set(event.detail) == {"confidence", "model", "method", "attempts"}

    def test_the_detail_describes_the_result_it_came_from(
        self, pages: list[ScanPage]
    ) -> None:
        # Otherwise the seam is decorative: a monitor reading `confidence` here
        # has to be reading the same number the caller gets back.
        events: list[StageEvent] = []
        results = align_pages(
            pages, AlignPagesOptions(align=_OPTIONS, on_progress=events.append)
        )
        done = [e for e in events if e.phase == "done"]

        for event, page in zip(done, results, strict=True):
            assert event.detail is not None
            assert event.detail["confidence"] == page.aligned.confidence
            assert event.detail["model"] == page.aligned.diagnostics.selected_model
            assert event.detail["method"] == page.aligned.method
            assert event.detail["attempts"] == len(page.aligned.diagnostics.attempts)

    def test_no_callback_is_fine(self, pages: list[ScanPage]) -> None:
        # The default. A wrapper that called `None` would fail here and nowhere
        # else, since every other test in this file passes one.
        assert len(align_pages(pages, AlignPagesOptions(align=_OPTIONS))) == 2


def test_the_options_hold_alignment_options_rather_than_extending_them() -> None:
    """The one shape that differs from the TypeScript, and why.

    ``AlignPagesOptions extends AlignOptions`` there, because a TypeScript
    interface widens for free. A frozen dataclass subclass would have to restate
    all twenty fields and keep them in step forever, so this composes instead:
    ``align`` holds them and ``on_progress`` sits beside it.

    Asserted rather than left to a comment, because it is the kind of difference
    a later reader would otherwise "fix".
    """
    options = AlignPagesOptions()
    assert isinstance(options.align, AlignOptions)
    assert options.on_progress is None
    assert not isinstance(options, AlignOptions)
