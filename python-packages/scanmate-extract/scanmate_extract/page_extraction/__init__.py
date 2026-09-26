"""Choosing pages, and pairing them across two documents."""

from .page_pairing_policy import PagePairing, PairingPlan, Unpaired, plan_pairs
from .page_selection_mapper import PageSelection, select_pages

__all__ = [
    "PagePairing",
    "PageSelection",
    "PairingPlan",
    "Unpaired",
    "plan_pairs",
    "select_pages",
]
