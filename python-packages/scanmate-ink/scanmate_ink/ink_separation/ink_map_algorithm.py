"""Turning a photograph of paper into something two images can be compared on.

A scan differs from its source in ways that have nothing to do with where the
page is: the lamp is brighter in the middle, the phone cast a shadow down one
side, the JPEG quantiser smeared the strokes. Comparing raw greyscale means
comparing all of that too. So every stage below the codec works on **ink**:
greyscale divided by its own slowly-varying background and inverted, which is
near zero on paper and near one on print no matter what the lighting did.

Think of it as reading a page through a sheet of tracing paper - you lose the
tint of the paper and the angle of the lamp, and keep the writing.

WHERE FLOAT32 ENTERS, AND WHY IT IS EVERYTHING HERE
---------------------------------------------------

``GrayImage`` is float32 on both sides. Every expression below is evaluated in
float64 and rounded to float32 **only when it is stored**, exactly as
JavaScript does when it assigns a double into a ``Float32Array``. Letting numpy
carry float32 through the arithmetic instead - the obvious way to write this -
rounds at every intermediate step and diverges from the TypeScript on most
pixels. So each function computes on a float64 view and casts once, at the end.

The integral image is the other half of that: it is float64 in the TypeScript
too, and it is a running sum, so it is accumulated with ``cumsum`` rather than
rebuilt from block sums. Both are measured against the goldens with ``==``.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from ..js_semantics import js_round
from ..raster_codec import GrayImage, Raster

_REC601_RED = 0.299
_REC601_GREEN = 0.587
_REC601_BLUE = 0.114
_BYTE_MAX = 255
_MIN_BACKGROUND = 1e-3
_DEFAULT_BACKGROUND_FRACTION = 1 / 16
_DEFAULT_FLOOR = 0.06
_MIN_BACKGROUND_RADIUS = 4


def to_grayscale(image: Raster) -> GrayImage:
    """Rec. 601 luminance, alpha composited over white, scaled to ``[0, 1]``.

    :param image: The decoded raster.
    :returns: One float per pixel.
    """
    rgba = image.pixels.astype(np.float64)
    alpha = rgba[:, :, 3] / _BYTE_MAX
    over_white = _BYTE_MAX * (1 - alpha)
    red = rgba[:, :, 0] * alpha + over_white
    green = rgba[:, :, 1] * alpha + over_white
    blue = rgba[:, :, 2] * alpha + over_white
    luminance = (_REC601_RED * red + _REC601_GREEN * green + _REC601_BLUE * blue) / _BYTE_MAX

    return GrayImage(luminance.astype(np.float32))


def gray_to_raster(image: GrayImage) -> Raster:
    """Render a single channel back to RGBA, for debugging and diff overlays.

    :param image: The single-channel image.
    :returns: An opaque RGBA raster.
    """
    # `Uint8ClampedArray` CLAMPS and rounds-half-to-even on assignment, which is
    # not what `astype(np.uint8)` does - that truncates and wraps. Clipping
    # first and rounding with numpy's half-to-even matches the TypeScript.
    scaled = np.clip(image.pixels.astype(np.float64) * _BYTE_MAX, 0, _BYTE_MAX)
    channel = np.rint(scaled).astype(np.uint8)
    out = np.empty((image.height, image.width, 4), dtype=np.uint8)
    out[:, :, 0] = channel
    out[:, :, 1] = channel
    out[:, :, 2] = channel
    out[:, :, 3] = _BYTE_MAX

    return Raster(out)


def integral_image(image: GrayImage) -> npt.NDArray[np.float64]:
    """Summed-area table with a zero first row and column, so a window sum is
    four lookups.

    :param image: The single-channel image.
    :returns: A ``(height + 1) * (width + 1)`` float64 table, flattened.
    """
    rows = np.cumsum(image.pixels.astype(np.float64), axis=1)
    table = np.zeros((image.height + 1, image.width + 1), dtype=np.float64)
    np.cumsum(rows, axis=0, out=table[1:, 1:])

    return table.reshape(-1)


def box_blur(image: GrayImage, radius: float) -> GrayImage:
    """Mean over a ``(2 * radius + 1)`` square, in time independent of the radius.

    Border windows are clipped and divided by their real area rather than
    padded, so the blur never invents dark paper outside the page.

    :param image: The single-channel image.
    :param radius: Half-width of the window, rounded the way JavaScript rounds.
    :returns: The blurred image.
    """
    r = max(0, js_round(radius))
    if r == 0:
        return GrayImage(image.pixels.copy())

    width, height = image.width, image.height
    table = integral_image(image).reshape(height + 1, width + 1)

    ys = np.arange(height)
    xs = np.arange(width)
    y0 = np.maximum(0, ys - r)
    y1 = np.minimum(height, ys + r + 1)
    x0 = np.maximum(0, xs - r)
    x1 = np.minimum(width, xs + r + 1)

    total = (
        table[np.ix_(y1, x1)]
        - table[np.ix_(y1, x0)]
        - table[np.ix_(y0, x1)]
        + table[np.ix_(y0, x0)]
    )
    area = np.outer(y1 - y0, x1 - x0).astype(np.float64)

    return GrayImage((total / area).astype(np.float32))


@dataclass(frozen=True, slots=True)
class InkOptions:
    """How :func:`ink_map` separates ink from paper."""

    #: Background window as a fraction of the shorter side. The window has to
    #: be wide enough that no glyph can fill it - otherwise a bold heading
    #: becomes its own background and disappears - and narrow enough to follow
    #: a shadow.
    background_fraction: float = _DEFAULT_BACKGROUND_FRACTION
    #: Ink below this fraction of full black is treated as paper noise and zeroed.
    floor: float = _DEFAULT_FLOOR


def ink_map(gray: GrayImage, options: InkOptions | None = None) -> GrayImage:
    """Greyscale to ink: divide out the local background, invert, clip the noise floor.

    Division rather than subtraction because illumination is multiplicative - a
    shadow halves what reaches the sensor, it does not subtract a constant - so
    dividing restores the same contrast in the shadow as in the light.

    :param gray: The greyscale image.
    :param options: Window and floor.
    :returns: The ink map.
    """
    settings = options or InkOptions()
    radius = max(
        _MIN_BACKGROUND_RADIUS,
        js_round(min(gray.width, gray.height) * settings.background_fraction),
    )
    background = box_blur(gray, radius)

    bg = np.maximum(background.pixels.astype(np.float64), _MIN_BACKGROUND)
    ratio = gray.pixels.astype(np.float64) / bg
    ink = 1 - np.minimum(1, ratio)
    floor = settings.floor
    scaled = np.minimum(1, (ink - floor) / (1 - floor))

    return GrayImage(np.where(ink < floor, 0.0, scaled).astype(np.float32))
