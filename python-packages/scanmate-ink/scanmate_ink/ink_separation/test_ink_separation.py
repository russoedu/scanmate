"""Ink separation, measured against the TypeScript.

EVERY ASSERTION HERE IS EXACT, AND THAT IS THE POINT
----------------------------------------------------

Nothing in this slice reaches for a transcendental. Every stage is additions,
multiplications, divisions and comparisons, so a faithful transcription is
bit-exact and ``==`` is the honest bar. Where the TypeScript stores into a
``Float32Array`` the Python stores into float32 too, so "bit-exact" includes
the rounding on store - which is the part a port gets wrong by letting numpy
carry float32 through the arithmetic instead of only at the end.

The page is REBUILT from the seed rather than loaded from the goldens, so the
input is derived rather than copied. It is the same page ``tools/parity``
builds, with alpha varied every 37th pixel so that compositing over white is
actually exercised rather than multiplied by one. If the rebuild were wrong,
:func:`test_to_grayscale_is_bit_exact` is the first thing that would fail, and
every later assertion would fail with it.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from ..deterministic_sampling import create_random
from ..js_semantics import js_round
from ..raster_codec import BinaryImage, GrayImage, Raster, create_raster
from .ink_map_algorithm import box_blur, gray_to_raster, ink_map, integral_image, to_grayscale
from .ink_mask_algorithm import binarize, coverage, dilate, otsu_threshold

_GOLDEN = json.loads(
    (Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "ink-separation.json").read_text(
        encoding="utf-8",
    ),
)

_WIDTH = _GOLDEN["width"]
_HEIGHT = _GOLDEN["height"]
_BYTE_STATES = 256
_RGBA = 4


def build_page() -> Raster:
    """Rebuild the exact page ``tools/parity`` fed to the TypeScript.

    :returns: The raster, byte for byte.
    """
    page = create_raster(_WIDTH, _HEIGHT)
    random = create_random(_GOLDEN["seed"])
    every = _GOLDEN["alphaEvery"]

    flat = page.pixels.reshape(-1)
    for offset in range(0, flat.size, _RGBA):
        flat[offset] = math.floor(random() * _BYTE_STATES)
        flat[offset + 1] = math.floor(random() * _BYTE_STATES)
        flat[offset + 2] = math.floor(random() * _BYTE_STATES)
        flat[offset + 3] = 128 if offset % every == 0 else 255

    return page


_PAGE = build_page()
_GRAY = to_grayscale(_PAGE)
_INK = ink_map(_GRAY)
_MASK = binarize(_INK)


def as_float32(values: list[float]) -> np.ndarray:
    """Read the golden's decimals back as the float32 values they were stored as.

    JSON carries the shortest decimal that round-trips the float32 through a
    double, so parsing to float64 and narrowing recovers the original bits.

    :param values: The golden numbers.
    :returns: A flat float32 array.
    """
    return np.asarray(values, dtype=np.float64).astype(np.float32)


def test_to_grayscale_is_bit_exact() -> None:
    """Rec. 601 over white, stored as float32."""
    assert np.array_equal(_GRAY.pixels.reshape(-1), as_float32(_GOLDEN["gray"]))


def test_gray_to_raster_is_bit_exact() -> None:
    """The clamped, half-to-even store a ``Uint8ClampedArray`` performs."""
    rendered = gray_to_raster(_GRAY)

    assert list(rendered.pixels.reshape(-1)) == _GOLDEN["grayToRaster"]


def integral_image_literally(image: GrayImage) -> np.ndarray:
    """The TypeScript's own loops, transcribed line for line and run in Python.

    The shipped :func:`integral_image` is two ``cumsum`` calls, which is the
    same arithmetic only if they accumulate in the same ORDER. This is the
    reference that claim is checked against - slow, obviously equivalent to the
    TypeScript, and never used outside these tests.

    :param image: The single-channel image.
    :returns: The summed-area table, as a ``(height + 1, width + 1)`` array.
    """
    width, height = image.width, image.height
    data = image.pixels.astype(np.float64)
    table = np.zeros((height + 1, width + 1), dtype=np.float64)

    for y in range(height):
        row_sum = 0.0
        for x in range(width):
            row_sum += float(data[y, x])
            table[y + 1, x + 1] = table[y, x + 1] + row_sum

    return table


def test_integral_image_is_bit_exact() -> None:
    """Float64 running sums, row by row."""
    assert integral_image(_GRAY).tolist() == _GOLDEN["integral"]


def test_integral_image_accumulates_rows_before_columns() -> None:
    """Summing columns first is the same mathematics and a different answer.

    Floating-point addition is not associative, so ``sum over y of (sum over
    x)`` and ``sum over x of (sum over y)`` are two different operations. On
    the golden page they agree to the last bit, which means the golden above
    does NOT pin the order - measured, by swapping the two ``cumsum`` axes and
    watching all 17 tests stay green.

    This input is built so that the orders genuinely diverge: the top row
    cancels to zero exactly, while summing down the columns first destroys the
    ones below it. Row-first gives 2, column-first gives 0.
    """
    big = np.float32(1e16)
    sensitive = GrayImage(np.array([[big, -big], [1, 1]], dtype=np.float32))
    table = integral_image(sensitive).reshape(3, 3)

    assert table[2, 2] == 2
    assert np.array_equal(table, integral_image_literally(sensitive))
    assert np.array_equal(
        integral_image(_GRAY).reshape(_HEIGHT + 1, _WIDTH + 1),
        integral_image_literally(_GRAY),
    )


@pytest.mark.parametrize(("radius", "key"), [(3, "boxBlurRadius3"), (0, "boxBlurRadius0")])
def test_box_blur_is_bit_exact(radius: int, key: str) -> None:
    """Both the real blur and the radius-zero identity path.

    :param radius: The blur radius.
    :param key: The golden holding that radius' result.
    """
    blurred = box_blur(_GRAY, radius)

    assert np.array_equal(blurred.pixels.reshape(-1), as_float32(_GOLDEN[key]))


def test_box_blur_rounds_its_radius_the_way_javascript_does() -> None:
    """``Math.round(0.5)`` is 1; Python's ``round(0.5)`` is 0.

    A radius of 0.5 therefore blurs in the TypeScript and would be a no-op
    under the built-in rounding. Every golden above would still pass.
    """
    half = box_blur(_GRAY, 0.5)

    assert not np.array_equal(half.pixels, _GRAY.pixels)
    assert np.array_equal(half.pixels, box_blur(_GRAY, 1).pixels)


def test_ink_map_is_bit_exact() -> None:
    """Background division, inversion and the noise floor."""
    assert np.array_equal(_INK.pixels.reshape(-1), as_float32(_GOLDEN["inkMap"]))


def test_otsu_threshold_is_bit_exact() -> None:
    """The cut, to the last bit - it is a bin index divided by 255."""
    assert otsu_threshold(_INK) == _GOLDEN["otsuThreshold"]


def test_no_in_range_value_can_land_on_a_bin_boundary() -> None:
    """The measurement behind :func:`otsu_threshold` NOT needing JavaScript rounding.

    Otsu bins with ``js_round`` because that is what the TypeScript does, but
    the choice is unobservable: swept over every float32 in ``[0, 1]``, the
    only product ``value * 255`` landing exactly on a half-integer is 127.5,
    and its floor is odd, so round-half-to-even picks 128 as well.

    Sampled rather than swept here - a billion-value sweep does not belong in a
    unit test - but it is the same claim, and it is the reason this file does
    not carry a test pretending the rounding is load-bearing in Otsu. It is
    load-bearing for a RADIUS, which is what
    :func:`test_box_blur_rounds_its_radius_the_way_javascript_does` pins.
    """
    bits = np.linspace(0, 1, num=100_003, dtype=np.float32).astype(np.float64)
    products = bits * 255
    boundaries = products[products * 2 == np.floor(products * 2)]
    half_integers = boundaries[boundaries != np.floor(boundaries)]

    assert set(half_integers.tolist()) <= {127.5}
    assert js_round(127.5) == round(127.5)


def test_binarize_excludes_a_pixel_sitting_exactly_on_the_threshold() -> None:
    """``> t``, not ``>= t``.

    Unreachable through Otsu - its cut is always ``bin / 255`` with an odd
    denominator, which no float32 ink value equals exactly - but an explicit
    threshold reaches it in one line, and the two comparisons then disagree.
    """
    image = GrayImage(np.array([[0.5, 0.5000001]], dtype=np.float32))

    assert list(binarize(image, 0.5).pixels.reshape(-1)) == [0, 1]


def test_otsu_keeps_the_earliest_bin_of_a_tie() -> None:
    """Empty bins produce genuine ties, and the earliest one wins.

    Between-class variance cannot change across a bin no pixel fell into:
    neither the background weight nor its sum moves. So any histogram with a
    gap - which is most real pages - ties over the whole gap, and ``>`` versus
    ``>=`` decides whether the cut lands at the bottom of the gap or the top.
    Here that is bin 10 against bin 199.
    """
    image = GrayImage(np.array([[10 / 255] * 3 + [200 / 255] * 5], dtype=np.float32))

    assert otsu_threshold(image) == 10 / 255


def test_binarize_is_bit_exact() -> None:
    """The mask, including the blank-page floor Otsu is clamped to."""
    assert list(_MASK.pixels.reshape(-1)) == _GOLDEN["binarize"]


def test_binarize_honours_an_explicit_zero_threshold() -> None:
    """``threshold ?? otsu`` is nullish, not falsy, so an explicit 0 is a value.

    It still meets the 0.12 floor, which is what makes this measurable: passing
    0 must produce the floor's mask, not Otsu's.
    """
    explicit = binarize(_INK, 0)

    assert np.array_equal(explicit.pixels, binarize(_INK, 0.12).pixels)
    assert not np.array_equal(explicit.pixels, _MASK.pixels)


def test_dilate_is_bit_exact() -> None:
    """The prefix-sum passes agree with the TypeScript's literal window scans."""
    grown = dilate(_MASK, 2)

    assert list(grown.pixels.reshape(-1)) == _GOLDEN["dilateRadius2"]


def test_dilate_radius_zero_copies_rather_than_aliases() -> None:
    """The TypeScript returns a fresh array; a view would let a caller corrupt
    the source mask through the result.
    """
    grown = dilate(_MASK, 0)

    assert np.array_equal(grown.pixels, _MASK.pixels)
    assert not np.shares_memory(grown.pixels, _MASK.pixels)


def test_dilate_grows_in_both_directions() -> None:
    """One lit pixel becomes a full square, not a cross.

    Two 1D passes are a square dilation only if the second reads the FIRST
    pass' output. Reading the original mask again gives a plus sign - and on a
    mask as dense as the golden's, the two look almost identical.
    """
    pixels = np.zeros((5, 5), dtype=np.uint8)
    pixels[2, 2] = 1
    grown = dilate(BinaryImage(pixels), 1)

    assert int(grown.pixels.sum()) == 9
    assert int(grown.pixels[1:4, 1:4].sum()) == 9


def test_coverage_over_the_whole_mask() -> None:
    """Coverage with no rectangle."""
    assert coverage(_MASK) == _GOLDEN["coverageAll"]


def test_coverage_over_a_fractional_window() -> None:
    """The window snaps outwards - floor on the near edge, ceil on the far one."""
    assert coverage(_MASK, 5.4, 6.7, 40.2, 30.9) == _GOLDEN["coverageWindow"]


def test_coverage_of_an_empty_rectangle_is_zero() -> None:
    """An empty or inverted window is 0, not a division by zero."""
    assert coverage(_MASK, 10, 10, 10, 20) == 0
    assert coverage(_MASK, 10, 10, 5, 20) == 0
