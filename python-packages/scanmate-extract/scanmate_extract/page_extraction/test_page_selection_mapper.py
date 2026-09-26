"""Page selection, held to the TypeScript exactly."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from .page_selection_mapper import select_pages

_GOLDEN: dict[str, Any] = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "extract-decisions.json"
    ).read_text(encoding="utf-8")
)


@pytest.mark.parametrize("name", sorted(_GOLDEN["selectPages"]))
def test_matches_the_typescript(name: str) -> None:
    case = _GOLDEN["selectPages"][name]

    assert select_pages(case["selection"], case["pageCount"]) == case["pages"]


@pytest.mark.parametrize("name", sorted(_GOLDEN["selectPagesRejects"]))
def test_refuses_what_the_typescript_refuses(name: str) -> None:
    """The message too: it names the page and the document's length."""
    case = _GOLDEN["selectPagesRejects"][name]

    with pytest.raises((ValueError, SyntaxError)) as raised:
        select_pages(case["selection"], case["pageCount"])

    assert str(raised.value) == case["message"]


class TestWhatTheRangeSyntaxMeans:
    def test_none_is_every_page(self) -> None:
        assert select_pages(None, 3) == [1, 2, 3]

    def test_an_empty_string_selects_nothing(self) -> None:
        # Not "every page", and not an error either - it has no parts at all.
        # Surprising enough that it is worth saying out loud.
        assert select_pages("", 8) == []

    def test_an_open_end_runs_to_the_last_page(self) -> None:
        assert select_pages("3-", 5) == [3, 4, 5]

    def test_an_open_start_runs_from_the_first(self) -> None:
        assert select_pages("-2", 5) == [1, 2]

    def test_a_bare_dash_names_neither_end_and_is_refused(self) -> None:
        # It is NOT read as "all". Both ends empty is unreadable rather than
        # generous, because guessing here would silently widen an audit.
        with pytest.raises(SyntaxError, match="cannot read page range"):
            select_pages("-", 8)

    def test_the_result_is_sorted_and_free_of_repeats(self) -> None:
        assert select_pages([3, 1, 3, 2, 1], 5) == [1, 2, 3]

    def test_a_backwards_range_is_refused(self) -> None:
        with pytest.raises(SyntaxError, match="runs backwards"):
            select_pages("4-2", 8)


class TestWhatIsOutsideTheDocument:
    @pytest.mark.parametrize("selection", [[9], [0], [-1]])
    def test_a_page_outside_the_document_is_an_error(self, selection: list[int]) -> None:
        # Asking for page 9 of an 8-page scan is exactly the mistake this
        # pipeline exists to catch, so it is never quietly dropped.
        with pytest.raises(ValueError, match="is outside a 8-page document"):
            select_pages(selection, 8)

    def test_a_fraction_is_not_a_page(self) -> None:
        with pytest.raises(ValueError):
            select_pages([1.5], 8)  # type: ignore[list-item]

    def test_a_boolean_is_not_a_page(self) -> None:
        # Python's bool IS an int, so True would otherwise mean page 1 - which
        # the TypeScript cannot express and nobody means.
        with pytest.raises(ValueError):
            select_pages([True], 8)
