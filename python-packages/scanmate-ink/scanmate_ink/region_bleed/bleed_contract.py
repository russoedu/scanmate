"""How far beyond a marked region ink still belongs to it.

In the same units as the region itself - PDF points unless a caller says
otherwise.

A signature does not stay inside its box. The field is where it is meant to go;
the bleed is the room around it where a stroke that ran over the line is still
counted as part of the signature rather than as an unexpected mark on the page.

``bleed`` sets every side at once; a named side overrides it. So
``Bleed(bleed=6, bleed_bottom=14)`` is six points of room above and to either
side, and fourteen below - where a signature's descenders go.

**Default: 6 points on every side** - about 2 mm - when nothing is set.

It is given in two places, and the nearer one wins. On the options of a
comparison or a marking it is the room for every region; on a region itself it
is that region's own, side by side: a region's named side, else its ``bleed``,
else the options' side. A signature box can have twenty points below while the
date beside it keeps the six.

WHY EVERY FIELD IS ``None`` AND NOT ``0``
------------------------------------------

The TypeScript chooses each side with ``??``, which falls through on ``null``
and ``undefined`` and **not** on zero. Zero is a real answer here - "no room on
this side" - and it has to survive every fallback. So unset is ``None``
throughout, and the resolver tests ``is None`` rather than truthiness. Writing
``region.bleed_top or base.top`` would turn every explicit zero back into the
default, and silently widen every region that asked for none.
"""

from __future__ import annotations

from dataclasses import dataclass


# Deliberately NOT `slots=True`, unlike every other dataclass in this package.
# `Bleed` exists to be MIXED IN - the TypeScript writes
# `interface PageRegion extends ScanmateRect, Bleed`, and `pipeline_contract`
# does the same thing here. CPython refuses to combine two bases that both
# carry a non-empty `__slots__` ("multiple bases have instance lay-out
# conflict"), so the one meant to be mixed in does without. The cost is one
# dict per bleed, and there is one bleed per region.
@dataclass(frozen=True)
class Bleed:
    """A bleed as a caller gives it, with any side possibly unset."""

    #: Every side, unless that side is given on its own.
    bleed: float | None = None
    bleed_top: float | None = None
    bleed_right: float | None = None
    bleed_bottom: float | None = None
    bleed_left: float | None = None


@dataclass(frozen=True, slots=True)
class ResolvedBleed:
    """A bleed with every side decided."""

    top: float
    right: float
    bottom: float
    left: float
