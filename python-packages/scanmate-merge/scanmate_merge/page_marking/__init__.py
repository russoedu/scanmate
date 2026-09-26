"""Drawing marks where a document's fields are expected to be."""

from .mark_pages_use_case import mark_pages
from .page_mark_contract import MarkOptions, MarkResult, PageMark
from .page_viewport_mapper import (
    Affine,
    PageGeometry,
    Point,
    Size,
    to_user_space,
    viewport_size,
    viewport_transform,
)

__all__ = [
    "Affine",
    "MarkOptions",
    "MarkResult",
    "PageGeometry",
    "PageMark",
    "Point",
    "Size",
    "mark_pages",
    "to_user_space",
    "viewport_size",
    "viewport_transform",
]
