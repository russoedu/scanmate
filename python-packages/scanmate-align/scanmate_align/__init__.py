"""``scanmate-align`` - put a scanned page back on top of the page it came from.

A port of ``@scanmate/align``, function for function. Every numeric result is
held to the TypeScript's own output by the parity goldens in
``tools/parity/goldens``, so "equivalent" here means ``==``, not "close".
"""

from .transform_fitting import (
    Correspondence,
    RansacOptions,
    RansacResult,
    find_inliers,
    fit_affine,
    fit_homography,
    fit_model,
    fit_similarity,
    minimum_samples,
    ransac,
)

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
