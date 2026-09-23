"""Seeded PRNG, so the same bytes give the same matrix."""

from .create_random_algorithm import create_random, gaussian

__all__ = ["create_random", "gaussian"]
