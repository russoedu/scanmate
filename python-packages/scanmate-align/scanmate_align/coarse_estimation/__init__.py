"""A first, cheap scale-and-skew guess, good enough to make feature matching possible."""

from .estimate_coarse_use_case import CoarseOptions, CoarseResult, PageSkew, estimate_coarse

__all__ = [
    "CoarseOptions",
    "CoarseResult",
    "PageSkew",
    "estimate_coarse",
]
