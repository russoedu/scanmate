"""Core data types.

Everything in this library speaks two image shapes and nothing else:

- :class:`Raster` - what you get in and out: 8-bit RGBA, the layout a canvas
  ``ImageData`` uses, so it needs no conversion to be re-encoded, handed to an
  OCR engine, or drawn.
- :class:`GrayImage` - what the algorithms work on: one float per pixel. Float,
  not byte, because the pipeline divides by an estimated background and then
  correlates the result; doing that in 8 bits throws away the faint strokes
  that OCR cares about.

The TypeScript carries ``width``, ``height`` and a flat typed array. Here the
pixels are a numpy array shaped ``(height, width, 4)``, and ``width`` and
``height`` are READ from it rather than stored beside it. Storing them twice is
storing a disagreement: the TypeScript can hand out a raster whose ``data``
length no longer matches its dimensions, and ``is_raster`` there exists partly
to catch exactly that. Shape is the single source of truth here, so the
inconsistency is unrepresentable.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import numpy.typing as npt

_RGBA_CHANNELS = 4


def _assert_dimensions(width: int, height: int) -> None:
    """Reject anything that is not a positive integer pair.

    :param width: Candidate width.
    :param height: Candidate height.
    :raises ValueError: When either is not a positive integer.
    """
    if not isinstance(width, int) or not isinstance(height, int) or width <= 0 or height <= 0:
        message = f"image dimensions must be positive integers, got {width}x{height}"
        raise ValueError(message)


@dataclass(frozen=True, slots=True)
class Raster:
    """A decoded image: 8-bit RGBA, ``(height, width, 4)``."""

    pixels: npt.NDArray[np.uint8]

    @property
    def width(self) -> int:
        """:returns: The image width in pixels."""
        return int(self.pixels.shape[1])

    @property
    def height(self) -> int:
        """:returns: The image height in pixels."""
        return int(self.pixels.shape[0])


@dataclass(frozen=True, slots=True)
class GrayImage:
    """A single-channel image, ``(height, width)`` float32.

    Values are normally in ``[0, 1]`` but are not clamped.
    """

    pixels: npt.NDArray[np.float32]

    @property
    def width(self) -> int:
        """:returns: The image width in pixels."""
        return int(self.pixels.shape[1])

    @property
    def height(self) -> int:
        """:returns: The image height in pixels."""
        return int(self.pixels.shape[0])


@dataclass(frozen=True, slots=True)
class BinaryImage:
    """A single-channel mask, ``(height, width)`` uint8. Every value is exactly 0 or 1."""

    pixels: npt.NDArray[np.uint8]

    @property
    def width(self) -> int:
        """:returns: The image width in pixels."""
        return int(self.pixels.shape[1])

    @property
    def height(self) -> int:
        """:returns: The image height in pixels."""
        return int(self.pixels.shape[0])


def create_raster(
    width: int,
    height: int,
    fill: tuple[int, int, int, int] = (255, 255, 255, 255),
) -> Raster:
    """Allocate an opaque RGBA raster, filled with ``fill`` (white by default).

    :param width: Width in pixels.
    :param height: Height in pixels.
    :param fill: The RGBA value every pixel starts at.
    :returns: The new raster.
    :raises ValueError: When the dimensions are not positive integers.
    """
    _assert_dimensions(width, height)
    pixels = np.empty((height, width, _RGBA_CHANNELS), dtype=np.uint8)
    pixels[:, :] = fill

    return Raster(pixels)


def create_gray(width: int, height: int) -> GrayImage:
    """Allocate a zeroed single-channel float image.

    :param width: Width in pixels.
    :param height: Height in pixels.
    :returns: The new image.
    :raises ValueError: When the dimensions are not positive integers.
    """
    _assert_dimensions(width, height)

    return GrayImage(np.zeros((height, width), dtype=np.float32))


def create_binary(width: int, height: int) -> BinaryImage:
    """Allocate a zeroed single-channel mask.

    :param width: Width in pixels.
    :param height: Height in pixels.
    :returns: The new mask.
    :raises ValueError: When the dimensions are not positive integers.
    """
    _assert_dimensions(width, height)

    return BinaryImage(np.zeros((height, width), dtype=np.uint8))


def clone_raster(image: Raster) -> Raster:
    """Copy a raster, pixels included.

    :param image: The raster to copy.
    :returns: An independent copy.
    """
    return Raster(image.pixels.copy())


def is_raster(value: Any) -> bool:  # noqa: ANN401 - the point is to accept anything
    """True when the value is already a decoded raster.

    Structural rather than ``isinstance``, matching the TypeScript: a caller
    should be able to hand over something they built themselves without
    importing anything from here.

    :param value: Any object.
    :returns: Whether it looks like a decoded RGBA raster.
    """
    pixels = getattr(value, "pixels", None)
    if not isinstance(pixels, np.ndarray):
        return False

    return (
        pixels.dtype == np.uint8
        and pixels.ndim == 3  # noqa: PLR2004 - (height, width, channel)
        and pixels.shape[2] == _RGBA_CHANNELS
    )


def to_bytes(source: Any) -> bytes | None:  # noqa: ANN401 - mirrors the TS union
    """Narrow an accepted input to the bytes of an encoded image.

    :param source: A raster, bytes, or a path.
    :returns: The encoded bytes, or ``None`` when the input is already decoded.
    :raises TypeError: For a path, which the codec opens itself, or anything else.
    """
    if is_raster(source):
        return None
    if isinstance(source, str):
        message = "a path is not bytes; the codec opens paths itself"
        raise TypeError(message)
    if isinstance(source, bytes | bytearray | memoryview):
        return bytes(source)

    message = "expected a Raster, bytes, or a path"
    raise TypeError(message)
