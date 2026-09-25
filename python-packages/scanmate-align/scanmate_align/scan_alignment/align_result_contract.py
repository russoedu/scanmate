"""What a caller asks for, and what comes back."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from scanmate_ink import (
    AlignedImage,
    ImageFormat,
    InkOptions,
    Interpolation,
    TransformModel,
    TransformSummary,
)


@dataclass(frozen=True, slots=True)
class AlignOptions:
    """Everything the aligner will take direction on."""

    #: Transform family to fit, or ``'all'`` to let the page decide.
    #:
    #: ``'all'`` (the default) tries the families in :attr:`models` order,
    #: cheapest and most robust first, and stops at the first one that reaches
    #: :attr:`confidence_target`. Name one family to fit only that:
    #: ``similarity`` for a flatbed or sheet-fed scan, which can only turn,
    #: resize and move a flat page; ``affine`` when one axis is stretched;
    #: ``homography`` for a photograph taken off-axis, where the far edge of the
    #: page is genuinely smaller than the near one.
    model: TransformModel | Literal["all"] = "all"
    #: With ``model='all'``, stop trying further models once one reaches this
    #: confidence, in ``[0, 1]``. A value above 1 is never reached, so every
    #: model is tried.
    confidence_target: float = 0.9
    #: With ``model='all'``, which families to try and in what order.
    models: tuple[TransformModel, ...] | None = None
    #: With ``model='all'``, how much a more complex model must beat a simpler
    #: one by to replace it. Without it, a homography wins on a flat page by
    #: fitting the page's noise.
    model_preference_margin: float = 0.02
    #: Longest side used for feature detection. Bigger is more precise and
    #: quadratically slower.
    working_size: int = 1400
    #: Longest side used for the coarse guess.
    coarse_size: int = 512
    max_features: int = 1200
    #: Inlier radius for RANSAC, in working-resolution pixels.
    ransac_threshold: float = 3
    #: Fewer surviving correspondences than this and the feature stage is not
    #: trusted.
    min_inliers: int = 12
    #: Largest per-page skew the coarse stage considers, in degrees.
    max_skew_deg: float = 12
    #: Cap on how much bigger or smaller the scan may be than the original.
    max_scale_ratio: float = 6
    #: How far a correspondence may move, as a fraction of the page diagonal,
    #: after the coarse warp.
    max_displacement_ratio: float = 0.12
    #: Background/ink separation. The defaults suit printed pages on white.
    ink: InkOptions | None = None
    interpolation: Interpolation = "bilinear"
    #: RGBA fill where the scan does not cover the original's canvas.
    background: tuple[int, int, int, int] = (255, 255, 255, 255)
    #: Encoding of :attr:`AlignResult.image`. ``'none'`` skips encoding, which
    #: is most of the cost on a big page.
    output: ImageFormat | Literal["none"] = "png"
    #: Quality when :attr:`output` is a lossy format.
    quality: int = 92
    #: Seeds RANSAC and the descriptor pattern, so the same input gives the same
    #: matrix.
    seed: int = 0x5CA7F1


@dataclass(slots=True)
class ModelAttempt:
    """One model the sweep tried, and how it did."""

    model: TransformModel
    #: ``None`` when RANSAC found no consensus, so the model was never scored.
    confidence: float | None
    inliers: int
    inlier_ratio: float
    #: Mean RANSAC reprojection error over the inliers, in working-resolution
    #: pixels. ``NaN`` when rejected.
    reprojection_error: float
    #: RANSAC found no consensus worth trusting for this model.
    rejected: bool
    #: This attempt's transform is the one returned.
    #:
    #: The one mutable thing in this module, and the reason the class is not
    #: frozen: the TypeScript sets this on the winning attempt AFTER the sweep,
    #: by which time the attempt is already in the list. Freezing it would mean
    #: rebuilding the list and losing the identity that relies on.
    selected: bool = False


@dataclass(frozen=True, slots=True)
class SkewDegrees:
    """Each page's own skew, in degrees, as measured independently."""

    original: float
    scanned: float


@dataclass(frozen=True, slots=True)
class FeatureCounts:
    """How many keypoints each page yielded."""

    original: int
    scanned: int


@dataclass(frozen=True, slots=True)
class AlignDiagnostics:
    """Everything about how the answer was reached."""

    coarse_score: float
    coarse_strategy: str
    skew_deg: SkewDegrees
    features: FeatureCounts
    matches: int
    #: Inliers behind the returned transform. Zero when the coarse estimate was
    #: returned.
    inliers: int
    inlier_ratio: float
    #: Mean RANSAC reprojection error over the returned model's inliers, in
    #: working-resolution pixels.
    reprojection_error: float
    #: Ink correlation after alignment, in ``[-1, 1]``.
    correlation: float
    #: Ink mask overlap after alignment, in ``[0, 1]``.
    intersection_over_union: float
    #: The family of the returned transform. The coarse estimate is itself a
    #: similarity, so a coarse fallback reports ``similarity`` -
    #: :attr:`AlignResult.method` says which.
    selected_model: TransformModel
    #: Every model tried, in order. Its length says whether the sweep stopped
    #: early.
    attempts: list[ModelAttempt] = field(default_factory=list)
    #: Milliseconds spent, end to end.
    duration_ms: float = 0.0


@dataclass(frozen=True, slots=True, kw_only=True)
class AlignResult(AlignedImage):
    """The aligned page, and how far to trust it.

    ``confidence`` comes from :class:`~scanmate_ink.AlignedImage`. It is derived
    from ink correlation after warping, so it measures agreement in the OUTPUT
    rather than confidence in the process: above ~0.6 is a solid match on a
    printed page, and below ~0.3 the alignment should be treated as failed.
    """

    transform: TransformSummary
    #:
    #: ``features`` when RANSAC found a consensus, ``coarse`` when the coarse
    #: estimate had to stand alone.
    method: Literal["features", "coarse"]
    diagnostics: AlignDiagnostics
