"""``/M``, read the way the TypeScript reads it.

Cross-checked against the real ``pdf-date.mapper.ts`` over 3000 generated
strings; the cases kept here are the ones that say something.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from .pdf_date_mapper import pdf_date


class TestWhatItReads:
    def test_a_full_pdf_date_in_utc(self) -> None:
        assert pdf_date("D:20260922120000Z") == datetime(2026, 9, 22, 12, 0, 0, tzinfo=UTC)

    @pytest.mark.parametrize(
        ("written", "expected"),
        [
            ("D:20260921143000+01'00'", datetime(2026, 9, 21, 13, 30, tzinfo=UTC)),
            ("D:20260921143000-05'30'", datetime(2026, 9, 21, 20, 0, tzinfo=UTC)),
            # The apostrophes are optional, and some writers omit them.
            ("D:20260921143000+0100", datetime(2026, 9, 21, 13, 30, tzinfo=UTC)),
        ],
    )
    def test_an_offset_is_applied_in_the_right_direction(
        self, written: str, expected: datetime
    ) -> None:
        # Easy to get backwards: +01'00' means local time is an hour AHEAD of
        # UTC, so the UTC instant is an hour EARLIER than what is written.
        assert pdf_date(written) == expected

    @pytest.mark.parametrize(
        ("written", "expected"),
        [
            ("D:2026", datetime(2026, 1, 1, tzinfo=UTC)),
            ("D:202609", datetime(2026, 9, 1, tzinfo=UTC)),
            ("D:20260921", datetime(2026, 9, 21, tzinfo=UTC)),
            ("D:202609211430", datetime(2026, 9, 21, 14, 30, tzinfo=UTC)),
        ],
    )
    def test_every_part_after_the_year_defaults(self, written: str, expected: datetime) -> None:
        # Worth stating plainly: `D:2026` becomes midnight on 1 January, a date
        # the file did not quite claim. It is what the TypeScript returns, and
        # downstream it is compared against a certificate's validity window.
        assert pdf_date(written) == expected

    def test_trailing_characters_are_ignored_rather_than_fatal(self) -> None:
        assert pdf_date("D:20260922120000Xnonsense") == datetime(2026, 9, 22, 12, 0, tzinfo=UTC)

    def test_surrounding_whitespace_is_trimmed(self) -> None:
        assert pdf_date("  D:2026  ") == datetime(2026, 1, 1, tzinfo=UTC)


class TestWhatItRefuses:
    @pytest.mark.parametrize("written", [None, "", "not a date", "D:", "20260922", "D:202"])
    def test_anything_unreadable_is_none(self, written: str | None) -> None:
        assert pdf_date(written) is None


class TestTheJavaScriptSemantics:
    """Where a reasonable Python implementation would quietly disagree."""

    def test_a_two_digit_year_is_1900_based(self) -> None:
        # `D:00200101...` is the year 20 as written, and 1920 as read - by
        # JavaScript, and therefore here.
        assert pdf_date("D:00200101000000Z") == datetime(1920, 1, 1, tzinfo=UTC)

    def test_a_thirteenth_month_rolls_into_the_next_year(self) -> None:
        # `datetime` raises; JavaScript rolls. A malformed month must produce
        # the same instant in both ports, not an exception in one of them.
        assert pdf_date("D:20261301000000Z") == datetime(2027, 1, 1, tzinfo=UTC)

    def test_a_zero_month_rolls_back_into_the_previous_year(self) -> None:
        assert pdf_date("D:20260000000000Z") == datetime(2025, 11, 30, tzinfo=UTC)

    def test_a_no_break_space_is_trimmed_and_the_other_controls_are_not(self) -> None:
        # Python's str.strip() removes \x1c-\x1f and \x85; JavaScript's trim
        # does not, and does remove \xa0. A /M padded with one of those parses
        # differently in a port that reaches for strip().
        assert pdf_date("\xa0D:2026\xa0") == datetime(2026, 1, 1, tzinfo=UTC)
        assert pdf_date("\x85D:2026") is None
