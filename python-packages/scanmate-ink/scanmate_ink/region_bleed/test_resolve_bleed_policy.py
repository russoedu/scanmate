"""The bleed rules, measured against the TypeScript.

No floating point anywhere in this slice, so nothing here is about the last
bit. It is about one operator.

Every side is chosen with ``??`` in the TypeScript, which falls through on
``null`` and ``undefined`` and NOT on zero. Python's ``or`` falls through on
zero too, so a port written the obvious way turns "no room on this side" into
"the default six points" and silently widens every region that asked for none.
Most of the cases below exist to make that substitution fail: a zero in every
position where one can legally appear, including as the fallback itself.

The rejection messages are compared in full, spelling included, which is why
the policy carries a four-line JavaScript number formatter. The part that
matters is WHICH side a bleed with two bad sides names first, and that only
shows if the whole string is checked.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from ..plane_geometry import ScanmateRect
from .bleed_contract import Bleed, ResolvedBleed
from .resolve_bleed_policy import (
    DEFAULT_BLEED,
    grow_by,
    has_bleed,
    resolve_bleed,
    resolve_region_bleed,
)

_GOLDEN = json.loads(
    (Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "region-bleed.json").read_text(
        encoding="utf-8"
    ),
)


def as_bleed(golden: dict[str, float]) -> Bleed:
    """Read a golden's bleed object, where an absent key means unset.

    The distinction the whole slice turns on: a key that is missing is
    ``None``, and a key that is present and zero is zero.

    :param golden: The golden's bleed literal.
    :returns: The bleed.
    """
    return Bleed(
        bleed=golden.get("bleed"),
        bleed_top=golden.get("bleedTop"),
        bleed_right=golden.get("bleedRight"),
        bleed_bottom=golden.get("bleedBottom"),
        bleed_left=golden.get("bleedLeft"),
    )


def as_resolved(golden: dict[str, float]) -> ResolvedBleed:
    """Read a golden's resolved bleed.

    :param golden: The golden's resolved literal.
    :returns: The resolved bleed.
    """
    return ResolvedBleed(
        top=golden["top"],
        right=golden["right"],
        bottom=golden["bottom"],
        left=golden["left"],
    )


_BASE = as_resolved(_GOLDEN["base"])


def test_the_default_is_six_points() -> None:
    """About two millimetres, and the number the pixel comparison used before
    a bleed could be set per side.
    """
    assert DEFAULT_BLEED == _GOLDEN["defaultBleed"] == 6


@pytest.mark.parametrize("name", list(_GOLDEN["resolveBleed"]))
def test_resolve_bleed_matches(name: str) -> None:
    """Every fallback path, with a zero in each position that admits one.

    :param name: The case the golden holds.
    """
    case = _GOLDEN["resolveBleed"][name]
    bleed = as_bleed(case["bleed"])
    # `JSON.stringify` drops an `undefined` value entirely, so an absent key is
    # how the golden spells "no fallback given" - the same distinction the
    # bleed fields themselves carry.
    fallback = case.get("fallback")
    resolved = resolve_bleed(bleed) if fallback is None else resolve_bleed(bleed, fallback)

    assert resolved == as_resolved(case["resolved"])


@pytest.mark.parametrize("name", list(_GOLDEN["resolveRegionBleed"]))
def test_resolve_region_bleed_matches(name: str) -> None:
    """A region's own room over the room every region gets.

    :param name: The case the golden holds.
    """
    case = _GOLDEN["resolveRegionBleed"][name]

    assert resolve_region_bleed(as_bleed(case["region"]), _BASE) == as_resolved(case["resolved"])


def test_zero_survives_every_fallback_that_could_swallow_it() -> None:
    """The one test that would fail against ``or`` in all four positions.

    An explicit zero has to win over the fallback, over ``bleed``, and over an
    already-resolved base - and a fallback of zero has to win over the default
    six. Under ``or`` every one of these returns 6 or the base instead.
    """
    assert resolve_bleed(Bleed(bleed=0)) == ResolvedBleed(0, 0, 0, 0)
    assert resolve_bleed(Bleed(bleed_top=0), 5) == ResolvedBleed(0, 5, 5, 5)
    assert resolve_bleed(Bleed(bleed=7, bleed_right=0)) == ResolvedBleed(7, 0, 7, 7)
    assert resolve_bleed(Bleed(), 0) == ResolvedBleed(0, 0, 0, 0)
    assert resolve_region_bleed(Bleed(bleed=0), _BASE) == ResolvedBleed(0, 0, 0, 0)
    assert resolve_region_bleed(Bleed(bleed_left=0), _BASE).left == 0


def test_a_region_that_says_nothing_claims_exactly_what_the_options_say() -> None:
    """The property that lets a bleed be introduced without changing anything."""
    assert resolve_region_bleed(Bleed(), _BASE) == _BASE


@pytest.mark.parametrize(
    ("name", "call"),
    [
        ("negativeAll", lambda: resolve_bleed(Bleed(bleed=-1))),
        ("negativeSide", lambda: resolve_bleed(Bleed(bleed_bottom=-0.5))),
        ("notFinite", lambda: resolve_bleed(Bleed(bleed=math.inf))),
        ("notANumber", lambda: resolve_bleed(Bleed(bleed_left=math.nan))),
        ("negativeRegion", lambda: resolve_region_bleed(Bleed(bleed_right=-2), _BASE)),
        ("twoBadSides", lambda: resolve_bleed(Bleed(bleed_right=-1, bleed_left=-2))),
    ],
)
def test_an_unusable_bleed_is_refused_with_the_same_message(name: str, call: object) -> None:
    """Including which side a bleed with two bad sides names.

    ``twoBadSides`` has both right and left negative and must name RIGHT, which
    is the only way to see that the sides are checked in top, right, bottom,
    left order rather than in whatever order a dataclass happens to expose.

    :param name: The case the golden holds.
    :param call: The call that must be refused.
    """
    with pytest.raises(ValueError) as raised:
        call()  # type: ignore[operator]

    assert str(raised.value) == _GOLDEN["rejects"][name]


def test_infinity_is_refused_as_well_as_a_negative() -> None:
    """A bleed of infinity would grow the region over the whole page.

    Checked separately from the message comparison because it is a different
    claim: not "the wording matches" but "this is rejected at all".
    """
    with pytest.raises(ValueError, match="finite"):
        resolve_bleed(Bleed(bleed=math.inf))

    with pytest.raises(ValueError, match="finite"):
        resolve_bleed(Bleed(bleed=math.nan))


def test_grow_by_moves_the_top_edge_up() -> None:
    """Top-left origin, so growing upwards DECREASES y.

    The golden's uniform case is a 100x40 box at (12, 30) with six points on
    every side: it becomes 112x52 at (6, 24). A port that added instead of
    subtracting would keep the width and height right and put the box in the
    wrong place.

    ``asymmetric`` carries four distinct sides, and it is the only case that
    can tell ``width + left + right`` from ``width + left + left`` - every
    other bleed here is symmetric left to right.
    """
    case = _GOLDEN["growBy"]
    rect = ScanmateRect(
        x=case["rect"]["x"],
        y=case["rect"]["y"],
        width=case["rect"]["width"],
        height=case["rect"]["height"],
    )

    for key, sides in (
        ("uniform", resolve_bleed()),
        ("sided", _BASE),
        ("zero", resolve_bleed(Bleed(bleed=0))),
        # Four distinct sides: the only case that separates `left + right`
        # from `left + left`, since every other one is symmetric.
        (
            "asymmetric",
            resolve_bleed(Bleed(bleed_top=1, bleed_right=17, bleed_bottom=9, bleed_left=3)),
        ),
    ):
        grown = grow_by(rect, sides)
        expected = case[key]

        assert (grown.x, grown.y, grown.width, grown.height) == (
            expected["x"],
            expected["y"],
            expected["width"],
            expected["height"],
        )


def test_grow_by_with_no_bleed_is_the_rectangle_itself() -> None:
    """Zero room must be the identity, not an off-by-one."""
    rect = ScanmateRect(x=12, y=30, width=100, height=40)
    grown = grow_by(rect, resolve_bleed(Bleed(bleed=0)))

    assert (grown.x, grown.y, grown.width, grown.height) == (12, 30, 100, 40)


@pytest.mark.parametrize("name", list(_GOLDEN["hasBleed"]))
def test_has_bleed_matches(name: str) -> None:
    """Including a bleed on the LAST side only.

    ``lastSide`` is zero everywhere but the left. A port that checked only the
    first side, or that stopped early, agrees on every other case here.

    :param name: The case the golden holds.
    """
    sides = {
        "uniform": resolve_bleed(),
        "zero": resolve_bleed(Bleed(bleed=0)),
        "oneSide": resolve_bleed(Bleed(bleed=0, bleed_top=1)),
        "lastSide": resolve_bleed(Bleed(bleed=0, bleed_left=1)),
    }[name]

    assert has_bleed(sides) is _GOLDEN["hasBleed"][name]
