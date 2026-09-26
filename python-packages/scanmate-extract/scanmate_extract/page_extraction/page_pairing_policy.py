"""Which page of the scan goes with which page of the original.

Scans lose pages, gain cover sheets and come back out of order, so pairing is a
decision the caller can make explicitly rather than something assumed. By
default page n pairs with page n. Pages left without a partner are reported,
never silently dropped: a missing page is one of the things a returned document
is checked for.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal, TypeAlias

#: ``"index"`` pairs page n with page n; a list names ``(original, scanned)``
#: pairs explicitly.
PagePairing: TypeAlias = 'Literal["index"] | Sequence[tuple[int, int]]'


@dataclass(frozen=True, slots=True)
class Unpaired:
    """Pages of each side that were left without a partner."""

    original: list[int] = field(default_factory=list)
    scanned: list[int] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class PairingPlan:
    """Which pages go together, and which were left over."""

    pairs: list[tuple[int, int]]
    unpaired: Unpaired


def plan_pairs(
    original_count: int, scanned_count: int, pairing: PagePairing = "index"
) -> PairingPlan:
    """Work out the page pairs.

    :param original_count: Pages in the document as issued.
    :param scanned_count: Pages in the document as returned.
    :param pairing: ``"index"``, or explicit ``(original, scanned)`` pairs.
    :returns: The pairs, and whatever was left unpaired on each side.
    :raises ValueError: A named page lies outside its document.
    """
    if isinstance(pairing, str):
        pairs = [(i + 1, i + 1) for i in range(min(original_count, scanned_count))]
    else:
        pairs = []
        for original, scanned in pairing:
            _check(original, original_count, "original")
            _check(scanned, scanned_count, "scanned")
            pairs.append((original, scanned))

    used_original = {pair[0] for pair in pairs}
    used_scanned = {pair[1] for pair in pairs}

    return PairingPlan(
        pairs=pairs,
        unpaired=Unpaired(
            original=[p for p in range(1, original_count + 1) if p not in used_original],
            scanned=[p for p in range(1, scanned_count + 1) if p not in used_scanned],
        ),
    )


def _check(page: int, count: int, side: str) -> None:
    """A named page must exist.

    :param page: The page number given.
    :param count: How many pages that side has.
    :param side: ``"original"`` or ``"scanned"``, for the message.
    :raises ValueError: The page lies outside the document.
    """
    if not _is_safe_integer(page) or page < 1 or page > count:
        raise ValueError(f"{side} page {page} is outside a {count}-page document")


def _is_safe_integer(value: object) -> bool:
    """JavaScript's ``Number.isSafeInteger``, with ``bool`` excluded."""
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and abs(value) <= 2**53 - 1
    )
