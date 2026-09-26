"""How big an image's page is, and where on it the image goes.

By default a page is the image at its resolution: a 2480 x 3508 scan at 300 dpi
becomes an A4 page, and a downstream reader that divides pixels by page inches
gets the scan's real resolution back - which is exactly what ``scanmate-extract``
does to decide how to render. A fixed paper size instead fits the image inside
it, centred, turning the page landscape for a landscape image.

Resolution comes from, in order: what the caller says; what the file records, if
it is at least :data:`MIN_RECORDED_DPI`; the ``image_dpi`` fallback. The floor is
there because 72 and 96 are what cameras and editors write when they know
nothing - a phone photo "at 72 dpi" would make a page over a metre tall.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypeAlias

#: ``"image"``: the image's own size at its resolution. Otherwise a paper size,
#: or a ``PageDimensions`` in points.
PageSize: TypeAlias = 'Literal["image", "a4", "letter"] | PageDimensions'


@dataclass(frozen=True, slots=True)
class PageDimensions:
    """An explicit page size in points."""

    width: float
    height: float


PAPER: dict[str, PageDimensions] = {
    "a4": PageDimensions(width=595.28, height=841.89),
    "letter": PageDimensions(width=612, height=792),
}

#: Recorded densities below this are software defaults, not a scan's resolution.
MIN_RECORDED_DPI = 100


@dataclass(frozen=True, slots=True)
class Placement:
    """In PDF points, from the page's bottom-left corner - PDF's own frame."""

    page_width: float
    page_height: float
    x: float
    y: float
    width: float
    height: float


def resolve_dpi(given: float | None, recorded: float | None, fallback: float) -> float:
    """Decide the resolution an image is placed at.

    :param given: What the caller said, if anything. Ignored when not positive.
    :param recorded: What the file records, if anything.
    :param fallback: Used when neither of the above is usable.
    :returns: The resolution in dots per inch.
    """
    if given is not None and given > 0:
        return given
    if recorded is not None and recorded >= MIN_RECORDED_DPI:
        return recorded

    return fallback


def place_image(
    pixel_width: int,
    pixel_height: int,
    dpi: float,
    page_size: PageSize,
    margin: float = 0,
) -> Placement:
    """Work out the page and where on it the image sits.

    :param pixel_width: The image's width in pixels.
    :param pixel_height: The image's height in pixels.
    :param dpi: The resolution to place it at.
    :param page_size: ``"image"``, a paper name, or explicit dimensions.
    :param margin: Points of white kept around the image on a paper-size page.
    :returns: The page size and the image's box within it.
    """
    width = (pixel_width / dpi) * 72
    height = (pixel_height / dpi) * 72
    if page_size == "image":
        return Placement(
            page_width=width, page_height=height, x=0, y=0, width=width, height=height
        )

    paper = PAPER[page_size] if isinstance(page_size, str) else page_size
    # Portrait unless the IMAGE is wider than it is tall - the paper's own
    # orientation is not consulted, so `{width: 800, height: 200}` still holds a
    # portrait image upright.
    landscape = pixel_width > pixel_height
    page_width = max(paper.width, paper.height) if landscape else min(paper.width, paper.height)
    page_height = min(paper.width, paper.height) if landscape else max(paper.width, paper.height)
    scale = min((page_width - 2 * margin) / width, (page_height - 2 * margin) / height)
    fitted_width = width * scale
    fitted_height = height * scale

    return Placement(
        page_width=page_width,
        page_height=page_height,
        x=(page_width - fitted_width) / 2,
        y=(page_height - fitted_height) / 2,
        width=fitted_width,
        height=fitted_height,
    )
