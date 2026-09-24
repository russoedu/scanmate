"""Resampling, measured against the TypeScript.

Every assertion is exact. The only primitive anywhere in this slice that is not
plain arithmetic is ``sqrt``, and IEEE-754 requires it to be correctly rounded,
so Python and V8 agree on it bit for bit - unlike ``hypot`` or ``atan2``, which
is why ``plane_geometry`` carries a 1-ULP bar and this file does not.

The page and its greyscale are rebuilt from the seed, exactly as
``ink_separation``'s tests do, so nothing here needs a binary fixture.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from ..deterministic_sampling import create_random
from ..ink_separation import to_grayscale
from ..plane_geometry import Matrix3
from ..raster_codec import GrayImage, Raster, create_raster
from .resize_gray_algorithm import box_blur_raster, downscale_gray, resize_gray
from .warp_algorithm import WarpOptions, sample_gray_bilinear, warp_gray, warp_raster

_PARITY = Path(__file__).parents[4] / "tools" / "parity"
_GOLDEN = json.loads((_PARITY / "goldens" / "geometric-transform.json").read_text(encoding="utf-8"))
_INK_GOLDEN = json.loads(
    (_PARITY / "goldens" / "ink-separation.json").read_text(encoding="utf-8"),
)

_RGBA = 4
_BYTE_STATES = 256


def build_page() -> Raster:
    """Rebuild the page ``tools/parity`` fed to the TypeScript.

    :returns: The raster, byte for byte.
    """
    page = create_raster(_INK_GOLDEN["width"], _INK_GOLDEN["height"])
    random = create_random(_INK_GOLDEN["seed"])
    every = _INK_GOLDEN["alphaEvery"]

    flat = page.pixels.reshape(-1)
    for offset in range(0, flat.size, _RGBA):
        flat[offset] = math.floor(random() * _BYTE_STATES)
        flat[offset + 1] = math.floor(random() * _BYTE_STATES)
        flat[offset + 2] = math.floor(random() * _BYTE_STATES)
        flat[offset + 3] = 128 if offset % every == 0 else 255

    return page


_PAGE = build_page()
_GRAY = to_grayscale(_PAGE)


def as_float32(values: list[float]) -> np.ndarray:
    """Narrow the golden's decimals back to the float32 values they were stored as.

    :param values: The golden numbers.
    :returns: A flat float32 array.
    """
    return np.asarray(values, dtype=np.float64).astype(np.float32)


def as_matrix(values: list[float]) -> Matrix3:
    """Read nine JSON numbers as a matrix.

    :param values: The golden's nine numbers.
    :returns: The matrix.
    """
    a, b, c, d, e, f, g, h, i = (float(v) for v in values)

    return (a, b, c, d, e, f, g, h, i)


_MINIFYING = as_matrix(_GOLDEN["matrices"]["minifying"])
_MAGNIFYING = as_matrix(_GOLDEN["matrices"]["magnifying"])
_PARTLY_OUTSIDE = as_matrix(_GOLDEN["matrices"]["partlyOutside"])
_DEGENERATE = as_matrix(_GOLDEN["matrices"]["degenerate"])
_HALFWAY = as_matrix(_GOLDEN["matrices"]["halfway"])
_STRONGLY_MINIFYING = as_matrix(_GOLDEN["matrices"]["stronglyMinifying"])
_WARP_WIDTH = _GOLDEN["warpWidth"]
_WARP_HEIGHT = _GOLDEN["warpHeight"]


@pytest.mark.parametrize("key", ["shrink", "grow", "mixed", "strong"])
def test_resize_gray_is_bit_exact(key: str) -> None:
    """Shrinking, growing, and one call that does both at once.

    ``mixed`` is 20x90 from 64x48: the width shrinks and takes the area path
    while the height grows and takes the bilinear one, inside a single call.
    A port that picked one branch per CALL rather than per AXIS would pass the
    first two goldens and fail this one.

    ``strong`` is 9x48, and it is the only shape here that pins the area
    average's ACCUMULATION ORDER. Summing the overlap terms pairwise rather
    than left to right - exactly what ``np.sum`` would do - agrees with the
    loop at the four and five terms the other goldens produce; at the eight
    that 64 -> 9 produces it disagrees on 91 of 432 samples in float64, and one
    of those survives the narrowing to float32. The height stays at 48 on
    purpose: a second area pass down the columns averages that one sample away
    again, so 9x9 - the obvious choice - catches nothing.

    :param key: Which resize the golden holds.
    """
    expected = _GOLDEN["resizeGray"][key]
    resized = resize_gray(_GRAY, expected["width"], expected["height"])

    assert resized.width == expected["width"]
    assert resized.height == expected["height"]
    assert np.array_equal(resized.pixels.reshape(-1), as_float32(expected["data"]))


def test_resize_gray_to_the_same_size_copies() -> None:
    """The identity path returns equal pixels in a fresh array."""
    same = resize_gray(_GRAY, _GRAY.width, _GRAY.height)

    assert np.array_equal(same.pixels.reshape(-1), as_float32(_GOLDEN["resizeGray"]["identity"]))
    assert not np.shares_memory(same.pixels, _GRAY.pixels)


def test_resize_gray_rounds_between_the_two_passes() -> None:
    """The horizontal pass narrows to float32 before the vertical one reads it.

    Fusing the passes, or carrying float64 through, is the same mathematics and
    a different answer - so this asserts the intermediate is genuinely float32
    by reproducing the two passes explicitly and comparing.
    """
    expected = _GOLDEN["resizeGray"]["mixed"]
    horizontal = resize_gray(_GRAY, expected["width"], _GRAY.height)
    staged = resize_gray(horizontal, expected["width"], expected["height"])

    assert np.array_equal(staged.pixels.reshape(-1), as_float32(expected["data"]))


def test_downscale_gray_reports_the_realised_scale() -> None:
    """The factor is what the ROUNDED pixel counts imply, not what was asked for.

    64x48 capped at 20 asks for 0.3125 and gets exactly it here, but the
    contract is ``width / src.width`` after rounding, and a caller scaling
    recovered coordinates back up depends on that rather than on the request.
    """
    expected = _GOLDEN["downscaleGray"]["to20"]
    result = downscale_gray(_GRAY, 20)

    assert (result.image.width, result.image.height) == (expected["width"], expected["height"])
    assert result.scale == expected["scale"]
    assert np.array_equal(result.image.pixels.reshape(-1), as_float32(expected["data"]))


def test_downscale_gray_rounds_pixel_counts_the_way_javascript_does() -> None:
    """A source whose rounded width lands on a half, so both mutations show.

    40 wide capped at 20 of a 64-tall image asks for 12.5 columns. JavaScript
    rounds that to 13 and Python's built-in ``round`` to 12, so the shape alone
    separates them - and the realised scale is then 0.325 rather than the
    0.3125 that was requested, which separates a port reporting the request
    from one reporting what it actually did. Every other downscale golden here
    has those two numbers equal, so neither would be caught by them.
    """
    expected = _GOLDEN["downscaleGray"]["roundingSensitive"]
    source = resize_gray(_GRAY, expected["sourceWidth"], expected["sourceHeight"])
    result = downscale_gray(source, 20)

    assert (result.image.width, result.image.height) == (expected["width"], expected["height"])
    assert result.image.width == 13
    assert result.scale == expected["scale"] == 0.325
    assert np.array_equal(result.image.pixels.reshape(-1), as_float32(expected["data"]))


def test_downscale_gray_leaves_a_small_enough_image_alone() -> None:
    """Already within the cap: scale 1, pixels untouched, array not shared."""
    expected = _GOLDEN["downscaleGray"]["untouched"]
    result = downscale_gray(_GRAY, 1000)

    assert (result.image.width, result.image.height) == (expected["width"], expected["height"])
    assert result.scale == expected["scale"] == 1
    assert np.array_equal(result.image.pixels, _GRAY.pixels)
    assert not np.shares_memory(result.image.pixels, _GRAY.pixels)


@pytest.mark.parametrize(("radius", "key"), [(2, "radius2"), (0, "radius0")])
def test_box_blur_raster_is_bit_exact(radius: int, key: str) -> None:
    """Two sliding-window byte passes, including the radius-zero copy.

    :param radius: The blur radius.
    :param key: The golden holding that radius' result.
    """
    blurred = box_blur_raster(_PAGE, radius)

    assert list(blurred.pixels.reshape(-1)) == _GOLDEN["boxBlurRaster"][key]


def test_box_blur_raster_narrows_to_bytes_between_the_passes() -> None:
    """The vertical pass reads the horizontal pass' ROUNDED bytes.

    Keeping the intermediate in wider integers would lose the per-pass
    rounding, which on an 8-bit image is a whole level in places. Running the
    two passes as two separate radius-2 blurs of a one-dimensional strip is
    enough to show the intermediate is bytes: a strip one pixel tall has no
    vertical pass to speak of, so the result is the horizontal pass alone.
    """
    strip = Raster(_PAGE.pixels[:1, :, :].copy())
    once = box_blur_raster(strip, 2)

    assert once.pixels.dtype == np.uint8
    assert int(once.pixels.max()) <= 255


def test_sample_gray_bilinear_matches_at_every_pinned_position() -> None:
    """Interior, pixel centres, both clamped edges, and four outside.

    The golden carries each position twice - once with the default fill and
    once with -7 - so a port that returned 0 instead of the caller's fill would
    still match the first column and fail the second.
    """
    for u, v, default_fill, custom_fill in _GOLDEN["sampleGrayBilinear"]:
        assert sample_gray_bilinear(_GRAY, u, v) == default_fill, (u, v)
        assert sample_gray_bilinear(_GRAY, u, v, -7) == custom_fill, (u, v)


def test_sample_gray_bilinear_bounds_are_closed_at_minus_one_and_open_at_the_size() -> None:
    """``<= -1`` and ``>= width``, not ``<`` and ``>``.

    Exactly -1 and exactly the width are the two positions where this differs
    from :func:`warp_raster`'s bounds, which are the other way round. Both are
    in the goldens above; this states the rule so the next reader does not
    "unify" them.
    """
    assert sample_gray_bilinear(_GRAY, -1, 5, -7) == -7
    assert sample_gray_bilinear(_GRAY, _GRAY.width, 5, -7) == -7
    assert sample_gray_bilinear(_GRAY, -0.999, 5, -7) != -7
    assert sample_gray_bilinear(_GRAY, _GRAY.width - 0.001, 5, -7) != -7


@pytest.mark.parametrize(
    ("key", "matrix", "fill"),
    [
        ("minifying", "_MINIFYING", 0),
        ("partlyOutsideWithFill", "_PARTLY_OUTSIDE", 0.25),
        ("degenerateWithFill", "_DEGENERATE", 0.75),
    ],
)
def test_warp_gray_is_bit_exact(key: str, matrix: str, fill: float) -> None:
    """Interior sampling, the partly-outside fill, and the all-zero-``w`` case.

    :param key: The golden holding this warp.
    :param matrix: Name of the matrix module global to warp through.
    :param fill: The fill value that warp was given.
    """
    warped = warp_gray(_GRAY, globals()[matrix], _WARP_WIDTH, _WARP_HEIGHT, fill)

    assert np.array_equal(warped.pixels.reshape(-1), as_float32(_GOLDEN["warpGray"][key]))


def test_warp_gray_fill_actually_reaches_the_output() -> None:
    """540 of 1200 pixels, measured - not a fill path that never fires.

    The first version of these goldens used a matrix that kept every
    destination pixel inside the source, so both fill goldens pinned nothing at
    all. This asserts the input still has the property the golden needs.
    """
    warped = warp_gray(_GRAY, _PARTLY_OUTSIDE, _WARP_WIDTH, _WARP_HEIGHT, 0.25)
    filled = int(np.count_nonzero(warped.pixels == np.float32(0.25)))

    assert filled == 540
    assert filled < warped.pixels.size


@pytest.mark.parametrize(
    ("key", "matrix", "options"),
    [
        ("bilinear", "_MINIFYING", None),
        ("bilinearNoPrefilter", "_MINIFYING", WarpOptions(prefilter=False)),
        ("nearest", "_MAGNIFYING", WarpOptions(interpolation="nearest")),
        ("bicubic", "_MAGNIFYING", WarpOptions(interpolation="bicubic")),
        ("background", "_PARTLY_OUTSIDE", WarpOptions(background=(7, 11, 13, 17))),
        ("degenerate", "_DEGENERATE", WarpOptions(background=(7, 11, 13, 17))),
        ("nearestHalfway", "_HALFWAY", WarpOptions(interpolation="nearest")),
    ],
)
def test_warp_raster_is_bit_exact(key: str, matrix: str, options: WarpOptions | None) -> None:
    """All three interpolations, the prefilter on both sides, and the background.

    :param key: The golden holding this warp.
    :param matrix: Name of the matrix module global to warp through.
    :param options: The options that warp was given.
    """
    warped = warp_raster(_PAGE, globals()[matrix], _WARP_WIDTH, _WARP_HEIGHT, options)

    assert list(warped.pixels.reshape(-1)) == _GOLDEN["warpRaster"][key]


def test_the_prefilter_changes_the_result_it_is_supposed_to_change() -> None:
    """``sqrt(|det|) > 1.25`` fires for the minifying matrix and not the other.

    Without this the prefilter goldens would pass just as happily against a
    port that never blurred: the two bilinear goldens would simply be equal.
    """
    blurred = warp_raster(_PAGE, _MINIFYING, _WARP_WIDTH, _WARP_HEIGHT)
    sharp = warp_raster(_PAGE, _MINIFYING, _WARP_WIDTH, _WARP_HEIGHT, WarpOptions(prefilter=False))
    magnified = warp_raster(_PAGE, _MAGNIFYING, _WARP_WIDTH, _WARP_HEIGHT)
    magnified_sharp = warp_raster(
        _PAGE,
        _MAGNIFYING,
        _WARP_WIDTH,
        _WARP_HEIGHT,
        WarpOptions(prefilter=False),
    )

    assert not np.array_equal(blurred.pixels, sharp.pixels)
    assert np.array_equal(magnified.pixels, magnified_sharp.pixels)


def test_warp_raster_bounds_are_open_at_minus_one_and_closed_at_the_size() -> None:
    """The opposite of :func:`sample_gray_bilinear`'s, on purpose.

    A destination pixel landing exactly on ``u == width`` is SAMPLED here
    (clamped to the last column) and REJECTED by the gray sampler. Built as a
    pure translation so the mapped coordinate is exact rather than nearly so.
    """
    source = Raster(np.full((4, 4, _RGBA), 200, dtype=np.uint8))
    at_edge: Matrix3 = (1.0, 0.0, 4.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0)
    options = WarpOptions(background=(1, 2, 3, 4), prefilter=False)
    warped = warp_raster(source, at_edge, 1, 1, options)

    assert list(warped.pixels.reshape(-1)) == [200, 200, 200, 200]
    assert sample_gray_bilinear(GrayImage(np.full((4, 4), 0.5, np.float32)), 4.0, 0.5, -7) == -7


def test_nearest_rounds_the_sample_index_the_way_javascript_does() -> None:
    """``nearestHalfway`` puts every ``u`` on exactly ``x + 0.5``.

    That is the one place ``Math.round`` and numpy's ``rint`` part company:
    rint rounds half to EVEN, so it picks a different source column for every
    even x and the same one for every odd x. Half a warp, shifted by a pixel,
    and it never looks wrong.
    """
    warped = warp_raster(
        _PAGE,
        _HALFWAY,
        _WARP_WIDTH,
        _WARP_HEIGHT,
        WarpOptions(interpolation="nearest"),
    )
    # The matrix is a pure half-pixel translation, so `u` really is `x + 0.5`
    # at every column rather than merely close to it.
    m0, m1, m2 = _HALFWAY[0], _HALFWAY[1], _HALFWAY[2]

    assert (m0, m1, m2) == (1.0, 0.0, 0.5)
    assert list(warped.pixels.reshape(-1)) == _GOLDEN["warpRaster"]["nearestHalfway"]


def test_the_prefilter_radius_is_half_of_scale_minus_one() -> None:
    """``sqrt(|det|)`` of 4 gives ``round(1.5) = 2``, not ``round(3) = 3``.

    Every other warp golden here has a scale close enough to 1 that both
    expressions round to the same radius, so they pin the prefilter fires
    without pinning how hard.
    """
    expected = _GOLDEN["warpRaster"]["stronglyMinifying"]
    warped = warp_raster(_PAGE, _STRONGLY_MINIFYING, expected["width"], expected["height"])

    assert list(warped.pixels.reshape(-1)) == expected["data"]
