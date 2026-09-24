"""A named rectangle on a named page of the original: where a field is.

In points, from the top-left of the page as displayed - the coordinates the
extractor reports text in, with the page's rotation and crop box already
applied.

One shape for the whole journey a field makes: located from its label by the
extractor, drawn on the original by the merger to be checked by eye, and
measured as an expected change by the pixel comparison and the audit. Each
hands it to the next as it is, so there is nothing to convert between them and
no place for a field to move on the way.

A region may carry its own bleed - ``bleed``, or a side of it - which wins over
the bleed the comparison or the marking was given. A signature box can ask for
twenty points below while the date beside it keeps the default.

WHY IT INHERITS FROM BOTH
-------------------------

The TypeScript writes ``interface PageRegion extends ScanmateRect, Bleed``, and
this does the same, so that a region can be handed straight to
:func:`~..region_bleed.resolve_region_bleed` without being taken apart first.
Making it a flat dataclass listing all eleven fields would have been simpler to
write and would have broken that: the resolver would no longer be able to say
it takes a bleed.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..plane_geometry import ScanmateRect
from ..region_bleed import Bleed


# `kw_only` because the bases interleave required and defaulted fields, and
# positional order across a diamond of dataclasses is not something a caller
# should have to know.
@dataclass(frozen=True, kw_only=True)
class PageRegion(Bleed, ScanmateRect):
    """Where one named field is, on one page."""

    #: One-based page number in the original.
    page: int
    #: What the field is - ``"signature"``, ``"date"`` - unique among the
    #: regions of one document.
    id: str
