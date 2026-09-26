"""JavaScript's ``Date.UTC``, which is not ``datetime(...)``.

Three behaviours the PDF date mapper depends on, none of which a ``datetime``
constructor has:

1. **Two-digit years are 1900-based.** ``Date.UTC(20, 0, 1)`` is 1920, not the
   year 20. ``/M`` is matched with ``\\d{4}``, so a PDF writing ``D:0020...``
   means the year 20 and JavaScript reads 1920 - and the port has to agree,
   because that value is compared against a certificate's validity window.
2. **Out-of-range parts roll over.** ``Date.UTC(2026, 12, 1)`` is January 2027,
   and month ``00`` in a PDF date becomes ``-1``, which rolls *back* to the
   previous December. ``datetime`` raises for both.
3. **Beyond ±8.64e15 ms the result is NaN**, which the mapper turns into
   ``None`` rather than a date nobody meant.
"""

from __future__ import annotations

#: The largest absolute time value a JavaScript Date represents. Past it, every
#: Date operation yields NaN - 100 million days either side of the epoch.
MAX_TIME_MS = 8_640_000_000_000_000


def _days_from_civil(year: int, month: int, day: int) -> int:
    """Days between 1970-01-01 and a proleptic-Gregorian date, which may be negative.

    :param year: The full year.
    :param month: The month, 1-12, already normalised by the caller.
    :param day: The day of the month, which may be out of range and roll over.
    :returns: The day count, negative before the epoch.
    """
    y = year - (1 if month <= 2 else 0)
    # Plain floor division, NOT the `y < 0 ? y - 399 : y` the algorithm is
    # usually written with. That shift exists to make C++'s division, which
    # truncates toward zero, behave like a floor; Python's `//` already floors,
    # so keeping the shift subtracts an extra era below year 0. Measured: it
    # put -271821-04-20 one day out, which is exactly the earliest instant a
    # JavaScript Date represents - so the error surfaced only at the boundary
    # where the mapper decides between a date and None.
    era = y // 400
    year_of_era = y - era * 400
    day_of_year = (153 * (month + (-3 if month > 2 else 9)) + 2) // 5 + day - 1
    day_of_era = year_of_era * 365 + year_of_era // 4 - year_of_era // 100 + day_of_year

    return era * 146_097 + day_of_era - 719_468


def js_date_utc(
    year: int,
    month: int,
    day: int,
    hour: int,
    minute: int,
    second: int,
) -> float | None:
    """Milliseconds since the epoch, exactly as ``Date.UTC`` computes them.

    :param year: The year, remapped to ``1900 + year`` when it is 0-99.
    :param month: The month as JavaScript takes it - **zero-based**, and free
        to sit outside 0-11, in which case it rolls into the year.
    :param day: The day of the month, one-based, free to roll over.
    :param hour: The hour.
    :param minute: The minute.
    :param second: The second.
    :returns: The timestamp, or ``None`` where JavaScript yields ``NaN``.
    """
    full_year = year + 1900 if 0 <= year <= 99 else year

    # The month carries the rollover into the year, which is why it is done
    # here rather than validated away: `month` is already `written - 1`, so a
    # PDF month of `00` arrives as -1 and must land in the previous December.
    months = full_year * 12 + month
    normalised_year = months // 12
    normalised_month = months % 12

    days = _days_from_civil(normalised_year, normalised_month + 1, day)
    milliseconds = (
        days * 86_400_000 + hour * 3_600_000 + minute * 60_000 + second * 1_000
    )

    return None if abs(milliseconds) > MAX_TIME_MS else float(milliseconds)
