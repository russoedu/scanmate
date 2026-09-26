"""Page sizing and placement, held to the TypeScript exactly.

Ordinary arithmetic, so there is no reason for a single digit to differ, and
the assertions are `==` rather than `approx`.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from .page_placement_policy import (
    MIN_RECORDED_DPI,
    PAPER,
    PageDimensions,
    place_image,
    resolve_dpi,
)

_GOLDEN: dict[str, Any] = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "merge-page-placement.json"
    ).read_text(encoding="utf-8")
)


def _page_size(value: Any) -> Any:
    return value if isinstance(value, str) else PageDimensions(value["width"], value["height"])


@pytest.mark.parametrize(
    "case", _GOLDEN["resolveDpi"], ids=lambda c: f"{c['given']}-{c['recorded']}"
)
def test_resolve_dpi_matches_the_typescript(case: dict[str, Any]) -> None:
    assert resolve_dpi(case["given"], case["recorded"], case["fallback"]) == case["resolved"]


@pytest.mark.parametrize(
    "case",
    _GOLDEN["placeImage"],
    ids=lambda c: f"{c['pixelWidth']}x{c['pixelHeight']}-{c['pageSize']}",
)
def test_place_image_matches_the_typescript(case: dict[str, Any]) -> None:
    placement = place_image(
        case["pixelWidth"],
        case["pixelHeight"],
        case["dpi"],
        _page_size(case["pageSize"]),
        case["margin"],
    )
    want = case["placement"]

    assert placement.page_width == want["pageWidth"]
    assert placement.page_height == want["pageHeight"]
    assert placement.x == want["x"]
    assert placement.y == want["y"]
    assert placement.width == want["width"]
    assert placement.height == want["height"]


def test_the_paper_sizes_are_the_typescripts() -> None:
    for name, size in _GOLDEN["paper"].items():
        assert PAPER[name].width == size["width"]
        assert PAPER[name].height == size["height"]


class TestTheResolutionFloor:
    """Why 72 and 96 are not believed."""

    def test_a_recorded_density_below_the_floor_is_ignored(self) -> None:
        # 72 and 96 are what cameras and editors write when they know nothing.
        # A phone photo "at 72 dpi" would make a page over a metre tall.
        assert resolve_dpi(None, 72, 150) == 150
        assert resolve_dpi(None, 96, 150) == 150

    def test_the_floor_itself_is_believed(self) -> None:
        assert resolve_dpi(None, MIN_RECORDED_DPI, 150) == MIN_RECORDED_DPI
        assert resolve_dpi(None, MIN_RECORDED_DPI - 1, 150) == 150

    def test_what_the_caller_says_wins_over_everything(self) -> None:
        assert resolve_dpi(300, 600, 150) == 300

    @pytest.mark.parametrize("given", [0, -1])
    def test_a_non_positive_given_value_is_not_a_choice(self, given: float) -> None:
        assert resolve_dpi(given, 600, 150) == 600


class TestTheImagesOwnSize:
    def test_a_300_dpi_a4_scan_becomes_an_a4_page(self) -> None:
        # The property the whole default rests on: a downstream reader that
        # divides pixels by page inches gets the scan's real resolution back.
        placement = place_image(2480, 3508, 300, "image")

        assert placement.page_width == pytest.approx(595.2, abs=0.1)
        assert placement.page_height == pytest.approx(841.92, abs=0.1)

    def test_the_image_fills_the_page_exactly(self) -> None:
        placement = place_image(1000, 500, 200, "image")

        assert (placement.x, placement.y) == (0, 0)
        assert placement.width == placement.page_width
        assert placement.height == placement.page_height


class TestPaperSizes:
    def test_a_landscape_image_turns_the_page_landscape(self) -> None:
        placement = place_image(3000, 2000, 300, "a4")

        assert placement.page_width > placement.page_height

    def test_a_portrait_image_keeps_the_page_portrait(self) -> None:
        placement = place_image(2000, 3000, 300, "a4")

        assert placement.page_height > placement.page_width

    def test_a_square_image_is_portrait(self) -> None:
        # `pixelWidth > pixelHeight` decides, so equal sides are NOT landscape.
        placement = place_image(1000, 1000, 150, "a4")

        assert placement.page_height > placement.page_width

    def test_the_image_is_centred(self) -> None:
        placement = place_image(1000, 1000, 150, "a4")

        assert placement.x == pytest.approx(
            placement.page_width - placement.width - placement.x
        )
        assert placement.y == pytest.approx(
            placement.page_height - placement.height - placement.y
        )

    def test_a_margin_is_kept_on_every_side(self) -> None:
        margin = 36
        placement = place_image(1000, 1000, 150, "a4", margin)

        assert placement.x >= margin
        assert placement.y >= margin
        assert placement.x + placement.width <= placement.page_width - margin + 1e-9

    def test_an_explicit_size_is_used_as_given(self) -> None:
        placement = place_image(100, 100, 72, PageDimensions(width=200, height=400), 10)

        assert (placement.page_width, placement.page_height) == (200, 400)
