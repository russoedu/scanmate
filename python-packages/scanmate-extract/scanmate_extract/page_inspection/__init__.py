"""What a PDF page says about itself."""

from .page_kind_policy import SCAN_COVERAGE, PageEvidence, classify_page
from .page_metadata_contract import ColorKind, EmbeddedImage, PageKind, PageMetadata

__all__ = [
    "SCAN_COVERAGE",
    "ColorKind",
    "EmbeddedImage",
    "PageEvidence",
    "PageKind",
    "PageMetadata",
    "classify_page",
]
