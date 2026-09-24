"""``scanmate-align`` - put a scanned page back on top of the page it came from.

A port of ``@scanmate/align``, function for function. Every numeric result is
held to the TypeScript's own output by the parity goldens in
``tools/parity/goldens``, so "equivalent" here means ``==``, not "close".
"""

from .feature_matching import (
    DESCRIPTOR_WORDS,
    FeatureOptions,
    FeatureSet,
    Keypoint,
    MatchOptions,
    detect_and_describe,
    hamming,
    match_features,
    popcount,
)
from .phase_correlation import PhaseCorrelationResult, hann, phase_correlate
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
    "DESCRIPTOR_WORDS",
    "Correspondence",
    "FeatureOptions",
    "FeatureSet",
    "Keypoint",
    "MatchOptions",
    "PhaseCorrelationResult",
    "RansacOptions",
    "RansacResult",
    "detect_and_describe",
    "find_inliers",
    "fit_affine",
    "fit_homography",
    "fit_model",
    "fit_similarity",
    "hamming",
    "hann",
    "match_features",
    "minimum_samples",
    "phase_correlate",
    "popcount",
    "ransac",
]
