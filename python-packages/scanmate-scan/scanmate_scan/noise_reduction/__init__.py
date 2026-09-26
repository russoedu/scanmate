"""Rejecting the specks a scanner leaves, and measuring how many there are."""

from .despeckle_algorithm import despeckle
from .noise_level_algorithm import estimate_noise_sigma

__all__ = ["despeckle", "estimate_noise_sigma"]
