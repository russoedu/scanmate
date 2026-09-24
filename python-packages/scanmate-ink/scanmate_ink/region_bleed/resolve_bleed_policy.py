"""One rule for deciding a region's room, used everywhere it is decided.

So the region a reviewer is shown and the region the comparison actually
measures cannot drift apart. That is the whole reason this lives here rather
than beside each of them.
"""

from __future__ import annotations

import math

from ..plane_geometry import ScanmateRect
from .bleed_contract import Bleed, ResolvedBleed

#: The room around a region when nothing says otherwise.
#:
#: Six points, about two millimetres: enough for a pen that overshoots its
#: line, not so much that neighbouring fields start claiming each other's ink.
#: It was the uniform margin the pixel comparison used before a bleed could be
#: set per side, so leaving every bleed unset reproduces exactly what that did.
DEFAULT_BLEED = 6


def _as_js_number(value: float) -> str:
    """Spell a number the way JavaScript spells it, for the error message only.

    Python writes ``inf`` and ``nan`` where JavaScript writes ``Infinity`` and
    ``NaN``, and writes ``6.0`` where JavaScript writes ``6``. The message is
    part of the behaviour the goldens check, so it is spelled the same way.

    :param value: The offending value.
    :returns: Its JavaScript spelling.
    """
    if isinstance(value, float):
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "Infinity" if value > 0 else "-Infinity"
        if value.is_integer():
            return str(int(value))

    return str(value)


def _checked(sides: ResolvedBleed) -> ResolvedBleed:
    """Refuse a bleed that would shrink the region instead of growing it.

    A negative bleed would pull the boundary inwards, so ink inside the very
    box it was drawn for could be reported as an unexpected mark. Refuse it
    rather than obey it.

    The sides are checked in top, right, bottom, left order and the FIRST
    offender is named, matching the order the TypeScript's object literal
    iterates in - so a bleed with two bad sides reports the earlier one.

    :param sides: The resolved sides.
    :returns: The same sides, when every one is usable.
    :raises ValueError: When a side is negative or not finite.
    """
    for side, value in (
        ("top", sides.top),
        ("right", sides.right),
        ("bottom", sides.bottom),
        ("left", sides.left),
    ):
        if not math.isfinite(value) or value < 0:
            message = (
                f"bleed {side} must be a finite, non-negative number of points, "
                f"and is {_as_js_number(value)}"
            )
            raise ValueError(message)

    return sides


def resolve_bleed(bleed: Bleed | None = None, fallback: float = DEFAULT_BLEED) -> ResolvedBleed:
    """Every side decided: the named side if given, else ``bleed``, else ``fallback``.

    :param bleed: The bleed as given, or ``None`` for one that says nothing.
    :param fallback: The room a side gets when nothing names it.
    :returns: Every side decided.
    :raises ValueError: When a resolved side is negative or not finite.
    """
    given = bleed if bleed is not None else Bleed()
    every = given.bleed if given.bleed is not None else fallback

    return _checked(
        ResolvedBleed(
            top=given.bleed_top if given.bleed_top is not None else every,
            right=given.bleed_right if given.bleed_right is not None else every,
            bottom=given.bleed_bottom if given.bleed_bottom is not None else every,
            left=given.bleed_left if given.bleed_left is not None else every,
        ),
    )


def _nearer(side: float | None, every: float | None, base: float) -> float:
    """The nearest thing that was actually said about one side.

    :param side: The region's named side, if any.
    :param every: The region's own ``bleed``, if any.
    :param base: The already-resolved side from the options.
    :returns: The first of the three that is set.
    """
    if side is not None:
        return side
    if every is not None:
        return every

    return base


def resolve_region_bleed(region: Bleed, base: ResolvedBleed) -> ResolvedBleed:
    """One region's room, over the room every region gets.

    The region's named side, else its own ``bleed``, else ``base``'s side.
    ``base`` is already resolved, so the options' rule and the region's rule
    are the same rule applied twice, and a region that says nothing claims
    exactly what the options say - which is what every region did before a
    region could speak for itself.

    :param region: The region's own bleed.
    :param base: The already-resolved bleed every region gets.
    :returns: Every side decided.
    :raises ValueError: When a resolved side is negative or not finite.
    """
    return _checked(
        ResolvedBleed(
            top=_nearer(region.bleed_top, region.bleed, base.top),
            right=_nearer(region.bleed_right, region.bleed, base.right),
            bottom=_nearer(region.bleed_bottom, region.bleed, base.bottom),
            left=_nearer(region.bleed_left, region.bleed, base.left),
        ),
    )


def grow_by(rect: ScanmateRect, sides: ResolvedBleed) -> ScanmateRect:
    """A region with its bleed around it.

    Top-left origin, so the top side moves the rectangle UP rather than down.

    :param rect: The region.
    :param sides: Its resolved room.
    :returns: The grown region.
    """
    return ScanmateRect(
        x=rect.x - sides.left,
        y=rect.y - sides.top,
        width=rect.width + sides.left + sides.right,
        height=rect.height + sides.top + sides.bottom,
    )


def has_bleed(sides: ResolvedBleed) -> bool:
    """Whether a bleed leaves any room at all, so there is a band worth drawing.

    :param sides: The resolved room.
    :returns: Whether any side is greater than zero.
    """
    return sides.top > 0 or sides.right > 0 or sides.bottom > 0 or sides.left > 0
