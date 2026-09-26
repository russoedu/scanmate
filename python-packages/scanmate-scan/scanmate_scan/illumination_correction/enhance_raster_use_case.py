"""Even out the lighting, whiten the paper and darken the ink.

Scanned and photographed pages come back with shadows, yellowed or grey paper
and washed-out text. Dividing each pixel by an estimate of the paper behind it -
a wide box mean, which no stroke is big enough to move - flattens the lighting
and leaves the ink; a linear stretch between the black and white points then
clamps paper to white and ink to black. In colour mode each channel is divided
by its own background, which also corrects the white balance while a blue pen
stays blue.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy
from numpy.typing import NDArray
from scanmate_ink import Raster, box_blur, box_blur_raster, to_grayscale

from ..noise_reduction import despeckle as median_filter
from ..noise_reduction import estimate_noise_sigma
from .contrast_points_policy import resolve_contrast_points
from .enhance_options_contract import (
    DEFAULT_ENHANCE_OPTIONS,
    AppliedEnhancement,
    EnhanceOptions,
    SharpenOptions,
)


@dataclass(frozen=True, slots=True)
class EnhancedRaster:
    """The cleaned page, and what was done to it."""

    raster: Raster
    applied: AppliedEnhancement


def enhance_raster(raster: Raster, options: EnhanceOptions | None = None) -> EnhancedRaster:
    """Clean a page: level the lighting, then stretch the contrast.

    :param raster: The page.
    :param options: How to clean it.
    :returns: The cleaned page and an account of what was applied.

    .. note::
       ``sharpenRaster`` - the same unsharp mask with the blur done by libvips
       - is **absent**, because ``blur_raster`` is absent from ``scanmate-ink``
       for the reason its README gives. The box-blur mask below is what
       ``sharpen`` uses here, and it is the one the sharpening was tuned with.
    """
    settings = options if options is not None else DEFAULT_ENHANCE_OPTIONS
    width = raster.width
    height = raster.height

    raw_gray = to_grayscale(raster)
    noise_sigma = estimate_noise_sigma(raw_gray) if settings.despeckle == "auto" else None
    despeckled = settings.despeckle is True or (
        noise_sigma is not None and noise_sigma > settings.despeckle_threshold
    )
    pixels = (
        median_filter(raster.pixels, width, height, settings.despeckle_radius)
        if despeckled
        else raster.pixels
    )
    gray = to_grayscale(Raster(pixels=pixels)) if despeckled else raw_gray

    radius = max(4, _js_round(min(width, height) * settings.background_fraction))
    background = box_blur(gray, radius)
    points = resolve_contrast_points(
        settings.white_point, settings.black_point, gray, background
    )
    span = max(1e-4, points.white_point - points.black_point)
    out = numpy.empty((height, width, 4), dtype=numpy.uint8)

    if settings.mode == "color":
        for channel in range(3):
            blurred = _blur_channel(pixels, channel, width, height, radius)
            ratio = pixels[:, :, channel].astype(numpy.float64) / numpy.maximum(blurred, 1)
            out[:, :, channel] = _stretch(ratio, points.black_point, span)
    else:
        ratio = gray.pixels.astype(numpy.float64) / numpy.maximum(
            background.pixels.astype(numpy.float64), 1e-3
        )
        value = _stretch(ratio, points.black_point, span)
        for channel in range(3):
            out[:, :, channel] = value
    out[:, :, 3] = pixels[:, :, 3]

    cleaned = Raster(pixels=out)
    sharpened = cleaned if settings.sharpen is False else _unsharp_mask(cleaned, settings.sharpen)

    return EnhancedRaster(
        raster=sharpened,
        applied=AppliedEnhancement(
            white_point=points.white_point,
            black_point=points.black_point,
            mode=settings.mode,
            despeckled=despeckled,
            noise_sigma=noise_sigma,
            sharpened=settings.sharpen,
        ),
    )


def _unsharp_mask(raster: Raster, sharpen: SharpenOptions) -> Raster:
    """The page, plus what a blur of it throws away.

    Applied last, on the enlarged and levelled page, and both of those matter.
    Enlarging first is what sets the radius: a stroke on a page taken from 93
    dpi to 300 is three times the width it was scanned at, so a radius fitted
    to the original resolution sharpens detail that is no longer there -
    measured, a radius of 0.6 on such a page changed the reading in no way at
    all, while 4 was the optimum. Levelling first is what gives it edges to
    work on rather than paper shading: on the same page, levelling alone gained
    0.003 and sharpening alone 0.074, but the two in this order gained 0.144.

    Three box blurs stand in for a Gaussian, which is close enough for a mask.
    """
    if sharpen.sigma <= 0 or sharpen.amount <= 0:
        return raster

    radius = _box_radius(sharpen.sigma)
    blurred = raster
    for _ in range(3):
        blurred = box_blur_raster(blurred, radius)

    return _add_back(raster, blurred, sharpen.amount)


def _box_radius(sigma: float) -> int:
    """The box radius a sharpening sigma has always meant."""
    return max(1, _js_round(sigma))


def _add_back(raster: Raster, blurred: Raster, amount: float) -> Raster:
    """The page, plus ``amount`` times what the blur took from it."""
    original = raster.pixels[:, :, :3].astype(numpy.float64)
    soft = blurred.pixels[:, :, :3].astype(numpy.float64)
    out = numpy.empty(raster.pixels.shape, dtype=numpy.uint8)
    out[:, :, :3] = _to_uint8_clamped(original + amount * (original - soft))
    out[:, :, 3] = raster.pixels[:, :, 3]

    return Raster(pixels=out)


def _stretch(
    ratio: NDArray[numpy.float64], black_point: float, span: float
) -> NDArray[numpy.uint8]:
    """A background ratio to an 8-bit value: linear between the clamp points.

    ``Math.round`` here - half UP - and then held inside 0 to 255. This is the
    one place the two roundings sit side by side: the value is rounded by
    ``Math.round`` *before* it reaches the clamped array, so the array's own
    half-to-even rule never applies.
    """
    value = numpy.floor((ratio - black_point) / span * 255 + 0.5)

    return numpy.clip(value, 0, 255).astype(numpy.uint8)


def _to_uint8_clamped(values: NDArray[numpy.float64]) -> NDArray[numpy.uint8]:
    """What writing a float into a ``Uint8ClampedArray`` does.

    Clamped to 0-255 and rounded **half to even** - not half up. Writing 2.5
    stores 2 and 1.5 stores 2, which is the opposite of ``Math.round`` and is
    easy to get wrong in both directions. ``numpy.rint`` has the same rule.
    """
    return numpy.clip(numpy.rint(values), 0, 255).astype(numpy.uint8)


def _blur_channel(
    pixels: NDArray[numpy.uint8], channel: int, width: int, height: int, radius: float
) -> NDArray[numpy.float32]:
    """Box mean of one RGBA channel with a summed-area table.

    Averaged over the part of the window that lies **on the page**, so the
    border is never darkened by paper that is not there.
    """
    data = pixels[:, :, channel].astype(numpy.float64)
    # The summed-area table, built row by row exactly as the TypeScript does:
    # a running row total added to the row above.
    total = numpy.zeros((height + 1, width + 1), dtype=numpy.float64)
    total[1:, 1:] = numpy.cumsum(data, axis=1)
    numpy.cumsum(total[1:, 1:], axis=0, out=total[1:, 1:])

    r = max(1, _js_round(radius))
    ys = numpy.arange(height)
    xs = numpy.arange(width)
    y0 = numpy.maximum(0, ys - r)
    y1 = numpy.minimum(height, ys + r + 1)
    x0 = numpy.maximum(0, xs - r)
    x1 = numpy.minimum(width, xs + r + 1)

    window = (
        total[numpy.ix_(y1, x1)]
        - total[numpy.ix_(y1, x0)]
        - total[numpy.ix_(y0, x1)]
        + total[numpy.ix_(y0, x0)]
    )
    area = numpy.outer(y1 - y0, x1 - x0).astype(numpy.float64)

    means: NDArray[numpy.float32] = (window / area).astype(numpy.float32)

    return means


def _js_round(value: float) -> int:
    """``Math.round``: halves go up, not to even."""
    return math.floor(value + 0.5)
