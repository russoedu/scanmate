"""``scanmate-align`` - put a scanned page back on top of the page it came from.

A port of ``@scanmate/align``, function for function. Every numeric result is
held to the TypeScript's own output by the parity goldens in
``tools/parity/goldens``, so "equivalent" here means ``==``, not "close".
"""

from .coarse_estimation import CoarseOptions, CoarseResult, PageSkew, estimate_coarse
from .feature_matching import (
    FeatureOptions,
    FeatureSet,
    Keypoint,
    MatchOptions,
    detect_and_describe,
    hamming,
    match_features,
    popcount,
)
from .phase_correlation import PhaseCorrelationResult, phase_correlate
from .scan_alignment import (
    DEFAULT_MODELS,
    AlignDiagnostics,
    AlignOptions,
    AlignPagesOptions,
    AlignResult,
    ModelAttempt,
    ScoredModel,
    SkewDegrees,
    align_pages,
    align_scan,
    polish_translation,
    prefers,
)
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
    "DEFAULT_MODELS",
    "AlignDiagnostics",
    "AlignOptions",
    "AlignPagesOptions",
    "AlignResult",
    "CoarseOptions",
    "CoarseResult",
    "Correspondence",
    "FeatureOptions",
    "FeatureSet",
    "Keypoint",
    "MatchOptions",
    "ModelAttempt",
    "PageSkew",
    "PhaseCorrelationResult",
    "RansacOptions",
    "RansacResult",
    "ScoredModel",
    "SkewDegrees",
    "align_pages",
    "align_scan",
    "detect_and_describe",
    "estimate_coarse",
    "find_inliers",
    "fit_affine",
    "fit_homography",
    "fit_model",
    "fit_similarity",
    "hamming",
    "match_features",
    "minimum_samples",
    "phase_correlate",
    "polish_translation",
    "popcount",
    "prefers",
    "ransac",
]
