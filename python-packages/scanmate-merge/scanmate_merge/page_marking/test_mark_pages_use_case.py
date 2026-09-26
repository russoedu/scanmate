"""Marking, held to the TypeScript's decisions: what was drawn, and what was wrong.

The drawn appearance is not comparable between two PDF writers. The count and
the warnings are the package's actual contract, and the geometry behind them is
pinned separately in ``test_page_viewport_mapper``.
"""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

import pytest
from pypdf import PdfReader

from .mark_pages_use_case import mark_pages
from .page_mark_contract import MarkOptions, PageMark

_ROOT = Path(__file__).parents[4]
_PDF = (_ROOT / "tools" / "parity" / "fixtures" / "seal" / "plain.pdf").read_bytes()
#: A4, so a page whose displayed size does NOT round to itself is covered.
_A4 = (_ROOT / "tools" / "parity" / "fixtures" / "merge" / "a4.pdf").read_bytes()
_GOLDEN: dict[str, Any] = json.loads(
    (_ROOT / "tools" / "parity" / "goldens" / "merge-page-marking.json").read_text(
        encoding="utf-8"
    )
)["cases"]


def _cases() -> dict[str, tuple[list[PageMark], MarkOptions]]:
    """The same cases the golden was generated from."""
    return {
        "one-mark": (
            [PageMark(page=1, x=20, y=30, width=60, height=20, id="sig")],
            MarkOptions(),
        ),
        "no-id-is-numbered": (
            [PageMark(page=9, x=0, y=0, width=10, height=10)],
            MarkOptions(),
        ),
        "past-the-end": (
            [PageMark(page=5, x=0, y=0, width=10, height=10, id="missing")],
            MarkOptions(),
        ),
        "page-zero": (
            [PageMark(page=0, x=0, y=0, width=10, height=10, id="zero")],
            MarkOptions(),
        ),
        "overflows-its-page": (
            [PageMark(page=1, x=150, y=150, width=100, height=100, id="over")],
            MarkOptions(),
        ),
        "negative-origin": (
            [PageMark(page=1, x=-5, y=10, width=10, height=10, id="neg")],
            MarkOptions(),
        ),
        "exactly-to-the-edge": (
            [PageMark(page=1, x=100, y=100, width=100, height=100, id="edge")],
            MarkOptions(),
        ),
        "several": (
            [
                PageMark(page=1, x=10, y=10, width=20, height=20, id="a"),
                PageMark(page=3, x=10, y=10, width=20, height=20, id="b"),
                PageMark(page=1, x=40, y=40, width=20, height=20, id="c"),
            ],
            MarkOptions(),
        ),
        "labels-off": (
            [PageMark(page=1, x=20, y=30, width=60, height=20, id="sig")],
            MarkOptions(labels=False),
        ),
        "own-bleed": (
            [PageMark(page=1, x=20, y=30, width=60, height=20, id="sig", bleed_bottom=20)],
            MarkOptions(),
        ),
        "no-bleed-at-all": (
            [PageMark(page=1, x=20, y=30, width=60, height=20, id="sig")],
            MarkOptions(bleed=0),
        ),
    }


#: The two cases drawn on the A4 fixture rather than the 200 x 200 one.
_ON_A4 = {
    "a4-overflow": [PageMark(page=1, x=500, y=700, width=200, height=300, id="over")],
    "a4-inside": [PageMark(page=1, x=100, y=100, width=50, height=50, id="in")],
}


@pytest.mark.parametrize("name", sorted(_GOLDEN))
def test_matches_the_typescript(name: str) -> None:
    if name in _ON_A4:
        result = mark_pages(_A4, _ON_A4[name], MarkOptions())
        assert result.drawn == _GOLDEN[name]["drawn"]
        assert result.warnings == _GOLDEN[name]["warnings"]

        return

    marks, options = _cases()[name]
    result = mark_pages(_PDF, marks, options)

    assert result.drawn == _GOLDEN[name]["drawn"]
    # The warnings are user-facing sentences, compared verbatim: they name the
    # mark, the page and the page's size, and a reviewer acts on the wording.
    assert result.warnings == _GOLDEN[name]["warnings"]


class TestWhatItWarnsAbout:
    def test_a_mark_on_a_page_that_does_not_exist_is_not_drawn(self) -> None:
        result = mark_pages(
            _PDF,
            [PageMark(page=5, x=0, y=0, width=10, height=10, id="missing")],
            MarkOptions(),
        )

        assert result.drawn == 0
        assert "missing is on page 5" in result.warnings[0]

    def test_a_mark_past_the_edge_is_drawn_anyway_and_flagged(self) -> None:
        # Drawn, because seeing where it landed is the point - this is a tool
        # for finding exactly this mistake, and a mark it silently dropped
        # would be a mistake it hid.
        result = mark_pages(
            _PDF,
            [PageMark(page=1, x=150, y=150, width=100, height=100, id="over")],
            MarkOptions(),
        )

        assert result.drawn == 1
        assert len(result.warnings) == 1

    def test_a_mark_reaching_exactly_to_the_edge_is_not_a_warning(self) -> None:
        result = mark_pages(
            _PDF,
            [PageMark(page=1, x=100, y=100, width=100, height=100, id="edge")],
            MarkOptions(),
        )

        assert result.warnings == []

    def test_the_page_size_in_the_warning_is_rounded_to_one_decimal(self) -> None:
        # A4 is 595.28 x 841.89 and the warning says 595.3 x 841.9. Every other
        # fixture page is exactly 200 x 200, where rounding is a no-op - so
        # without this a port that skipped it entirely passed.
        result = mark_pages(_A4, _ON_A4["a4-overflow"], MarkOptions())

        assert result.warnings == ["over reaches past the edge of page 1, "
                                   "which is 595.3 x 841.9 pt"]

    def test_an_unnamed_mark_is_numbered_by_its_position(self) -> None:
        result = mark_pages(
            _PDF, [PageMark(page=9, x=0, y=0, width=10, height=10)], MarkOptions()
        )

        assert result.warnings[0].startswith("mark 1 ")


class TestThePdfItProduces:
    def test_it_is_readable_and_keeps_its_pages(self) -> None:
        result = mark_pages(
            _PDF,
            [PageMark(page=1, x=20, y=30, width=60, height=20, id="sig")],
            MarkOptions(),
        )

        assert len(PdfReader(io.BytesIO(result.pdf)).pages) == 1

    def test_a_label_registers_a_font_and_no_label_does_not(self) -> None:
        mark = PageMark(page=1, x=20, y=30, width=60, height=20, id="sig")
        marked = mark_pages(_PDF, [mark], MarkOptions())
        plain = mark_pages(_PDF, [mark], MarkOptions(labels=False))

        assert "/F-scanmate-label" in str(
            PdfReader(io.BytesIO(marked.pdf)).pages[0]["/Resources"]
        )
        assert "/F-scanmate-label" not in str(
            PdfReader(io.BytesIO(plain.pdf)).pages[0].get("/Resources", "")
        )

    def test_the_documents_own_content_is_kept(self) -> None:
        # Marks are ADDED to the page, never instead of it. A helper that
        # replaced the content would draw perfect boxes on a blank page.
        result = mark_pages(
            _PDF,
            [PageMark(page=1, x=20, y=30, width=60, height=20, id="sig")],
            MarkOptions(),
        )
        page = PdfReader(io.BytesIO(result.pdf)).pages[0]

        contents = page.get_contents()
        assert contents is not None
        assert b"re S" in contents.get_data()


def test_it_refuses_anything_that_is_not_a_pdf() -> None:
    with pytest.raises(TypeError, match="marks are drawn on a PDF"):
        mark_pages(bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), [], MarkOptions())
