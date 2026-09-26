"""What each character looks like in print, taken from the original itself.

The original is the only place a rival glyph can honestly come from: it is the
document's own face, at the document's own size, rendered by whatever rendered
the page. Every run whose characters can be told apart contributes its glyphs,
filed by face and size, and a run is then verified against the ones that share
its face and size. A run printed light on a dark bar is turned dark on light
first, so a figure on a shaded total line is matched against the same digits as
one on paper. Nothing is rendered, no font is embedded, and a face the page
never prints has no templates - so nothing is claimed about it.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import TypeAlias

import numpy
from scanmate_ink import GrayImage, ScanmateOrientedRect, TextRun

from .glyph_cells_algorithm import CellOptions, place_glyphs, printed_characters
from .print_polarity_policy import print_polarity

#: Glyph images by face, size, turn and character.
Templates: TypeAlias = "Mapping[str, list[GrayImage]]"

#: A store still being filled. Readers take :data:`Templates`; only the
#: collector writes.
TemplateStore: TypeAlias = "dict[str, list[GrayImage]]"

#: Most glyphs kept per character - more is slower and adds nothing.
PER_CHARACTER = 4


def _js_round(value: float) -> int:
    """``Math.round``: halves go UP, not to even.

    Python's ``round`` is banker's rounding, so ``round(0.5)`` is 0 where
    JavaScript gives 1 - and this decides which size bucket a glyph is filed
    under, so the two ports would build different template keys.
    """
    return math.floor(value + 0.5)


def template_key(run: TextRun, character: str) -> str:
    """The key a run's glyphs are filed under.

    :param run: The run the glyph came from.
    :param character: The character itself.
    :returns: ``face|size|turn|character``.
    """
    # The turn belongs in the key: a glyph printed up the margin and the same
    # glyph printed across the page are different pictures, and matching one
    # against the other would compare a letter with its own rotation.
    angle = run.angle if run.angle is not None else 0
    turn = ((_js_round(angle / 90) % 4) + 4) % 4
    size = run.font_size if run.font_size is not None else run.height
    face = run.font_name if run.font_name is not None else ""

    return f"{face}|{_number(_js_round(size * 2) / 2)}|{turn}|{character}"


def collect_into(
    templates: TemplateStore, page: GrayImage, dpi: float, runs: Sequence[TextRun]
) -> Templates:
    """Fold one page's glyphs into a store that already holds others.

    Templates are filed by face, size and turn, and a PDF renders those
    identically wherever they appear - so a glyph from page 4 is as good a
    template as one from page 1, and on many documents it is the only one there
    is. Measured on a real order confirmation: the face its page-1 total is set
    in carries six distinct digits on that page and nine across the document,
    and six is below the bar for checking anything at all.

    The per-character cap applies to the store as a whole, so a long document
    costs no more memory than a short one.

    :param templates: The store to add to, modified in place.
    :param page: The original page, greyscale.
    :param dpi: What it was rendered at.
    :param runs: Its text layer.
    :returns: The same store.
    """
    for run in runs:
        characters = printed_characters(run.text)
        box = ScanmateOrientedRect(
            x=run.x, y=run.y, width=run.width, height=run.height, angle=run.angle
        )
        light_on_dark = print_polarity(page, dpi, box) == "light-on-dark"
        cells = place_glyphs(
            page, dpi, box, run.text, CellOptions(light_on_dark=light_on_dark)
        )
        if cells is None:
            continue

        for index, character in enumerate(characters):
            cell = cells[index]
            if cell is not None:
                _keep(
                    templates,
                    template_key(run, character),
                    cut(page, dpi, cell, light_on_dark),
                )

    return templates


def collect_templates(
    page: GrayImage, dpi: float, runs: Sequence[TextRun]
) -> Templates:
    """Collect a glyph image for every character the page prints and can place.

    :param page: The original page, greyscale.
    :param dpi: What it was rendered at.
    :param runs: Its text layer.
    :returns: Glyph images, by :func:`template_key`.
    """
    return collect_into({}, page, dpi, runs)


def cut(
    page: GrayImage, dpi: float, box: ScanmateOrientedRect, invert: bool = False
) -> GrayImage | None:
    """The greyscale of one box of the page, or ``None`` when it lies outside it.

    :param page: The page.
    :param dpi: What it was rendered at.
    :param box: The box, in points.
    :param invert: Whether the run it belongs to is printed light on dark.
    :returns: The crop, or ``None`` when it has no area on the page.
    """
    s = dpi / 72
    left = max(0, math.floor(box.x * s))
    top = max(0, math.floor(box.y * s))
    right = min(page.width, math.ceil((box.x + box.width) * s))
    bottom = min(page.height, math.ceil((box.y + box.height) * s))
    width = right - left
    height = bottom - top
    if width < 1 or height < 1:
        return None

    window = page.pixels[top:bottom, left:right]
    # float32 throughout, as the TypeScript's Float32Array is: `1 - value`
    # rounds to a float32 there, and computing it in float64 here would give a
    # different last bit.
    pixels = (numpy.float32(1) - window if invert else window).astype(numpy.float32)

    return GrayImage(pixels=numpy.ascontiguousarray(pixels))


def _keep(templates: TemplateStore, key: str, glyph: GrayImage | None) -> None:
    """File one glyph under its key, up to the few that are worth keeping."""
    if glyph is None:
        return
    kept = templates.setdefault(key, [])
    if len(kept) >= PER_CHARACTER:
        return

    kept.append(glyph)


def _number(value: float) -> str:
    """A number as JavaScript puts one in a template key: ``12`` not ``12.0``."""
    return str(int(value)) if value == int(value) else str(value)
