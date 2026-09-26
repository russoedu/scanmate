"""Render resolution, held to the TypeScript exactly."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pytest
from scanmate_ink import ScanmateRect

from ..page_inspection import PageMetadata
from .render_dpi_policy import DEFAULT_DPI_LIMITS, native_dpi, page_dpi, pair_dpi

_GOLDEN: dict[str, Any] = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "extract-decisions.json"
    ).read_text(encoding="utf-8")
)

_A4 = (595.28, 841.89)


def _meta(width: float, height: float, dpi: float | None) -> PageMetadata:
    return PageMetadata(
        page=1,
        point_width=width,
        point_height=height,
        rotation=0,
        media_box=ScanmateRect(x=0, y=0, width=width, height=height),
        kind="vector" if dpi is None else "scanned",
        image_coverage=0 if dpi is None else 1,
        has_text_layer=False,
        text=None,
        text_items=[],
        character_count=0,
        embedded_images=[],
        effective_dpi=dpi,
    )


_PAGES = {
    "a4Vector": _meta(*_A4, None),
    "a4Scan120": _meta(*_A4, 120),
    "a4Scan93": _meta(*_A4, 93),
    "a4Scan600": _meta(*_A4, 600),
    "a4Scan50": _meta(*_A4, 50),
    "letterScan120": _meta(612, 792, 120),
    "landscapeScan": _meta(_A4[1], _A4[0], 120),
    "hugePagePhoto": _meta(3024, 4032, 72),
}

_PAIRS = {
    "scan-on-its-own-paper": ("a4Vector", "a4Scan120"),
    "a-low-dpi-scan": ("a4Vector", "a4Scan93"),
    "a-scan-above-the-ceiling": ("a4Vector", "a4Scan600"),
    "a-scan-below-the-floor": ("a4Vector", "a4Scan50"),
    "a4-against-letter": ("a4Vector", "letterScan120"),
    "a-landscape-scan": ("a4Vector", "landscapeScan"),
    "a-photo-on-a-huge-page": ("a4Vector", "hugePagePhoto"),
    "no-scan-at-all": ("a4Vector", "a4Vector"),
}


def _choice(text: str) -> Any:
    return text if text in ("native", "match") else float(text)


def test_the_default_limits_are_the_typescripts() -> None:
    want = _GOLDEN["defaultDpiLimits"]

    assert DEFAULT_DPI_LIMITS.fallback_dpi == want["fallbackDpi"]
    assert DEFAULT_DPI_LIMITS.min_dpi == want["minDpi"]
    assert DEFAULT_DPI_LIMITS.max_dpi == want["maxDpi"]


@pytest.mark.parametrize("name", sorted(_GOLDEN["nativeDpi"]))
def test_native_dpi_matches_the_typescript(name: str) -> None:
    assert native_dpi(_PAGES[name], DEFAULT_DPI_LIMITS) == _GOLDEN["nativeDpi"][name]


@pytest.mark.parametrize("key", sorted(_GOLDEN["pageDpi"]))
def test_page_dpi_matches_the_typescript(key: str) -> None:
    name, choice = key.rsplit("-", 1)

    assert page_dpi(_PAGES[name], _choice(choice), DEFAULT_DPI_LIMITS) == _GOLDEN["pageDpi"][key]


@pytest.mark.parametrize("key", sorted(_GOLDEN["pairDpi"]))
def test_pair_dpi_matches_the_typescript(key: str) -> None:
    name, choice = key.rsplit("-", 1)
    original, scanned = _PAIRS[name]
    got = pair_dpi(_PAGES[original], _PAGES[scanned], _choice(choice), DEFAULT_DPI_LIMITS)
    want = _GOLDEN["pairDpi"][key]

    assert got.original == want["original"]
    assert got.scanned == want["scanned"]


class TestWhatMatchMeans:
    def test_a_scan_on_its_own_paper_renders_both_sides_alike(self) -> None:
        got = pair_dpi(_PAGES["a4Vector"], _PAGES["a4Scan120"], "match")

        assert got.original == got.scanned == 120

    def test_a_photo_on_a_huge_page_measures_dpi_on_the_paper(self) -> None:
        # The case the whole policy exists for: a 3024-pixel picture of an A4
        # sheet stored one pixel per point says 72 dpi of ITSELF, and holds
        # ~345 on the sheet. The original renders at what the photo really
        # holds; the photo renders at its own pixels, never resampled.
        got = pair_dpi(_PAGES["a4Vector"], _PAGES["hugePagePhoto"], "match")

        assert got.scanned == 72
        assert got.original == pytest.approx(344.82, abs=0.01)

    def test_a4_against_letter_is_not_a_different_resolution(self) -> None:
        # Paper sizes differ by a few percent, and that is not a rescale.
        got = pair_dpi(_PAGES["a4Vector"], _PAGES["letterScan120"], "match")

        assert got.original == 120

    def test_orientation_does_not_change_it(self) -> None:
        # Long side to long side and short to short, so a landscape scan of a
        # portrait page is still 1:1.
        got = pair_dpi(_PAGES["a4Vector"], _PAGES["landscapeScan"], "match")

        assert got.original == 120

    def test_with_no_scan_at_all_both_sides_fall_back(self) -> None:
        got = pair_dpi(_PAGES["a4Vector"], _PAGES["a4Vector"], "match")

        assert got.original == got.scanned == DEFAULT_DPI_LIMITS.fallback_dpi


class TestTheLimits:
    def test_a_native_resolution_is_clamped_at_both_ends(self) -> None:
        # It comes from the file and may be absurd.
        assert native_dpi(_PAGES["a4Scan600"]) == DEFAULT_DPI_LIMITS.max_dpi
        assert native_dpi(_PAGES["a4Scan50"]) == DEFAULT_DPI_LIMITS.min_dpi

    def test_a_number_the_caller_gives_is_not_clamped(self) -> None:
        # Asked for explicitly, so it is honoured - the limits guard a value
        # read from a file, not a decision.
        assert page_dpi(_PAGES["a4Scan600"], 1200) == 1200

    def test_match_means_native_for_a_single_page(self) -> None:
        assert page_dpi(_PAGES["a4Scan120"], "match") == page_dpi(_PAGES["a4Scan120"], "native")


@pytest.mark.parametrize(
    ("value", "key"),
    [(0, "zero"), (-10, "negative"), (math.inf, "infinite"), (math.nan, "notANumber")],
)
def test_refuses_a_dpi_that_is_not_a_positive_number(value: float, key: str) -> None:
    with pytest.raises(ValueError) as raised:
        page_dpi(_PAGES["a4Vector"], value)

    assert str(raised.value) == _GOLDEN["dpiRejects"][key]
