"""Fitting a similarity, affine or homography to correspondences.

Plus RANSAC, which decides which of those correspondences to trust.
"""

from .fit_transform_algorithm import (
    Correspondence,
    fit_affine,
    fit_homography,
    fit_model,
    fit_similarity,
    minimum_samples,
)
from .ransac_algorithm import RansacOptions, RansacResult, find_inliers, ransac

__all__ = [
    "Correspondence",
    "RansacOptions",
    "RansacResult",
    "find_inliers",
    "fit_affine",
    "fit_homography",
    "fit_model",
    "fit_similarity",
    "minimum_samples",
    "ransac",
]
