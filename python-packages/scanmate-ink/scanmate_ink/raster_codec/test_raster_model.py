"""The image shapes, and the one place this port deliberately differs.

The TypeScript stores ``width`` and ``height`` beside a flat typed array, so a
raster can exist whose ``data`` length disagrees with its dimensions - which is
part of why ``isRaster`` checks ``byteLength === width * height * 4`` there.
Here the pixels are a numpy array and the dimensions are read from its shape,
so that disagreement is unrepresentable. These tests pin the properties that
survive the change, not the representation.
"""

from __future__ import annotations

import numpy as np
import pytest

from .raster_model import (
    clone_raster,
    create_binary,
    create_gray,
    create_raster,
    is_raster,
    to_bytes,
)


class TestCreateRaster:
    def test_is_opaque_white_by_default(self) -> None:
        raster = create_raster(3, 2)

        assert raster.width == 3
        assert raster.height == 2
        assert raster.pixels.shape == (2, 3, 4)
        assert raster.pixels.dtype == np.uint8
        assert np.all(raster.pixels == 255)

    def test_honours_an_explicit_fill(self) -> None:
        raster = create_raster(2, 2, (10, 20, 30, 40))

        assert np.array_equal(raster.pixels[0, 0], np.array([10, 20, 30, 40], dtype=np.uint8))

    @pytest.mark.parametrize(("width", "height"), [(0, 5), (5, 0), (-1, 5), (5, -1)])
    def test_rejects_non_positive_dimensions(self, width: int, height: int) -> None:
        with pytest.raises(ValueError, match="positive integers"):
            create_raster(width, height)


def test_create_gray_is_float32_and_zeroed() -> None:
    """Float, not byte: the pipeline divides by an estimated background and then
    correlates, and doing that in 8 bits throws away the faint strokes OCR
    cares about.
    """
    gray = create_gray(4, 3)

    assert gray.pixels.shape == (3, 4)
    assert gray.pixels.dtype == np.float32
    assert not gray.pixels.any()


def test_create_binary_is_uint8_and_zeroed() -> None:
    binary = create_binary(4, 3)

    assert binary.pixels.shape == (3, 4)
    assert binary.pixels.dtype == np.uint8
    assert not binary.pixels.any()


def test_clone_raster_is_independent() -> None:
    """A shallow copy here would make every downstream stage a mutation bug."""
    original = create_raster(2, 2)
    copy = clone_raster(original)
    copy.pixels[0, 0, 0] = 7

    assert original.pixels[0, 0, 0] == 255


class TestIsRaster:
    def test_accepts_a_real_raster(self) -> None:
        assert is_raster(create_raster(2, 2))

    def test_accepts_a_structurally_identical_stand_in(self) -> None:
        """Structural, not ``isinstance``: a caller should be able to hand over
        something they built themselves without importing anything from here.
        """

        class Elsewhere:
            pixels = np.zeros((2, 2, 4), dtype=np.uint8)

        assert is_raster(Elsewhere())

    @pytest.mark.parametrize(
        "value",
        [
            None,
            object(),
            np.zeros((2, 2, 4), dtype=np.uint8),  # the array itself, not a wrapper
        ],
    )
    def test_rejects_what_is_not_one(self, value: object) -> None:
        assert not is_raster(value)

    def test_rejects_the_right_shape_in_the_wrong_dtype(self) -> None:
        """float32 RGBA is a plausible mistake and is not a raster."""

        class Floaty:
            pixels = np.zeros((2, 2, 4), dtype=np.float32)

        assert not is_raster(Floaty())

    def test_rejects_three_channels(self) -> None:
        """RGB, not RGBA - the shape a caller gets from a JPEG if they skip the convert."""

        class Rgb:
            pixels = np.zeros((2, 2, 3), dtype=np.uint8)

        assert not is_raster(Rgb())


class TestToBytes:
    def test_returns_none_for_an_already_decoded_raster(self) -> None:
        assert to_bytes(create_raster(2, 2)) is None

    @pytest.mark.parametrize("source", [b"\x89PNG", bytearray(b"\x89PNG"), memoryview(b"\x89PNG")])
    def test_accepts_every_bytes_like_shape(self, source: object) -> None:
        assert to_bytes(source) == b"\x89PNG"

    def test_refuses_a_path_rather_than_reading_it(self) -> None:
        """The codec opens paths itself, so a path arriving here is a mistake
        worth naming rather than silently working.
        """
        with pytest.raises(TypeError, match="codec opens paths itself"):
            to_bytes("page.png")

    def test_refuses_anything_else(self) -> None:
        with pytest.raises(TypeError, match="expected a Raster"):
            to_bytes(42)
