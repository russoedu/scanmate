"""Despeckling and noise estimation, held to the TypeScript exactly.

The pages are seeded synthetic documents, rebuilt here from the same generator
rather than shipped - the same arrangement the print-verification tests use, and
for the same reason: if the generator ever diverged, every case fails at once.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import numpy
import pytest
from scanmate_ink import (
    DocumentOptions,
    Raster,
    create_gray,
    create_synthetic_document,
    to_grayscale,
)

from .despeckle_algorithm import despeckle
from .noise_level_algorithm import estimate_noise_sigma

_GOLDEN: dict[str, Any] = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "scan-noise-reduction.json"
    ).read_text(encoding="utf-8")
)


def _speckle(raster: Raster, every: int) -> Raster:
    """Every nth pixel driven to black or white, deterministically."""
    pixels = raster.pixels.copy()
    flat = pixels.reshape(-1, 4)
    for i in range(0, len(flat), every):
        flat[i, 0:3] = 0 if (i // every) % 2 == 0 else 255

    return Raster(pixels=pixels)


@pytest.fixture(scope="module")
def pages() -> dict[str, Raster]:
    return {
        name: create_synthetic_document(
            DocumentOptions(width=spec["width"], height=spec["height"], seed=spec["seed"])
        ).raster
        for name, spec in _GOLDEN["pages"].items()
    }


def _cases(pages: dict[str, Raster]) -> dict[str, tuple[Raster, float]]:
    return {
        "clean-r1": (pages["clean"], 1),
        "clean-r2": (pages["clean"], 2),
        "speckled-r1": (_speckle(pages["clean"], 7), 1),
        "speckled-r3": (_speckle(pages["clean"], 7), 3),
        "tall-r1": (pages["another"], 1),
        "radius-rounded-up": (pages["another"], 1.6),
        "radius-rounded-down": (pages["another"], 1.4),
        "radius-floored": (pages["another"], 0),
    }


@pytest.mark.parametrize("name", sorted(_GOLDEN["despeckle"]))
def test_despeckle_matches_the_typescript(name: str, pages: dict[str, Raster]) -> None:
    """The whole image, byte for byte."""
    want = _GOLDEN["despeckle"][name]
    raster, radius = _cases(pages)[name]
    out = despeckle(raster.pixels, raster.width, raster.height, radius)

    assert hashlib.sha256(numpy.ascontiguousarray(out).tobytes()).hexdigest() == want["sha256"]

    # And a few pixels named, so a failure says where rather than only that the
    # hashes differ - including the corner, where the window is clipped.
    flat = out.reshape(-1, 4)
    offsets = [0, 1, raster.width - 1, raster.width, raster.width * raster.height - 1]
    for offset, sample in zip(offsets, want["samples"], strict=True):
        assert [int(v) for v in flat[offset]] == sample


@pytest.mark.parametrize("name", sorted(_GOLDEN["estimateNoiseSigma"]))
def test_noise_sigma_matches_the_typescript(name: str, pages: dict[str, Raster]) -> None:
    sigmas = {
        "clean": to_grayscale(pages["clean"]),
        "another": to_grayscale(pages["another"]),
        "speckled": to_grayscale(_speckle(pages["clean"], 7)),
        "heavily-speckled": to_grayscale(_speckle(pages["clean"], 3)),
        "two-by-two": create_gray(2, 2),
        "three-by-three": create_gray(3, 3),
    }

    assert estimate_noise_sigma(sigmas[name]) == _GOLDEN["estimateNoiseSigma"][name]


class TestWhatDespecklingIsFor:
    def test_an_isolated_speck_is_removed(self, pages: dict[str, Raster]) -> None:
        # A median rejects a speck instead of smearing it into its neighbours -
        # which, once contrast is stretched, is how a speck fuses into a thin
        # stroke and a "1" becomes an "l".
        pixels = numpy.full((5, 5, 4), 255, dtype=numpy.uint8)
        pixels[2, 2, 0:3] = 0

        out = despeckle(pixels, 5, 5, 1)

        assert int(out[2, 2, 0]) == 255

    def test_a_solid_block_survives(self) -> None:
        # The filter must not eat real ink: a stroke wider than the window is
        # its own majority.
        pixels = numpy.full((7, 7, 4), 255, dtype=numpy.uint8)
        pixels[1:6, 1:6, 0:3] = 0
        out = despeckle(pixels, 7, 7, 1)

        assert int(out[3, 3, 0]) == 0

    def test_alpha_is_copied_never_filtered(self) -> None:
        # A median of the alpha channel would invent edges where a page is
        # transparent.
        pixels = numpy.full((5, 5, 4), 255, dtype=numpy.uint8)
        pixels[2, 2, 3] = 0
        out = despeckle(pixels, 5, 5, 1)

        assert int(out[2, 2, 3]) == 0

    def test_a_clipped_window_takes_the_upper_middle(self) -> None:
        # At a corner the window holds four values, and `length >> 1` is the
        # third of them - not an average of the middle two, which is what a
        # mean-based median would give and would be half a level out.
        pixels = numpy.zeros((2, 2, 4), dtype=numpy.uint8)
        for index, value in enumerate((10, 20, 30, 40)):
            pixels.reshape(-1, 4)[index, 0:3] = value
        out = despeckle(pixels, 2, 2, 1)

        assert int(out[0, 0, 0]) == 30

    def test_the_radius_rounds_rather_than_truncates(self) -> None:
        # 1.6 is a radius of 2. A port that cast to an integer would quietly
        # run a 3x3 filter where a 5x5 was asked for, and the only sign would
        # be specks it failed to remove.
        pixels = numpy.full((9, 9, 4), 255, dtype=numpy.uint8)
        pixels[3:6, 3:6, 0:3] = 0

        two = despeckle(pixels, 9, 9, 2)
        rounded = despeckle(pixels, 9, 9, 1.6)
        one = despeckle(pixels, 9, 9, 1)

        assert numpy.array_equal(rounded, two)
        assert not numpy.array_equal(rounded, one)

    @pytest.mark.parametrize("radius", [0, -5, 0.4])
    def test_the_radius_is_held_at_one(self, radius: float) -> None:
        pixels = numpy.full((5, 5, 4), 255, dtype=numpy.uint8)
        pixels[2, 2, 0:3] = 0
        one = despeckle(pixels, 5, 5, 1)
        held = despeckle(pixels, 5, 5, radius)

        assert numpy.array_equal(held, one)


class TestWhatTheNoiseEstimateIsFor:
    def test_a_speckled_page_scores_higher_than_a_clean_one(
        self, pages: dict[str, Raster]
    ) -> None:
        # Text and edges occupy a small share of a page and noise is
        # everywhere, so on a document the noise dominates.
        clean = estimate_noise_sigma(to_grayscale(pages["clean"]))
        speckled = estimate_noise_sigma(to_grayscale(_speckle(pages["clean"], 7)))

        assert speckled > clean

    def test_more_specks_score_higher_still(self, pages: dict[str, Raster]) -> None:
        light = estimate_noise_sigma(to_grayscale(_speckle(pages["clean"], 7)))
        heavy = estimate_noise_sigma(to_grayscale(_speckle(pages["clean"], 3)))

        assert heavy > light

    def test_a_blank_page_has_no_noise(self) -> None:
        assert estimate_noise_sigma(create_gray(20, 20)) == 0

    @pytest.mark.parametrize(("width", "height"), [(2, 2), (2, 10), (10, 2)])
    def test_a_page_too_small_to_measure_scores_zero(self, width: int, height: int) -> None:
        # The kernel needs a pixel on every side, so there is nothing to
        # measure rather than something to guess.
        assert estimate_noise_sigma(create_gray(width, height)) == 0
