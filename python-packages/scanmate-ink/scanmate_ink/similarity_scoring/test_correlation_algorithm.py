"""The referee, measured against the TypeScript.

Exact, with ``==``. Every value here is one division of two sequentially
accumulated sums, plus a ``sqrt`` that IEEE-754 requires to be correctly
rounded, so there is nothing left to be approximately right about.

The pairs span the range deliberately rather than looking plausible: a
self-correlation that must be exactly 1, an inverted image that lands at
-0.9999999999999981 rather than -1 (the float32 store of ``1 - x`` is what
costs those last bits), a flat image with no variance at all, and genuinely
different images in between. The second operands are rebuilt here and then
checked against the goldens' own copies, so a mismatch reports itself as a bad
operand rather than as a bad correlation.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from ..deterministic_sampling import create_random
from ..geometric_transform import warp_gray
from ..ink_separation import binarize, box_blur, dilate, ink_map, to_grayscale
from ..js_semantics import sequential_total
from ..plane_geometry import Matrix3
from ..raster_codec import BinaryImage, GrayImage, Raster, create_raster
from .correlation_algorithm import correlation, intersection_over_union, mean

_PARITY = Path(__file__).parents[4] / "tools" / "parity"
_GOLDEN = json.loads((_PARITY / "goldens" / "similarity-scoring.json").read_text(encoding="utf-8"))
_INK = json.loads((_PARITY / "goldens" / "ink-separation.json").read_text(encoding="utf-8"))
_TRANSFORM = json.loads(
    (_PARITY / "goldens" / "geometric-transform.json").read_text(encoding="utf-8"),
)

_WIDTH = _INK["width"]
_HEIGHT = _INK["height"]
_RGBA = 4
_BYTE_STATES = 256


def build_page() -> Raster:
    """Rebuild the page ``tools/parity`` fed to the TypeScript.

    :returns: The raster, byte for byte.
    """
    page = create_raster(_WIDTH, _HEIGHT)
    random = create_random(_INK["seed"])
    every = _INK["alphaEvery"]

    flat = page.pixels.reshape(-1)
    for offset in range(0, flat.size, _RGBA):
        flat[offset] = math.floor(random() * _BYTE_STATES)
        flat[offset + 1] = math.floor(random() * _BYTE_STATES)
        flat[offset + 2] = math.floor(random() * _BYTE_STATES)
        flat[offset + 3] = 128 if offset % every == 0 else 255

    return page


def as_matrix(values: list[float]) -> Matrix3:
    """Read nine JSON numbers as a matrix.

    :param values: The golden's nine numbers.
    :returns: The matrix.
    """
    a, b, c, d, e, f, g, h, i = (float(v) for v in values)

    return (a, b, c, d, e, f, g, h, i)


_PAGE = build_page()
_GRAY = to_grayscale(_PAGE)
_INK_MAP = ink_map(_GRAY)
_MASK = binarize(_INK_MAP)

_INVERTED = GrayImage((1 - _GRAY.pixels.astype(np.float64)).astype(np.float32))
_FLAT = GrayImage(np.full((_HEIGHT, _WIDTH), 0.5, dtype=np.float32))
_BLURRED = box_blur(_GRAY, 3)
_WARPED = warp_gray(_GRAY, as_matrix(_TRANSFORM["matrices"]["minifying"]), _WIDTH, _HEIGHT)
_EMPTY_GRAY = GrayImage(np.zeros((0, 0), dtype=np.float32))
_NEAR_FLAT = GrayImage(np.full((_HEIGHT, _WIDTH), 0.5, dtype=np.float32))
_NEAR_FLAT.pixels.reshape(-1)[0] = np.float32(0.5) + np.float32(2.0**-24)

_DILATED = dilate(_MASK, 2)
_INVERTED_MASK = BinaryImage((1 - _MASK.pixels).astype(np.uint8))
_EMPTY_MASK = BinaryImage(np.zeros((_HEIGHT, _WIDTH), dtype=np.uint8))


def as_float32(values: list[float]) -> np.ndarray:
    """Narrow the golden's decimals back to the float32 values they were stored as.

    :param values: The golden numbers.
    :returns: A flat float32 array.
    """
    return np.asarray(values, dtype=np.float64).astype(np.float32)


@pytest.mark.parametrize(
    ("key", "image"),
    [
        ("inverted", "_INVERTED"),
        ("blurred", "_BLURRED"),
        ("warped", "_WARPED"),
        ("nearFlat", "_NEAR_FLAT"),
    ],
)
def test_the_second_operands_match_before_anything_is_scored(key: str, image: str) -> None:
    """A score is only evidence if both sides of it are the right image.

    Without this a divergence in ``box_blur`` or ``warp_gray`` would surface
    here as a correlation that is subtly wrong, and be blamed on this slice.

    :param key: The operand the golden holds.
    :param image: Name of the module global holding this port's version.
    """
    built: GrayImage = globals()[image]

    assert np.array_equal(built.pixels.reshape(-1), as_float32(_GOLDEN["operands"][key]))


def test_the_dilated_mask_matches_before_anything_is_scored() -> None:
    """The same check for the one integer operand."""
    assert list(_DILATED.pixels.reshape(-1)) == _GOLDEN["operands"]["dilated"]


@pytest.mark.parametrize(
    ("key", "first", "second"),
    [
        ("selfSame", "_GRAY", "_GRAY"),
        ("inverted", "_GRAY", "_INVERTED"),
        ("blurred", "_GRAY", "_BLURRED"),
        ("ink", "_GRAY", "_INK_MAP"),
        ("warped", "_GRAY", "_WARPED"),
        ("flatSecond", "_GRAY", "_FLAT"),
        ("inkBlurred", "_INK_MAP", "_BLURRED"),
        ("invertedInk", "_INVERTED", "_INK_MAP"),
        ("blurredWarp", "_BLURRED", "_WARPED"),
        ("nearFlatSelf", "_NEAR_FLAT", "_NEAR_FLAT"),
        ("flatBoth", "_FLAT", "_FLAT"),
        ("empty", "_EMPTY_GRAY", "_EMPTY_GRAY"),
    ],
)
def test_correlation_is_bit_exact(key: str, first: str, second: str) -> None:
    """Perfect, perfectly anti-, decorrelated, degenerate and empty.

    :param key: The score the golden holds.
    :param first: Name of the module global for the first image.
    :param second: Name of the module global for the second.
    """
    assert correlation(globals()[first], globals()[second]) == _GOLDEN["correlation"][key]


def test_a_perfect_match_is_exactly_one_and_an_inversion_is_not_exactly_minus_one() -> None:
    """The asymmetry is real, and it is the float32 store that causes it.

    ``correlation(x, x)`` divides a number by itself and is exactly 1.
    ``1 - x`` narrowed back to float32 is not exactly the negation of ``x``
    about its mean, so the inverse lands 19 ULP short of -1. A port that
    rounded either to a tidy value would be hiding a real property.
    """
    assert correlation(_GRAY, _GRAY) == 1
    assert correlation(_GRAY, _INVERTED) == -0.9999999999999981
    assert correlation(_GRAY, _INVERTED) != -1


def test_the_variance_floor_is_a_floor_and_not_a_zero_test() -> None:
    """An image that varies by one float32 step still scores zero.

    ``_NEAR_FLAT`` is 0.5 everywhere but one pixel, and its variance is
    3.55e-15 - nonzero, so a plain ``denom > 0`` guard lets it through and
    reports a perfect correlation of 1 between two images that carry no signal
    at all. The 1e-12 floor is what stops that, and this is the only input here
    that can tell the two apart: every other degenerate case has a variance of
    exactly zero.
    """
    variance = _NEAR_FLAT.pixels.astype(np.float64).reshape(-1)
    centred = variance - variance.sum() / variance.size

    assert 0 < float((centred * centred).sum()) < 1e-12
    assert correlation(_NEAR_FLAT, _NEAR_FLAT) == 0


def test_the_denominator_is_one_square_root_and_not_two() -> None:
    """``sqrt(var_a * var_b)``, never ``sqrt(var_a) * sqrt(var_b)``.

    The two differ on about a third of random variance pairs, so this is not a
    subtle risk - and yet six of the eight pairs in the goldens agree under
    both forms. Measured: only ``invertedInk`` and ``blurredWarp`` separate
    them, which is why those two pairs are in the goldens at all. This states
    the property they carry, so neither is removed as redundant later.
    """
    values_a = _INVERTED.pixels.astype(np.float64).reshape(-1)
    values_b = _INK_MAP.pixels.astype(np.float64).reshape(-1)
    da = values_a - mean(_INVERTED)
    db = values_b - mean(_INK_MAP)
    var_a = sequential_total(da * da)
    var_b = sequential_total(db * db)

    assert math.sqrt(var_a * var_b) != math.sqrt(var_a) * math.sqrt(var_b)


def correlation_with_pairwise_sums(a: GrayImage, b: GrayImage) -> float:
    """The same correlation, reduced with ``np.sum`` instead of in running order.

    Kept here as the thing the shipped version must NOT be. It is the obvious
    way to write this in numpy, it is more accurate, and it is a different
    answer.

    :param a: The first image.
    :param b: The second image.
    :returns: The pairwise-reduced correlation.
    """
    values_a = a.pixels.astype(np.float64).reshape(-1)
    values_b = b.pixels.astype(np.float64).reshape(-1)
    da = values_a - values_a.sum() / values_a.size
    db = values_b - values_b.sum() / values_b.size

    return float((da * db).sum() / math.sqrt((da * da).sum() * (db * db).sum()))


def test_correlation_accumulates_in_running_order() -> None:
    """Pinned against a literal transcription of the TypeScript's own loops.

    Measured rather than assumed, because the two reductions do NOT always
    differ: across the five pairs in the goldens the means agree exactly every
    time, and it is the covariance and variance sums that part company - on
    three of the five, by up to 4.11e-15. So this pins the pair where the
    difference is largest, and asserts both directions of it.
    """
    values_a = _GRAY.pixels.astype(np.float64).reshape(-1)
    values_b = _INK_MAP.pixels.astype(np.float64).reshape(-1)

    running_a = running_b = 0.0
    for value in values_a:
        running_a += float(value)
    for value in values_b:
        running_b += float(value)
    mean_a = running_a / values_a.size
    mean_b = running_b / values_b.size

    cov = var_a = var_b = 0.0
    for left, right in zip(values_a, values_b, strict=True):
        da, db = float(left) - mean_a, float(right) - mean_b
        cov += da * db
        var_a += da * da
        var_b += db * db

    assert cov / math.sqrt(var_a * var_b) == correlation(_GRAY, _INK_MAP)
    assert correlation_with_pairwise_sums(_GRAY, _INK_MAP) != correlation(_GRAY, _INK_MAP)
    assert correlation_with_pairwise_sums(_GRAY, _INK_MAP) != _GOLDEN["correlation"]["ink"]


def test_the_means_alone_would_not_have_caught_the_reduction() -> None:
    """Why the covariance pair above is the one that is pinned.

    ``mean`` is a single sum over the same 3072 values, and for every image in
    these goldens the running order and the pairwise reduction give bit-identical
    answers. A test built on ``mean`` would therefore have passed against a port
    that reduced pairwise throughout.
    """
    for image in (_GRAY, _INK_MAP, _INVERTED, _FLAT):
        values = image.pixels.astype(np.float64).reshape(-1)

        assert mean(image) == float(values.sum()) / values.size


@pytest.mark.parametrize(
    ("key", "first", "second"),
    [
        ("selfSame", "_MASK", "_MASK"),
        ("dilated", "_MASK", "_DILATED"),
        ("inverted", "_MASK", "_INVERTED_MASK"),
        ("empty", "_EMPTY_MASK", "_EMPTY_MASK"),
        ("maskOnly", "_MASK", "_EMPTY_MASK"),
    ],
)
def test_intersection_over_union_is_bit_exact(key: str, first: str, second: str) -> None:
    """Identical, grown, disjoint, both empty, and one empty.

    :param key: The score the golden holds.
    :param first: Name of the module global for the first mask.
    :param second: Name of the module global for the second.
    """
    scored = intersection_over_union(globals()[first], globals()[second])

    assert scored == _GOLDEN["intersectionOverUnion"][key]


def test_intersection_over_union_separates_disjoint_from_empty() -> None:
    """Both return 0, and only one of them is a real answer.

    A mask against its own inverse has a full union and no intersection, which
    is a genuine score of zero. Two empty masks have no union at all, and the
    zero is the guard against dividing by it. A port that returned the guard's
    zero for both would match every golden above.
    """
    assert intersection_over_union(_MASK, _INVERTED_MASK) == 0
    assert int(np.bitwise_or(_MASK.pixels, _INVERTED_MASK.pixels).sum()) == _MASK.pixels.size
    assert intersection_over_union(_EMPTY_MASK, _EMPTY_MASK) == 0
    assert int(np.bitwise_or(_EMPTY_MASK.pixels, _EMPTY_MASK.pixels).sum()) == 0


@pytest.mark.parametrize(
    ("key", "image"),
    [
        ("gray", "_GRAY"),
        ("ink", "_INK_MAP"),
        ("inverted", "_INVERTED"),
        ("flat", "_FLAT"),
        ("nearFlat", "_NEAR_FLAT"),
        ("empty", "_EMPTY_GRAY"),
    ],
)
def test_mean_is_bit_exact(key: str, image: str) -> None:
    """:param key: The mean the golden holds.
    :param image: Name of the module global holding the image.
    """
    assert mean(globals()[image]) == _GOLDEN["mean"][key]


def test_the_means_of_an_image_and_its_inverse_do_not_quite_sum_to_one() -> None:
    """0.5039972927382527 and 0.4960027071647346 sum to 0.9999999999029873.

    Same cause as the inverted correlation: ``1 - x`` stored back through
    float32. Pinned because it is exactly the kind of near-miss a reader would
    "fix", and the fix would be a port that no longer matches.
    """
    total = mean(_GRAY) + mean(_INVERTED)

    assert total != 1
    assert total == pytest.approx(1, abs=1e-9)


@pytest.mark.parametrize(
    ("scorer", "first", "second", "message"),
    [
        (correlation, "_GRAY", "_BLURRED", "same size"),
        (intersection_over_union, "_MASK", "_DILATED", "same size"),
    ],
)
def test_mismatched_sizes_are_rejected(
    scorer: object,
    first: str,
    second: str,
    message: str,
) -> None:
    """Scoring two different-sized images is a caller bug, not a low score.

    :param scorer: The function under test.
    :param first: Name of the module global for the correctly sized operand.
    :param second: Name of the module global whose size is then changed.
    :param message: Substring the error must carry.
    """
    ok = globals()[first]
    narrower = type(ok)(globals()[second].pixels[:, :10])
    shorter = type(ok)(globals()[second].pixels[:10, :])

    # Both axes separately: a check that compared only the width would pass the
    # second of these, and `shorter` is the operand that catches it.
    with pytest.raises(ValueError, match=message):
        scorer(ok, narrower)  # type: ignore[operator]

    with pytest.raises(ValueError, match=message):
        scorer(ok, shorter)  # type: ignore[operator]
