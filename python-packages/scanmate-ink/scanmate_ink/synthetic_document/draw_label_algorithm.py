"""Small labels drawn straight onto a raster, for legends and captions.

The glyphs are a 5x7 bitmap carried in this file. That is deliberate: a real
font means a font file to ship and license, or the host's fonts, and a
container with no fonts installed would silently draw nothing at all. A legend
that vanishes in production is worse than one that is plain.

Letters are drawn as capitals whatever case they are given, since capitals are
all a 5x7 cell reads well at the sizes a label wants. Anything the font does
not carry is drawn as a space rather than as a missing-glyph box - a caption is
not worth failing a render over.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..js_semantics import js_round
from ..plane_geometry import Point, ScanmateRect
from ..raster_codec import Raster

#: One glyph: seven rows of five bits, top to bottom, most significant bit leftmost.
_GLYPHS: dict[str, tuple[int, ...]] = {
    " ": (0, 0, 0, 0, 0, 0, 0),
    "A": (0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11),
    "B": (0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E),
    "C": (0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E),
    "D": (0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E),
    "E": (0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F),
    "F": (0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10),
    "G": (0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F),
    "H": (0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11),
    "I": (0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E),
    "J": (0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C),
    "K": (0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11),
    "L": (0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F),
    "M": (0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11),
    "N": (0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11),
    "O": (0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E),
    "P": (0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10),
    "Q": (0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D),
    "R": (0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11),
    "S": (0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E),
    "T": (0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04),
    "U": (0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E),
    "V": (0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04),
    "W": (0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11),
    "X": (0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11),
    "Y": (0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04),
    "Z": (0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F),
    "0": (0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E),
    "1": (0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E),
    "2": (0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F),
    "3": (0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E),
    "4": (0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02),
    "5": (0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E),
    "6": (0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E),
    "7": (0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08),
    "8": (0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E),
    "9": (0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C),
    ".": (0, 0, 0, 0, 0, 0x0C, 0x0C),
    ",": (0, 0, 0, 0, 0x06, 0x04, 0x08),
    "-": (0, 0, 0, 0x0E, 0, 0, 0),
    ":": (0, 0x0C, 0x0C, 0, 0x0C, 0x0C, 0),
    "/": (0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10),
    "(": (0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02),
    ")": (0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08),
    "'": (0x04, 0x04, 0, 0, 0, 0, 0),
    "%": (0x11, 0x01, 0x02, 0x04, 0x08, 0x10, 0x11),
}

_GLYPH_WIDTH = 5
_GLYPH_HEIGHT = 7
#: Blank columns between one glyph and the next, in glyph pixels.
_TRACKING = 1
_BLACK: tuple[int, int, int, int] = (0, 0, 0, 255)


@dataclass(frozen=True, slots=True)
class LabelOptions:
    """How a label is drawn."""

    #: Pixels per glyph pixel. Default 2, which reads at arm's length on a page.
    scale: float = 2
    #: Ink colour. Default black.
    color: tuple[int, int, int, int] = _BLACK


def label_size(text: str, options: LabelOptions | None = None) -> tuple[float, float]:
    """How wide and tall ``text`` will be at this scale, in pixels.

    Note it takes the scale AS GIVEN, where :func:`draw_label` rounds it and
    clamps it to at least one. That is the TypeScript's behaviour too, so a
    fractional scale makes the reported size and the drawn size disagree -
    which is why :func:`draw_label` calls this with its own rounded scale
    rather than the caller's.

    :param text: The label.
    :param options: Scale and colour.
    :returns: ``(width, height)`` in pixels.
    """
    scale = (options or LabelOptions()).scale
    cells = len(text)

    return (max(0, cells * (_GLYPH_WIDTH + _TRACKING) - _TRACKING) * scale, _GLYPH_HEIGHT * scale)


def _fill_cell(
    raster: Raster,
    x: int,
    y: int,
    scale: int,
    color: tuple[int, int, int, int],
) -> None:
    """Paint one glyph pixel as a ``scale`` x ``scale`` block, clipped to the raster.

    :param raster: The image to draw on.
    :param x: Left edge of the block.
    :param y: Top edge of the block.
    :param scale: Block size.
    :param color: The RGBA value to write.
    """
    top = max(0, y)
    bottom = min(raster.height, y + scale)
    left = max(0, x)
    right = min(raster.width, x + scale)
    if bottom <= top or right <= left:
        return

    raster.pixels[top:bottom, left:right] = np.asarray(color, dtype=np.uint8)


def draw_label(
    raster: Raster,
    text: str,
    at: Point,
    options: LabelOptions | None = None,
) -> ScanmateRect:
    """Draw a label with its top-left corner at ``at``.

    :param raster: The image to draw on, modified in place.
    :param text: What to write; letters are drawn as capitals, and anything the
        font does not carry is drawn as a space.
    :param at: Where the label's top-left corner goes.
    :param options: Scale and colour.
    :returns: The box the label occupies.
    """
    settings = options or LabelOptions()
    scale = max(1, js_round(settings.scale))
    left = js_round(at.x)
    top = js_round(at.y)

    for index, character in enumerate(text.upper()):
        glyph = _GLYPHS.get(character, _GLYPHS[" "])
        origin_x = left + index * (_GLYPH_WIDTH + _TRACKING) * scale

        for row, bits in enumerate(glyph):
            for column in range(_GLYPH_WIDTH):
                if bits & (1 << (_GLYPH_WIDTH - 1 - column)) == 0:
                    continue
                cell_x = origin_x + column * scale
                _fill_cell(raster, cell_x, top + row * scale, scale, settings.color)

    width, height = label_size(text, LabelOptions(scale=scale))

    return ScanmateRect(x=left, y=top, width=width, height=height)
