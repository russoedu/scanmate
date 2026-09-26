"""Median-filter the R, G and B channels of an RGBA image; alpha is copied.

A median, unlike the mean the background is estimated with, **rejects** the
isolated light and dark specks a scanner or photocopier leaves instead of
smearing them into their neighbours - which, once contrast is stretched, is how
a speck fuses into a thin stroke and a ``1`` becomes an ``l``.

Each output is the median of the square window of ``radius`` around it, clipped
at the image border - the element at ``length >> 1`` of the sorted window, so a
clipped window of even size takes the **upper** middle.
"""

from __future__ import annotations

import math

import numpy
from numpy.typing import NDArray


def despeckle(
    pixels: NDArray[numpy.uint8], width: int, height: int, radius: float = 1
) -> NDArray[numpy.uint8]:
    """Median-filter an RGBA image.

    :param pixels: The image, shaped ``(height, width, 4)``.
    :param width: Its width, for the same signature the TypeScript has.
    :param height: Its height.
    :param radius: Half the window's side. A number, as the TypeScript takes:
        rounded with Math.round semantics and held at 1 or more.
    :returns: A new image of the same shape.
    """
    r = max(1, _js_round(radius))
    out = numpy.empty((height, width, 4), dtype=numpy.uint8)
    # Alpha is copied, never filtered: a median of the alpha channel would
    # invent edges where a page is transparent.
    out[:, :, 3] = pixels[:, :, 3]

    for channel in range(3):
        out[:, :, channel] = _median_channel(pixels[:, :, channel], width, height, r)

    return out


def _median_channel(
    channel: NDArray[numpy.uint8], width: int, height: int, r: int
) -> NDArray[numpy.uint8]:
    """One channel, median-filtered with the window clipped at the border."""
    side = 2 * r + 1
    # The interior, where every window is full, is done with one stacked
    # median: the same value the TypeScript's selection network gives, because
    # a full window of odd size has one unambiguous middle.
    out = numpy.empty((height, width), dtype=numpy.uint8)
    if height > 2 * r and width > 2 * r:
        stack = numpy.empty((side * side, height - 2 * r, width - 2 * r), dtype=numpy.uint8)
        at = 0
        for dy in range(side):
            for dx in range(side):
                stack[at] = channel[dy : dy + height - 2 * r, dx : dx + width - 2 * r]
                at += 1
        stack.sort(axis=0)
        out[r : height - r, r : width - r] = stack[(side * side) >> 1]

    # The border, where the window is clipped and may hold an even count - and
    # where the middle is therefore the UPPER one, which a mean-based median
    # would get wrong by half a level.
    for y in range(height):
        inside_rows = r <= y < height - r
        y0 = max(0, y - r)
        y1 = min(height - 1, y + r)
        for x in range(width):
            if inside_rows and r <= x < width - r:
                continue
            x0 = max(0, x - r)
            x1 = min(width - 1, x + r)
            window = channel[y0 : y1 + 1, x0 : x1 + 1].reshape(-1)
            ordered = numpy.sort(window, kind="stable")
            out[y, x] = ordered[len(ordered) >> 1]

    return out


def _js_round(value: float) -> int:
    """``Math.round``: halves go up, not to even."""
    return math.floor(value + 0.5)
