"""Many files in, one PDF out."""

from .merge_documents_use_case import merge_documents
from .merge_result_contract import (
    Embedding,
    MergedPage,
    MergeMetadata,
    MergeOptions,
    MergeResult,
)

__all__ = [
    "Embedding",
    "MergeMetadata",
    "MergeOptions",
    "MergeResult",
    "MergedPage",
    "merge_documents",
]
