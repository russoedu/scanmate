"""Seeded PRNG, so the same bytes give the same matrix."""

from .create_random_algorithm import create_random, gaussian
from .random_stream_algorithm import random_stream

__all__ = ["create_random", "gaussian", "random_stream"]
