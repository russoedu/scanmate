"""Turn a caller's page selection into page numbers.

Accepts either a list of one-based page numbers or a print-dialog range string
such as ``"1-3,5,8-"`` (an open range runs to the last page). The result is
sorted and free of repeats, and anything outside the document is an error rather
than something quietly dropped - asking for page 9 of an 8-page scan is exactly
the mistake this pipeline exists to catch.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import TypeAlias

#: A list of one-based page numbers, or a print-dialog range string.
PageSelection: TypeAlias = "Sequence[int] | str"

_DIGITS = re.compile(r"^\d+$")


def select_pages(selection: PageSelection | None, page_count: int) -> list[int]:
    """Resolve a selection to sorted, unique page numbers.

    :param selection: A list of page numbers, a range string, or ``None`` for
        every page.
    :param page_count: How many pages the document has.
    :returns: The selected pages, sorted, without repeats.
    :raises ValueError: A page lies outside the document, or a range cannot be
        read.
    """
    if selection is None:
        return list(range(1, page_count + 1))

    pages = (
        _parse_ranges(selection, page_count)
        if isinstance(selection, str)
        else list(selection)
    )
    for page in pages:
        if not _is_safe_integer(page) or page < 1 or page > page_count:
            raise ValueError(
                f"page {_as_js_number(page)} is outside a {page_count}-page document"
            )

    return sorted(set(pages))


def _parse_ranges(spec: str, page_count: int) -> list[int]:
    """Expand ``"1-3,5,8-"`` into page numbers."""
    parts = [part.strip() for part in spec.split(",")]
    pages: list[int] = []
    for part in parts:
        if len(part) == 0:
            continue
        low, high = _bounds(part, page_count)
        pages.extend(range(low, high + 1))

    return pages


def _is_bound(text: str, may_be_empty: bool) -> bool:
    """A page number, or - on one side of a dash - nothing at all."""
    return (may_be_empty and text == "") or _DIGITS.match(text) is not None


def _bounds(part: str, page_count: int) -> tuple[int, int]:
    """``"3"``, ``"2-5"``, ``"6-"`` or ``"-4"`` as an inclusive ``(from, to)``.

    :param part: One comma-separated piece of the selection.
    :param page_count: How many pages the document has.
    :returns: The inclusive bounds.
    :raises SyntaxError: The part is not a range, or runs backwards.
    """
    dash = part.find("-")
    low = (part if dash == -1 else part[:dash]).strip()
    high = (part if dash == -1 else part[dash + 1 :]).strip()
    if (
        not _is_bound(low, dash != -1)
        or not _is_bound(high, dash != -1)
        or (low == "" and high == "")
    ):
        raise SyntaxError(f'cannot read page range "{part}"')

    start = 1 if low == "" else int(low)
    end = page_count if high == "" else int(high)
    if end < start:
        raise SyntaxError(f'page range "{part}" runs backwards')

    return start, end


def _is_safe_integer(value: object) -> bool:
    """JavaScript's ``Number.isSafeInteger``.

    A ``bool`` is excluded deliberately: Python's ``bool`` is an ``int``, so
    ``select_pages([True], 5)`` would otherwise mean page 1, which the
    TypeScript cannot express and nobody means.
    """
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and abs(value) <= 2**53 - 1
    )


def _as_js_number(value: object) -> str:
    """Format a number the way JavaScript puts one in a message."""
    if isinstance(value, float) and value == int(value):
        return str(int(value))

    return str(value)
