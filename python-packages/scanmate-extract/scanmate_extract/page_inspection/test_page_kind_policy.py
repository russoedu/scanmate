"""Page classification, held to the TypeScript exactly."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from .page_kind_policy import SCAN_COVERAGE, PageEvidence, classify_page

_GOLDEN: dict[str, Any] = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "extract-decisions.json"
    ).read_text(encoding="utf-8")
)


def test_the_threshold_is_the_typescripts() -> None:
    assert SCAN_COVERAGE == _GOLDEN["scanCoverage"]


@pytest.mark.parametrize("name", sorted(_GOLDEN["classifyPage"]))
def test_matches_the_typescript(name: str) -> None:
    case = _GOLDEN["classifyPage"][name]
    evidence = case["evidence"]

    assert (
        classify_page(
            PageEvidence(
                image_coverage=evidence["imageCoverage"],
                character_count=evidence["characterCount"],
                draws_paths=evidence["drawsPaths"],
            )
        )
        == case["kind"]
    )


class TestWhatSeparatesAScanFromADocument:
    def test_coverage_decides_not_the_number_of_images(self) -> None:
        # Measured on a real born-digital order form: the letterhead logo
        # covers 1.2% of the page; every page of its scans, 100%.
        logo = PageEvidence(image_coverage=0.012, character_count=800, draws_paths=True)
        scan = PageEvidence(image_coverage=1.0, character_count=0, draws_paths=False)

        assert classify_page(logo) == "vector"
        assert classify_page(scan) == "scanned"

    def test_the_threshold_is_inclusive(self) -> None:
        at = PageEvidence(image_coverage=SCAN_COVERAGE, character_count=0, draws_paths=False)
        under = PageEvidence(
            image_coverage=SCAN_COVERAGE - 0.0001, character_count=0, draws_paths=False
        )

        assert classify_page(at) == "scanned"
        assert classify_page(under) == "vector"

    def test_a_scan_with_an_ocr_layer_is_named_as_such(self) -> None:
        # Many scanners produce these, and treating one as born-digital would
        # trust an OCR layer as ground truth.
        evidence = PageEvidence(image_coverage=1.0, character_count=500, draws_paths=False)

        assert classify_page(evidence) == "scanned-with-text-layer"

    def test_a_page_with_nothing_on_it_is_empty(self) -> None:
        assert (
            classify_page(PageEvidence(image_coverage=0, character_count=0, draws_paths=False))
            == "empty"
        )

    def test_paths_alone_make_it_a_vector_page(self) -> None:
        # A signature line and nothing else is still a page someone printed.
        assert (
            classify_page(PageEvidence(image_coverage=0, character_count=0, draws_paths=True))
            == "vector"
        )
