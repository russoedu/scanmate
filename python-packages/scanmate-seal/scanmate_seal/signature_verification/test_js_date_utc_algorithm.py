"""``Date.UTC``, pinned case by case.

Checked against Node, including a 5000-case fuzz over negative years and both
ends of the representable range. What is kept here is the behaviour a reader
would not predict from a ``datetime`` constructor.
"""

from __future__ import annotations

import pytest

from .js_date_utc_algorithm import MAX_TIME_MS, js_date_utc

_DAY_MS = 86_400_000


class TestTwoDigitYears:
    """The rule that silently moves a date by 1900 years."""

    def test_a_year_under_100_is_1900_based(self) -> None:
        # `/M` is matched with \d{4}, so a PDF writing D:0020... means the year
        # 20 - and JavaScript reads 1920. That value is then compared against a
        # certificate's validity window, so the difference is a verdict.
        assert js_date_utc(20, 0, 1, 0, 0, 0) == js_date_utc(1920, 0, 1, 0, 0, 0)

    def test_the_boundary_is_100_not_99(self) -> None:
        assert js_date_utc(99, 0, 1, 0, 0, 0) == js_date_utc(1999, 0, 1, 0, 0, 0)
        # 100 is the year 100, not 2000.
        assert js_date_utc(100, 0, 1, 0, 0, 0) != js_date_utc(2000, 0, 1, 0, 0, 0)

    def test_year_zero_is_1900(self) -> None:
        assert js_date_utc(0, 0, 1, 0, 0, 0) == js_date_utc(1900, 0, 1, 0, 0, 0)


class TestRollover:
    """Out-of-range parts roll, where ``datetime`` raises."""

    def test_a_thirteenth_month_is_next_january(self) -> None:
        assert js_date_utc(2026, 12, 1, 0, 0, 0) == js_date_utc(2027, 0, 1, 0, 0, 0)

    def test_month_zero_in_a_pdf_rolls_back_a_year(self) -> None:
        # A PDF month of `00` arrives here as -1, because the caller has
        # already subtracted one. It must land in the previous December.
        assert js_date_utc(2026, -1, 1, 0, 0, 0) == js_date_utc(2025, 11, 1, 0, 0, 0)

    def test_day_zero_is_the_last_day_of_the_month_before(self) -> None:
        assert js_date_utc(2026, 1, 0, 0, 0, 0) == js_date_utc(2026, 0, 31, 0, 0, 0)

    def test_a_thirty_second_of_january_is_the_first_of_february(self) -> None:
        assert js_date_utc(2026, 0, 32, 0, 0, 0) == js_date_utc(2026, 1, 1, 0, 0, 0)

    def test_hours_minutes_and_seconds_roll_too(self) -> None:
        assert js_date_utc(2026, 0, 1, 24, 0, 0) == js_date_utc(2026, 0, 2, 0, 0, 0)
        assert js_date_utc(2026, 0, 1, 0, 60, 0) == js_date_utc(2026, 0, 1, 1, 0, 0)


class TestTheRepresentableRange:
    """Past ±8.64e15 ms every Date operation is NaN, which is ``None`` here."""

    def test_the_epoch_is_zero(self) -> None:
        assert js_date_utc(1970, 0, 1, 0, 0, 0) == 0.0

    def test_the_earliest_instant_is_representable(self) -> None:
        # The case that caught a real bug: the usual C++ spelling of this
        # algorithm shifts negative years by -399 so that TRUNCATING division
        # behaves like a floor. Python's // already floors, so keeping the
        # shift put this exact date one day out - and one day out here is the
        # difference between a date and None.
        assert js_date_utc(-271821, 3, 20, 0, 0, 0) == -float(MAX_TIME_MS)

    def test_the_latest_instant_is_representable(self) -> None:
        assert js_date_utc(275760, 8, 13, 0, 0, 0) == float(MAX_TIME_MS)

    @pytest.mark.parametrize(
        ("year", "month", "day"),
        [(-271821, 3, 19), (275760, 8, 14)],
    )
    def test_one_day_beyond_either_end_is_none(self, year: int, month: int, day: int) -> None:
        assert js_date_utc(year, month, day, 0, 0, 0) is None

    def test_a_day_inside_the_range_is_a_day(self) -> None:
        assert js_date_utc(1970, 0, 2, 0, 0, 0) == float(_DAY_MS)
