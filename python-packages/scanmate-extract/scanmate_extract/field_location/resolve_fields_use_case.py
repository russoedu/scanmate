"""Field regions placed from the labels a document prints, instead of at fixed coordinates.

A generated document's fields move with its content - one more line in an
address pushes the signature block down, sometimes onto the next page. What does
not move is a field's place beside its label. So each field is an offset from an
anchor, and the anchor is found in the text layer, which says exactly where it
landed.

Pure: it takes the pages' text, so it can run on text already extracted.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from scanmate_ink import PageRegion, ScanmateRect

from .field_location_contract import (
    AnchorCorner,
    FieldOffset,
    FieldSpec,
    LocatablePage,
    LocatedAnchor,
    LocatedFields,
    LocateOptions,
    LocationProblem,
)
from .locate_anchor_algorithm import locate_anchor


def resolve_fields(
    pages: Sequence[LocatablePage],
    specs: Sequence[FieldSpec],
    options: LocateOptions | None = None,
) -> LocatedFields:
    """Place every spec's fields from the anchor it names.

    :param pages: The pages' text and sizes.
    :param specs: The anchors and the fields measured from them.
    :param options: Normalisation and line tolerances.
    :returns: The regions, the anchors, and everything wrong.
    """
    settings = options if options is not None else LocateOptions()
    regions: list[PageRegion] = []
    anchors: list[LocatedAnchor] = []
    problems: list[LocationProblem] = []
    ids: set[str] = set()
    ordered = sorted(pages, key=lambda p: p.page)

    for spec in specs:
        searched = ordered if spec.page is None else [p for p in ordered if p.page == spec.page]
        found: list[LocatedAnchor] = []
        for page in searched:
            for match in locate_anchor(page.text_items, spec.anchor, settings):
                found.append(
                    LocatedAnchor(
                        box=match.box,
                        estimated=match.estimated,
                        anchor=spec.anchor,
                        page=page.page,
                    )
                )

        chosen = _choose(found, spec.occurrence)
        if chosen is None:
            problems.append(_problem_for(spec.anchor, spec.occurrence, len(found)))
            continue

        anchors.append(chosen)
        bounds = next((p for p in ordered if p.page == chosen.page), None)
        for identifier, offset in spec.fields.items():
            if identifier in ids:
                problems.append(LocationProblem(kind="duplicate-id", id=identifier))
                continue
            ids.add(identifier)

            placed = place_field(chosen.box, offset, spec.from_corner)
            region = PageRegion(
                x=placed.x,
                y=placed.y,
                width=placed.width,
                height=placed.height,
                page=chosen.page,
                id=identifier,
            )
            regions.append(region)
            wrong = None if bounds is None else _check_region(region, bounds)
            if wrong is not None:
                problems.append(wrong)

    problems.extend(_overlaps(regions))

    return LocatedFields(regions=regions, anchors=anchors, problems=problems)


def place_field(
    anchor: ScanmateRect, offset: FieldOffset, from_corner: AnchorCorner = "top-left"
) -> ScanmateRect:
    """A field's box, placed from one corner of its anchor.

    :param anchor: The anchor's box.
    :param offset: Where the field sits relative to that corner.
    :param from_corner: Which corner to measure from.
    :returns: The field's box.
    """
    right = from_corner.endswith("right")
    bottom = from_corner.startswith("bottom")

    return ScanmateRect(
        x=(anchor.x + anchor.width if right else anchor.x) + offset.dx,
        y=(anchor.y + anchor.height if bottom else anchor.y) + offset.dy,
        width=offset.width,
        height=offset.height,
    )


def _choose(found: Sequence[LocatedAnchor], occurrence: str | int) -> LocatedAnchor | None:
    """Pick the occurrence a spec asked for, if it is there."""
    if occurrence == "unique":
        return found[0] if len(found) == 1 else None

    if not isinstance(occurrence, int) or isinstance(occurrence, bool) or occurrence < 1:
        return None

    return found[occurrence - 1] if occurrence <= len(found) else None


def _problem_for(anchor: str, occurrence: str | int, occurrences: int) -> LocationProblem:
    """Say which way the anchor failed."""
    if occurrences == 0:
        return LocationProblem(kind="anchor-missing", anchor=anchor)
    if occurrence == "unique":
        return LocationProblem(
            kind="anchor-ambiguous", anchor=anchor, occurrences=occurrences
        )

    return LocationProblem(
        kind="occurrence-missing",
        anchor=anchor,
        occurrence=occurrence if isinstance(occurrence, int) else None,
        occurrences=occurrences,
    )


def _check_region(region: PageRegion, page: LocatablePage) -> LocationProblem | None:
    """What makes one region unusable on its own: not a number, or not on its page."""
    values = (region.x, region.y, region.width, region.height)
    if any(not math.isfinite(v) for v in values) or region.width <= 0 or region.height <= 0:
        return LocationProblem(kind="not-finite", id=region.id, page=region.page)
    if (
        region.x < 0
        or region.y < 0
        or region.x + region.width > page.width
        or region.y + region.height > page.height
    ):
        return LocationProblem(kind="off-page", id=region.id, page=region.page)

    return None


def _overlaps(regions: Sequence[PageRegion]) -> list[LocationProblem]:
    """Every two regions on one page that cover some of the same ground."""
    found: list[LocationProblem] = []
    for i, a in enumerate(regions):
        for b in regions[i + 1 :]:
            if (
                a.page == b.page
                and a.x < b.x + b.width
                and a.x + a.width > b.x
                and a.y < b.y + b.height
                and a.y + a.height > b.y
            ):
                found.append(
                    LocationProblem(
                        kind="overlap",
                        ids=(a.id or "", b.id or ""),
                        page=a.page,
                    )
                )

    return found
