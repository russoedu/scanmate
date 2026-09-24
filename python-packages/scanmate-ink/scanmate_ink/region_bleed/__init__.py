"""The room around a marked region where ink still belongs to it."""

from .bleed_contract import Bleed, ResolvedBleed
from .resolve_bleed_policy import (
    DEFAULT_BLEED,
    grow_by,
    has_bleed,
    resolve_bleed,
    resolve_region_bleed,
)

__all__ = [
    "DEFAULT_BLEED",
    "Bleed",
    "ResolvedBleed",
    "grow_by",
    "has_bleed",
    "resolve_bleed",
    "resolve_region_bleed",
]
