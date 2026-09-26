"""How big an image's page is, and where on it the image goes."""

from .page_placement_policy import (
    MIN_RECORDED_DPI,
    PAPER,
    PageDimensions,
    PageSize,
    Placement,
    place_image,
    resolve_dpi,
)

__all__ = [
    "MIN_RECORDED_DPI",
    "PAPER",
    "PageDimensions",
    "PageSize",
    "Placement",
    "place_image",
    "resolve_dpi",
]
