"""``scanmate-merge`` - many files in, one PDF out.

.. code-block:: python

    from scanmate_merge import merge_documents

    result = merge_documents(["scan1.jpg", "contract.pdf", "scan2.png"])
    result.page_count
    result.pages[0].embedding   # 'jpeg', embedded as its own bytes
"""

from .document_merge import (
    Embedding,
    MergedPage,
    MergeMetadata,
    MergeOptions,
    MergeResult,
    merge_documents,
)
from .page_marking import (
    Affine,
    MarkOptions,
    MarkResult,
    PageGeometry,
    PageMark,
    mark_pages,
    to_user_space,
    viewport_size,
    viewport_transform,
)
from .page_placement import (
    MIN_RECORDED_DPI,
    PAPER,
    PageDimensions,
    PageSize,
    Placement,
    place_image,
    resolve_dpi,
)
from .source_reading import (
    MergeSourceError,
    PdfPasswordError,
    ResolvedSource,
    SourceKind,
    is_pdf,
    open_pdf,
    read_source,
)

__all__ = [
    "MIN_RECORDED_DPI",
    "PAPER",
    "Affine",
    "Embedding",
    "MarkOptions",
    "MarkResult",
    "MergeMetadata",
    "MergeOptions",
    "MergeResult",
    "MergeSourceError",
    "MergedPage",
    "PageDimensions",
    "PageGeometry",
    "PageMark",
    "PageSize",
    "PdfPasswordError",
    "Placement",
    "ResolvedSource",
    "SourceKind",
    "is_pdf",
    "mark_pages",
    "merge_documents",
    "open_pdf",
    "place_image",
    "read_source",
    "resolve_dpi",
    "to_user_space",
    "viewport_size",
    "viewport_transform",
]
