"""Feature refinement, split so several models cost one feature pass.

Matching is done between the original and the *coarsely corrected* scan, and
that is what makes the whole thing work: the two now sit at the same scale and
nearly the same angle, so a fixed-offset binary descriptor describes the same
thing on both, and a correspondence that jumps across the page can be rejected
on sight. What RANSAC recovers is only the small residual, which is then
composed onto the coarse transform.

Everything in :func:`prepare_matches` - two downscales, a rough warp, ORB on
both pages and the brute-force matcher - is independent of which transform
family is about to be fitted, and it is nearly all of the cost. Only
:func:`fit_residual` depends on the model, and it touches no pixels at all.
"""

from __future__ import annotations

from dataclasses import dataclass

from scanmate_ink import (
    GrayImage,
    Matrix3,
    PointMatch,
    TransformModel,
    conjugate_scale,
    downscale_gray,
    hypot,
    multiply,
    rebase,
    warp_gray,
)

from ..coarse_estimation import CoarseResult
from ..feature_matching import FeatureOptions, MatchOptions, detect_and_describe, match_features
from ..transform_fitting import Correspondence, RansacOptions, ransac


@dataclass(frozen=True, slots=True)
class MatchingOptions:
    """What the one shared feature pass needs to know."""

    working_size: int
    max_features: int
    max_displacement_ratio: float
    seed: int


@dataclass(frozen=True, slots=True)
class FeatureCounts:
    """Keypoints found on each page."""

    original: int
    scanned: int


@dataclass(frozen=True, slots=True)
class PreparedMatches:
    """Everything the model fits share. Compute once, fit many."""

    matches: list[PointMatch]
    features: FeatureCounts
    #: How much the original was shrunk to its working frame; lifts a residual
    #: back to full resolution.
    scale: float


def prepare_matches(
    original_ink: GrayImage,
    scanned_ink: GrayImage,
    coarse: CoarseResult,
    options: MatchingOptions,
) -> PreparedMatches:
    """The model-independent half: downscale, rough-warp, detect, match.

    :param original_ink: Ink map of the page as printed.
    :param scanned_ink: Ink map of the page as scanned.
    :param coarse: The coarse estimate, which puts the two at the same scale.
    :param options: Working size, feature budget, gate and seed.
    :returns: The correspondences and the counts behind them.
    """
    original = downscale_gray(original_ink, options.working_size)
    scanned = downscale_gray(scanned_ink, options.working_size)

    # The coarse matrix speaks full-resolution pixels; restate it between the
    # two working frames, which were shrunk by different amounts.
    coarse_work = rebase(coarse.matrix, 1 / original.scale, 1 / scanned.scale)
    rough = warp_gray(scanned.image, coarse_work, original.image.width, original.image.height, 0)

    feature_options = FeatureOptions(max_features=options.max_features, seed=options.seed)
    original_features = detect_and_describe(original.image, feature_options)
    scanned_features = detect_and_describe(rough, feature_options)

    diagonal = hypot(original.image.width, original.image.height)
    matches = match_features(
        original_features,
        scanned_features,
        MatchOptions(max_displacement=diagonal * options.max_displacement_ratio),
    )

    return PreparedMatches(
        matches=matches,
        features=FeatureCounts(
            original=len(original_features.keypoints),
            scanned=len(scanned_features.keypoints),
        ),
        scale=original.scale,
    )


@dataclass(frozen=True, slots=True)
class FittingOptions:
    """What one model's RANSAC needs to know."""

    ransac_threshold: float
    min_inliers: int
    seed: int


@dataclass(frozen=True, slots=True)
class ResidualFit:
    """One model's answer: the full transform, and how much agreed with it."""

    #: Maps full-resolution original coordinates to full-resolution scan
    #: coordinates.
    matrix: Matrix3
    inliers: int
    inlier_ratio: float
    #: Mean RANSAC reprojection error over the inliers, in working-resolution
    #: pixels.
    reprojection_error: float


def fit_residual(
    prepared: PreparedMatches,
    coarse: CoarseResult,
    model: TransformModel,
    options: FittingOptions,
) -> ResidualFit | None:
    """Fit one model to the shared matches.

    :param prepared: The shared correspondences.
    :param coarse: The coarse estimate the residual composes onto.
    :param model: The family to fit.
    :param options: Threshold, floor and seed.
    :returns: The fit, or ``None`` when RANSAC finds no consensus worth
        trusting.
    """
    consensus = ransac(
        # `ransac` takes its own narrower correspondence type - a PointMatch
        # with the distance ignored - and building them here rather than
        # widening its signature keeps that boundary where the TypeScript has
        # it.
        [Correspondence(m.source, m.target) for m in prepared.matches],
        RansacOptions(
            model=model,
            threshold=options.ransac_threshold,
            min_inliers=options.min_inliers,
            seed=options.seed,
        ),
    )
    if consensus is None:
        return None

    # RANSAC's matrix maps the original's working frame onto the rough warp,
    # which lives in that same frame. Scale it back up, then compose: original
    # -> rough -> scan.
    residual = conjugate_scale(consensus.matrix, prepared.scale)

    return ResidualFit(
        matrix=multiply(coarse.matrix, residual),
        inliers=len(consensus.inliers),
        inlier_ratio=consensus.inlier_ratio,
        reprojection_error=consensus.error,
    )
