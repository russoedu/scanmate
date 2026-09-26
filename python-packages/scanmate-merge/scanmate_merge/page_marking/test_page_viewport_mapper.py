"""pdf.js's page transform, and the way back, held to the TypeScript exactly."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from .page_viewport_mapper import PageGeometry, to_user_space, viewport_size, viewport_transform

_GOLDEN: dict[str, Any] = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "merge-page-viewport.json"
    ).read_text(encoding="utf-8")
)


def _geometry(raw: dict[str, Any]) -> PageGeometry:
    return PageGeometry(view=tuple(raw["view"]), rotation=raw["rotation"])


@pytest.mark.parametrize("name", sorted(_GOLDEN["cases"]))
def test_matches_the_typescript(name: str) -> None:
    case = _GOLDEN["cases"][name]
    geometry = _geometry(case["geometry"])

    transform = viewport_transform(geometry)
    assert list(transform) == case["transform"]

    size = viewport_size(geometry)
    assert size.width == case["size"]["width"]
    assert size.height == case["size"]["height"]

    for point in case["userSpace"]:
        user = to_user_space(transform, point["x"], point["y"])
        assert user.x == point["user"]["x"]
        assert user.y == point["user"]["y"]


@pytest.mark.parametrize("case", _GOLDEN["refuses"], ids=lambda c: str(c["rotation"]))
def test_refuses_a_rotation_that_is_not_a_quarter_turn(case: dict[str, Any]) -> None:
    """Refused rather than drawn somewhere plausible.

    The message is compared too: it names the offending rotation, and a helper
    for checking positions has to say which page it could not check.
    """
    with pytest.raises(ValueError) as raised:
        viewport_transform(PageGeometry(view=(0, 0, 100, 100), rotation=case["rotation"]))

    assert str(raised.value) == case["message"]


class TestWhatTheTransformIsFor:
    def test_a_quarter_turn_swaps_the_page_sides(self) -> None:
        upright = PageGeometry(view=(0, 0, 595.28, 841.89), rotation=0)
        turned = PageGeometry(view=(0, 0, 595.28, 841.89), rotation=90)

        assert viewport_size(upright).width == viewport_size(turned).height
        assert viewport_size(upright).height == viewport_size(turned).width

    def test_the_top_left_as_read_is_the_top_left_of_the_box(self) -> None:
        # The whole point: a mark measured from the top-left of the page as
        # displayed lands at the top-left of the media box on an upright page.
        geometry = PageGeometry(view=(0, 0, 200, 300), rotation=0)
        at = to_user_space(viewport_transform(geometry), 0, 0)

        assert (at.x, at.y) == (0, 300)

    @pytest.mark.parametrize("rotation", [0, 90, 180, 270])
    def test_the_round_trip_returns_the_point_it_started_from(self, rotation: int) -> None:
        # Inverting the transform is the half that is easy to get subtly wrong,
        # and wrong here means a box drawn confidently in the wrong place.
        geometry = PageGeometry(view=(20, 30, 400, 700), rotation=rotation)
        transform = viewport_transform(geometry)
        a, b, c, d, e, f = transform

        for x, y in [(0, 0), (100, 50), (380, 670)]:
            user = to_user_space(transform, x, y)
            back_x = a * user.x + c * user.y + e
            back_y = b * user.x + d * user.y + f

            assert back_x == pytest.approx(x)
            assert back_y == pytest.approx(y)

    def test_a_negative_rotation_is_the_same_as_its_positive_turn(self) -> None:
        # JavaScript's % keeps the sign of the left operand, so the TypeScript
        # needs ((r % 360) + 360) % 360 to land on 270. Python's % already
        # does, and both must agree.
        assert viewport_transform(PageGeometry(view=(0, 0, 100, 200), rotation=-90)) == (
            viewport_transform(PageGeometry(view=(0, 0, 100, 200), rotation=270))
        )

    def test_a_rotation_over_a_full_turn_wraps(self) -> None:
        assert viewport_transform(PageGeometry(view=(0, 0, 100, 200), rotation=450)) == (
            viewport_transform(PageGeometry(view=(0, 0, 100, 200), rotation=90))
        )

    def test_no_coordinate_comes_back_as_negative_zero(self) -> None:
        # Harmless to draw at, noisy to read back - and the TypeScript adds 0
        # to prevent it, so a golden carrying 0 would not match a port
        # carrying -0.
        user = to_user_space(viewport_transform(
            PageGeometry(view=(0, 0, 200, 300), rotation=0)), 0, 300)

        assert str(user.x) == "0.0"
        assert str(user.y) == "0.0"
