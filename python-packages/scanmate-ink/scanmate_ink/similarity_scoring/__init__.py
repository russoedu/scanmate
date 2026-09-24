"""The referee: how well two ink images actually overlap."""

from .correlation_algorithm import correlation, intersection_over_union, mean

__all__ = ["correlation", "intersection_over_union", "mean"]
