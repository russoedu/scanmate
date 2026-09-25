"""``D:20260921143000+01'00'`` - a PDF date, or ``None`` when it is missing or malformed."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from .js_date_utc_algorithm import MAX_TIME_MS, js_date_utc

#: Deliberately not anchored at the end, matching the TypeScript: a PDF date
#: may carry trailing characters, and everything after the offset is ignored
#: rather than making the whole value unreadable.
_PDF_DATE = re.compile(
    r"^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([+\-Z])(\d{2})'?(\d{2})?)?"
)

#: JavaScript's ``String.prototype.trim`` over the code points a latin-1 decode
#: produces. Python's ``str.strip()`` also removes ``\x1c``-``\x1f`` and
#: ``\x85``, none of which JavaScript trims, so a ``/M`` padded with one of
#: those parses in a port using ``strip()`` and does not in the TypeScript.
_TRIM = "\t\n\v\f\r \xa0"


def pdf_date(written: str | None) -> datetime | None:
    """Read a PDF date string.

    :param written: The value of ``/M``, as the file holds it.
    :returns: The instant in UTC, or ``None`` when there is nothing readable
        there. Every component after the year is optional and defaults to the
        start of its range, so ``D:2026`` is midnight on 1 January 2026 - which
        is a date the file did not quite say, and is what the TypeScript
        returns.
    """
    if written is None:
        return None
    parts = _PDF_DATE.match(written.strip(_TRIM))
    if parts is None:
        return None

    year, month, day, hour, minute, second, sign, offset_hours, offset_minutes = (
        parts.groups()
    )
    utc = js_date_utc(
        int(year),
        int(month if month is not None else "01") - 1,
        int(day if day is not None else "01"),
        int(hour if hour is not None else "00"),
        int(minute if minute is not None else "00"),
        int(second if second is not None else "00"),
    )
    if utc is None:
        return None

    offset = (
        0
        if sign is None or sign == "Z"
        else (
            int(offset_hours if offset_hours is not None else "00") * 60
            + int(offset_minutes if offset_minutes is not None else "00")
        )
        * (-1 if sign == "-" else 1)
    )

    # Checked a SECOND time, because `new Date(value)` clips independently of
    # `Date.UTC`: a date inside the range whose offset carries it outside is
    # NaN there, and must be None here.
    milliseconds = utc - offset * 60_000
    if abs(milliseconds) > MAX_TIME_MS:
        return None

    return datetime.fromtimestamp(0, UTC) + timedelta(milliseconds=milliseconds)
