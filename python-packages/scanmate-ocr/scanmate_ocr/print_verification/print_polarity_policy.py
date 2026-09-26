"""Which way the original prints a run: dark text on light, or light on a dark bar."""

from __future__ import annotations

import math
from typing import Literal, TypeAlias

from scanmate_ink import GrayImage, ScanmateOrientedRect

#: ``"dark-on-light"`` or ``"light-on-dark"``.
PrintPolarity: TypeAlias = Literal["dark-on-light", "light-on-dark"]

#: How far a pixel must stand from the background to count as a glyph.
_GLYPH_CONTRAST = 0.19


def print_polarity(
    page: GrayImage, dpi: float, run: ScanmateOrientedRect
) -> PrintPolarity:
    """Read the run's polarity off its own crisp rendering.

    The glyphs are the pixels far from the background, and the background is
    most of the box.

    :param page: The original page, greyscale, 0 black to 1 white.
    :param dpi: What that page was rendered at.
    :param run: The run's box, in points.
    :returns: Which way round the run is printed.
    """
    s = dpi / 72
    left = max(0, math.floor(run.x * s))
    top = max(0, math.floor(run.y * s))
    right = min(page.width, math.ceil((run.x + run.width) * s))
    bottom = min(page.height, math.ceil((run.y + run.height) * s))
    if right <= left or bottom <= top:
        return "dark-on-light"

    window = page.pixels[top:bottom, left:right]
    values = window.reshape(-1)
    if values.size == 0:
        return "dark-on-light"

    # The median, taken the way the TypeScript takes it: sort and index at
    # floor(n / 2). NumPy's own median averages the two middle values on an
    # even count, which is a different number.
    background = float(sorted(values.tolist())[len(values) // 2])
    glyphs = [v for v in values.tolist() if abs(v - background) > _GLYPH_CONTRAST]
    if len(glyphs) == 0:
        return "dark-on-light"

    return "light-on-dark" if sum(glyphs) / len(glyphs) > background else "dark-on-light"
