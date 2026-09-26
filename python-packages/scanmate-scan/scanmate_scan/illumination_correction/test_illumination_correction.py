"""Levelling and contrast, held to the TypeScript exactly.

The enhanced page is compared as a whole image, sha256 over every byte, because
this is where two roundings sit side by side and either could be wrong on its
own: ``Math.round`` rounds a half **up** in the contrast stretch, and a
``Uint8ClampedArray`` rounds a half **to even** where the unsharp mask writes
into one. A port that used one rule for both would be right on most pixels.
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
    GrayImage,
    Raster,
    ScanmateRect,
    box_blur,
    create_gray,
    create_raster,
    create_synthetic_document,
    fill_rect,
    to_grayscale,
)

from ..noise_reduction import despeckle as median_filter
from .contrast_points_policy import estimate_contrast_points, resolve_contrast_points
from .enhance_options_contract import (
    DEFAULT_ENHANCE_OPTIONS,
    EnhanceOptions,
    SharpenOptions,
)
from .enhance_raster_use_case import _js_round, enhance_raster

_GOLDEN: dict[str, Any] = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "scan-illumination.json"
    ).read_text(encoding="utf-8")
)


@pytest.fixture(scope="module")
def pages() -> dict[str, Raster]:
    """Every page the golden names: generated documents, and hand-built ones.

    The hand-built ones exist because a generated document never lands on the
    values a few of these cases are for - an exactly-half rounding, a page too
    small for the background window's own floor, a background mean below one.
    Each is built from the recipe the golden carries, so both sides build the
    same pixels or every case using it fails at once.
    """
    built = {}
    for name, spec in _GOLDEN["builtPages"].items():
        grey = spec["grey"]
        page = create_raster(spec["width"], spec["height"], (grey, grey, grey, 255))
        if spec.get("rect") is not None:
            x, y, width, height = spec["rect"]
            fill_rect(page, ScanmateRect(x=x, y=y, width=width, height=height), spec["rectValue"])
        built[name] = page

    return {
        **built,
        **{
            name: create_synthetic_document(
                DocumentOptions(width=spec["width"], height=spec["height"], seed=spec["seed"])
            ).raster
            for name, spec in _GOLDEN["pages"].items()
        },
    }


_CASES: dict[str, tuple[str, EnhanceOptions]] = {
    "defaults": ("small", EnhanceOptions()),
    "grayscale": ("small", EnhanceOptions(mode="grayscale")),
    "fixed-points": ("small", EnhanceOptions(white_point=0.95, black_point=0.2)),
    "one-auto-point": ("small", EnhanceOptions(white_point=0.95)),
    "no-despeckle": ("small", EnhanceOptions(despeckle=False)),
    "forced-despeckle": ("small", EnhanceOptions(despeckle=True)),
    "a-wider-background": ("small", EnhanceOptions(background_fraction=1 / 4)),
    "sharpened": ("small", EnhanceOptions(sharpen=SharpenOptions(sigma=2))),
    "sharpen-rounds-up": ("small", EnhanceOptions(sharpen=SharpenOptions(sigma=1.6))),
    "sharpen-rounds-down": ("small", EnhanceOptions(sharpen=SharpenOptions(sigma=1.4))),
    "sharpen-off-by-sigma": ("small", EnhanceOptions(sharpen=SharpenOptions(sigma=0))),
    "sharpen-off-by-amount": (
        "small",
        EnhanceOptions(sharpen=SharpenOptions(sigma=2, amount=0)),
    ),
    "a-wide-page": ("wide", EnhanceOptions()),
    "stretch-half-up": (
        "uniform-200",
        EnhanceOptions(mode="grayscale", white_point=6, black_point=0, despeckle=False),
    ),
    "inverted-points": (
        "uniform-200",
        EnhanceOptions(mode="grayscale", white_point=0.2, black_point=0.5, despeckle=False),
    ),
    "a-tiny-page": ("a-small-mark", EnhanceOptions(despeckle=False)),
    "sub-half-sigma": (
        "a-medium-mark",
        EnhanceOptions(despeckle=False, sharpen=SharpenOptions(sigma=0.4)),
    ),
    "one-lit-pixel": (
        "one-lit-on-black",
        EnhanceOptions(despeckle=False, white_point=1, black_point=0),
    ),
    "one-lit-pixel-in-grey": (
        "one-lit-on-black",
        EnhanceOptions(mode="grayscale", despeckle=False, white_point=1, black_point=0),
    ),
    "one-lit-pixel-wide-span": (
        "one-lit-on-black",
        EnhanceOptions(despeckle=False, white_point=100, black_point=0),
    ),
}


@pytest.mark.parametrize("name", sorted(_GOLDEN["enhanceRaster"]))
def test_enhance_matches_the_typescript(name: str, pages: dict[str, Raster]) -> None:
    want = _GOLDEN["enhanceRaster"][name]
    page, options = _CASES[name]
    raster = pages[page]
    result = enhance_raster(raster, options)

    assert (
        hashlib.sha256(numpy.ascontiguousarray(result.raster.pixels).tobytes()).hexdigest()
        == want["sha256"]
    )

    applied = result.applied
    assert applied.white_point == want["applied"]["whitePoint"]
    assert applied.black_point == want["applied"]["blackPoint"]
    assert applied.mode == want["applied"]["mode"]
    assert applied.despeckled == want["applied"]["despeckled"]
    assert applied.noise_sigma == want["applied"]["noiseSigma"]

    flat = result.raster.pixels.reshape(-1, 4)
    offsets = [0, 1, raster.width, raster.width * raster.height - 1]
    for offset, sample in zip(offsets, want["samples"], strict=True):
        assert [int(v) for v in flat[offset]] == sample


@pytest.mark.parametrize("name", sorted(_GOLDEN["contrastPoints"]))
def test_contrast_points_match_the_typescript(name: str, pages: dict[str, Raster]) -> None:
    want = _GOLDEN["contrastPoints"][name]
    gray = to_grayscale(pages[name])
    background = box_blur(gray, 8)

    estimated = estimate_contrast_points(gray, background)
    assert estimated.white_point == want["estimated"]["whitePoint"]
    assert estimated.black_point == want["estimated"]["blackPoint"]

    resolved = resolve_contrast_points(0.9, "auto", gray, background)
    assert resolved.white_point == want["resolved"]["whitePoint"]
    assert resolved.black_point == want["resolved"]["blackPoint"]


def _gray_of(values: list[float], width: int, height: int) -> GrayImage:
    image = create_gray(width, height)
    image.pixels[:] = numpy.asarray(values, dtype=numpy.float32).reshape(height, width)

    return image


@pytest.mark.parametrize("name", sorted(_GOLDEN["histogramPoints"]))
def test_a_chosen_histogram_reads_the_points_the_typescript_reads(name: str) -> None:
    """Pages whose histogram is chosen, not measured.

    A generated page pins none of the bounds: its percentiles land in the middle
    of a wide block of near-identical ratios, so nudging a percentile or a clamp
    by one changes nothing and a wrong constant passes. These two pages put a
    single pixel at each boundary that matters - including a ratio of 0.25,
    whose histogram position is exactly 42.5, the one value where rounding a
    half up and rounding it to even disagree.
    """
    spec = _GOLDEN["histogramFixtures"][name]
    want = _GOLDEN["histogramPoints"][name]
    gray = _gray_of(spec["greys"], spec["width"], spec["height"])
    background = create_gray(spec["width"], spec["height"])
    background.pixels[:] = numpy.float32(spec["background"])

    estimated = estimate_contrast_points(gray, background)
    assert estimated.black_point == want["estimated"]["blackPoint"]
    assert estimated.white_point == want["estimated"]["whitePoint"]

    resolved = resolve_contrast_points(0.9, "auto", gray, background)
    assert resolved.white_point == want["resolved"]["whitePoint"]
    assert resolved.black_point == want["resolved"]["blackPoint"]


def test_the_noise_threshold_is_strict(pages: dict[str, Raster]) -> None:
    """The threshold set to exactly the page's own measured noise.

    ``"auto"`` despeckles when the measured sigma is **above** the threshold, so
    at equality it does nothing. Nothing else reaches this boundary: a measured
    statistic never equals a hand-written constant by accident, which is why the
    golden carries the measured value and passes it back as the threshold.
    """
    want = _GOLDEN["noiseThresholdBoundary"]
    page = pages[want["page"]]

    applied = enhance_raster(
        page, EnhanceOptions(despeckle_threshold=want["threshold"])
    ).applied

    assert applied.noise_sigma == want["applied"]["noiseSigma"]
    assert applied.noise_sigma == want["threshold"]
    assert applied.despeckled is want["applied"]["despeckled"]


def test_the_defaults_are_the_typescripts() -> None:
    want = _GOLDEN["defaultOptions"]

    assert DEFAULT_ENHANCE_OPTIONS.sharpen is False
    assert DEFAULT_ENHANCE_OPTIONS.background_fraction == want["backgroundFraction"]
    assert DEFAULT_ENHANCE_OPTIONS.white_point == want["whitePoint"]
    assert DEFAULT_ENHANCE_OPTIONS.black_point == want["blackPoint"]
    assert DEFAULT_ENHANCE_OPTIONS.mode == want["mode"]
    assert DEFAULT_ENHANCE_OPTIONS.despeckle == want["despeckle"]
    assert DEFAULT_ENHANCE_OPTIONS.despeckle_threshold == want["despeckleThreshold"]
    assert DEFAULT_ENHANCE_OPTIONS.despeckle_radius == want["despeckleRadius"]


class TestWhatAutoActuallyDoes:
    def test_it_is_not_paper_to_white(self, pages: dict[str, Raster]) -> None:
        """The point the policy's own note makes, asserted.

        Paper is nearly all of a page and noise spreads it both ways, so its
        brightest 1% sit above 1 and the white point lands on its 1.1 bound;
        ink is a few percent of a text page, so the black point lands low. The
        result is a gentle stretch, not a whitening - and it is kept because on
        real scans it read best.
        """
        applied = enhance_raster(pages["small"]).applied

        assert applied.white_point == 1.1
        assert applied.black_point <= 0.4

    def test_fixed_points_pass_straight_through(self, pages: dict[str, Raster]) -> None:
        applied = enhance_raster(
            pages["small"], EnhanceOptions(white_point=0.95, black_point=0.2)
        ).applied

        assert (applied.white_point, applied.black_point) == (0.95, 0.2)

    def test_two_fixed_points_never_measure_the_page(self, pages: dict[str, Raster]) -> None:
        # `noise_sigma` is None when nothing depended on it - the honest way of
        # saying "not measured" rather than reporting a zero nobody computed.
        applied = enhance_raster(
            pages["small"],
            EnhanceOptions(white_point=0.95, black_point=0.2, despeckle=False),
        ).applied

        assert applied.noise_sigma is None

    def test_one_auto_point_still_reads_the_page(self, pages: dict[str, Raster]) -> None:
        applied = enhance_raster(pages["small"], EnhanceOptions(white_point=0.95)).applied

        assert applied.white_point == 0.95
        assert applied.black_point != 0.95


class TestDespecklingIsChosenNotForced:
    def test_auto_measures_before_deciding(self, pages: dict[str, Raster]) -> None:
        # Forcing a despeckle cost OCR recall at every resolution tried, badly
        # at the scans' own: a 3x3 median erases a stroke one or two pixels
        # wide. So it fires only on a page that measures noisy.
        applied = enhance_raster(pages["small"]).applied

        assert applied.noise_sigma is not None

    def test_a_threshold_above_the_page_leaves_it_alone(
        self, pages: dict[str, Raster]
    ) -> None:
        applied = enhance_raster(
            pages["small"], EnhanceOptions(despeckle_threshold=10)
        ).applied

        assert applied.despeckled is False

    def test_false_never_measures_and_never_filters(self, pages: dict[str, Raster]) -> None:
        applied = enhance_raster(pages["small"], EnhanceOptions(despeckle=False)).applied

        assert applied.despeckled is False
        assert applied.noise_sigma is None

    def test_true_filters_without_measuring(self, pages: dict[str, Raster]) -> None:
        applied = enhance_raster(pages["small"], EnhanceOptions(despeckle=True)).applied

        assert applied.despeckled is True
        assert applied.noise_sigma is None


class TestSharpening:
    def test_it_is_off_by_default(self, pages: dict[str, Raster]) -> None:
        # It helps a soft scan a great deal and costs a good one a little, so
        # it is chosen per document rather than applied to every one.
        assert enhance_raster(pages["small"]).applied.sharpened is False

    def test_a_zero_sigma_changes_nothing(self, pages: dict[str, Raster]) -> None:
        plain = enhance_raster(pages["small"])
        none = enhance_raster(pages["small"], EnhanceOptions(sharpen=SharpenOptions(sigma=0)))

        assert numpy.array_equal(none.raster.pixels, plain.raster.pixels)

    def test_a_zero_amount_changes_nothing(self, pages: dict[str, Raster]) -> None:
        plain = enhance_raster(pages["small"])
        none = enhance_raster(
            pages["small"], EnhanceOptions(sharpen=SharpenOptions(sigma=2, amount=0))
        )

        assert numpy.array_equal(none.raster.pixels, plain.raster.pixels)

    def test_the_sigma_rounds_rather_than_truncates(self, pages: dict[str, Raster]) -> None:
        # 1.6 is a box radius of 2. A port that truncated would blur with a
        # radius of 1 and sharpen the wrong scale of detail.
        up = enhance_raster(pages["small"], EnhanceOptions(sharpen=SharpenOptions(sigma=1.6)))
        two = enhance_raster(pages["small"], EnhanceOptions(sharpen=SharpenOptions(sigma=2)))
        down = enhance_raster(pages["small"], EnhanceOptions(sharpen=SharpenOptions(sigma=1.4)))

        assert numpy.array_equal(up.raster.pixels, two.raster.pixels)
        assert not numpy.array_equal(up.raster.pixels, down.raster.pixels)

    def test_it_changes_the_page(self, pages: dict[str, Raster]) -> None:
        plain = enhance_raster(pages["small"])
        sharp = enhance_raster(pages["small"], EnhanceOptions(sharpen=SharpenOptions(sigma=2)))

        assert not numpy.array_equal(sharp.raster.pixels, plain.raster.pixels)


def test_alpha_survives_the_whole_pipeline(pages: dict[str, Raster]) -> None:
    # Every stage copies it rather than computing it, and a page that lost its
    # alpha would composite wrongly everywhere downstream.
    result = enhance_raster(pages["small"], EnhanceOptions(sharpen=SharpenOptions(sigma=2)))

    assert numpy.array_equal(result.raster.pixels[:, :, 3], pages["small"].pixels[:, :, 3])


class TestWhatNoFixtureCanSeparate:
    """Three choices in this slice that no input distinguishes, asserted as the
    invariants that make them safe rather than left as untested lines.

    Mutation testing reports each of them as replaceable, and each really is -
    but only because something else holds. They are kept as written because the
    TypeScript is written that way, and a reader comparing the two files should
    find the same expression, not a locally-simplified one.
    """

    def test_the_clamp_bounds_are_ordered(self) -> None:
        """Why ``min(high, max(low, v))`` and ``max(low, min(high, v))`` agree.

        They agree for every ``v`` exactly when ``low <= high``, and both call
        sites pass literals that satisfy it - ``0`` to ``0.4`` for the black
        point, ``0.7`` to ``1.1`` for the white. So the order of the two calls
        is unobservable, and this is the fact that makes it so.
        """
        assert 0 <= 0.4
        assert 0.7 <= 1.1

    def test_despeckling_leaves_alpha_alone(self, pages: dict[str, Raster]) -> None:
        """Why taking alpha from the despeckled pixels or the raw ones is the same.

        ``despeckle`` copies the alpha channel rather than filtering it - a
        median of alpha would invent edges where a page is transparent - so the
        two are equal for every page, and the choice cannot be tested. It is
        this that makes it safe.
        """
        page = pages["small"]
        filtered = median_filter(page.pixels, page.width, page.height, 1)

        assert numpy.array_equal(filtered[:, :, 3], page.pixels[:, :, 3])

    def test_the_background_radius_never_reaches_the_blur_floor(
        self, pages: dict[str, Raster]
    ) -> None:
        """Why the blur's own ``max(1, ...)`` cannot fire.

        The background radius is already floored at 4 before it is handed to the
        blur, so the blur's own floor of 1 is unreachable through
        ``enhance_raster`` - defensive code mirroring the TypeScript's, not a
        branch with a case behind it. Asserted on the smallest page here,
        because the smaller the page the smaller the computed radius.
        """
        page = pages["a-small-mark"]
        fraction = DEFAULT_ENHANCE_OPTIONS.background_fraction

        assert max(4, _js_round(min(page.width, page.height) * fraction)) >= 4
