"""Align a scan onto the page it was made from.

WHAT THIS IS FOR
-----------------

Two questions about a returned form are easy to answer once the scan sits
exactly on top of the original, and near-impossible before:

1. *Was anything in the printed text changed?* Run OCR on both and diff. That
   only works if the two are the same page at the same size, otherwise the OCR
   engine's own layout analysis is comparing different documents.
2. *Was the box at (x, y) signed?* That is a question about a fixed rectangle,
   and a fixed rectangle only means something once both images agree on where
   ``(x, y)`` is.

THE PIPELINE
-------------

::

  decode - ink - coarse guess - rough warp - features -+- RANSAC(similarity) - score -+
                 (scale/skew)                 (ORB)    +- RANSAC(affine)     - score -+- warp
                                                       +- RANSAC(homography) - score -+
  \\------------------ once, whatever the model --------/  \\----- per model, cheap ----/

The coarse guess exists to make the feature stage possible at all: binary
descriptors compare fixed pixel offsets, so they only match between images at
comparable scale, and nothing in a JPEG tells you what dpi it was scanned at.
Once the scan has been resampled to roughly the right size, matching is easy and
RANSAC can throw away the inevitable wrong matches - a page of text is full of
genuinely identical-looking corners.

CHOOSING THE MODEL
-------------------

With ``model='all'``, the default, everything left of the fork is done once:
decoding, ink separation, the coarse search, ORB on both pages and matching are
nearly all of the cost and do not depend on the transform family. Only RANSAC
and one scoring warp run per model, and neither is expensive - RANSAC touches no
pixels. The sweep tries models cheapest first, stops as soon as one reaches
``confidence_target``, and a more complex model must beat a simpler one by
``model_preference_margin`` to replace it. The full-resolution warp and the
encode happen once, for the winner.

If no model finds a consensus (a nearly blank form has few corners to find), the
coarse estimate is returned on its own, and ``method`` says so.

WHY THIS IS SYNCHRONOUS AND THE TYPESCRIPT IS NOT
--------------------------------------------------

``alignScan`` is ``async``, and its docstring says why: its codec runs in
libvips on libuv's threadpool, so during decode and encode the event loop
genuinely is free. That is a fact about Node and libvips, not about the
algorithm - between those two stages the TypeScript is as CPU-bound and
single-threaded as this is.

Python's decoder is Pillow and it is synchronous, so there is nothing to await
and an ``async def`` here would be a coroutine that never yields: it would
misrepresent the cost while forcing every caller into an event loop. The
departure is in the calling convention only. Every number this returns is the
TypeScript's, and the goldens hold it to them.
"""

from __future__ import annotations

import math
import time

from scanmate_ink import (
    Matrix3,
    ScanmateSource,
    TransformModel,
    WarpOptions,
    decode_image,
    decompose,
    encode_image,
    ink_map,
    invert,
    to_grayscale,
    warp_raster,
)

from ..coarse_estimation import CoarseOptions, estimate_coarse
from .align_result_contract import (
    AlignDiagnostics,
    AlignOptions,
    AlignResult,
    FeatureCounts,
    ModelAttempt,
    SkewDegrees,
)
from .alignment_referee_use_case import Agreement, create_referee, to_confidence
from .feature_refinement_algorithm import (
    FittingOptions,
    MatchingOptions,
    ResidualFit,
    fit_residual,
    prepare_matches,
)
from .model_selection_policy import DEFAULT_MODELS, ScoredModel, prefers, sweep_order


class _Contender:
    """The best fit so far, with everything needed to return it without recomputing.

    A plain class rather than a dataclass because it holds a reference to a
    :class:`ModelAttempt` that is already in the attempts list and gets its
    ``selected`` flag set afterwards - the identity matters.
    """

    __slots__ = ("agreement", "attempt", "confidence", "fit", "model")

    def __init__(
        self,
        model: TransformModel,
        fit: ResidualFit,
        agreement: Agreement,
        confidence: float,
        attempt: ModelAttempt,
    ) -> None:
        self.model = model
        self.fit = fit
        self.agreement = agreement
        self.confidence = confidence
        self.attempt = attempt


def align_scan(
    original: ScanmateSource,
    scanned: ScanmateSource,
    options: AlignOptions | None = None,
) -> AlignResult:
    """Put a scan back on the canvas of the page it came from.

    :param original: The page as it was printed.
    :param scanned: The page as it came back.
    :param options: Everything the aligner will take direction on.
    :returns: The aligned raster, the transform, a confidence and diagnostics.
    """
    started_at = time.monotonic()
    opts = AlignOptions() if options is None else options
    models = DEFAULT_MODELS if opts.models is None else opts.models

    candidates = sweep_order(models) if opts.model == "all" else [opts.model]

    original_raster = decode_image(original)
    scanned_raster = decode_image(scanned)

    original_ink = ink_map(to_grayscale(original_raster), opts.ink)
    scanned_ink = ink_map(to_grayscale(scanned_raster), opts.ink)

    # --- Model-independent, and nearly all of the cost: done once. ---

    coarse = estimate_coarse(
        original_ink,
        scanned_ink,
        CoarseOptions(
            working_size=opts.coarse_size,
            max_skew_deg=opts.max_skew_deg,
            max_scale_ratio=opts.max_scale_ratio,
        ),
    )
    prepared = prepare_matches(
        original_ink,
        scanned_ink,
        coarse,
        MatchingOptions(
            working_size=opts.working_size,
            max_features=opts.max_features,
            max_displacement_ratio=opts.max_displacement_ratio,
            seed=opts.seed,
        ),
    )
    judge = create_referee(original_ink, scanned_ink, opts.working_size)

    # --- Per model: RANSAC, one scoring warp. ---

    attempts: list[ModelAttempt] = []
    best: _Contender | None = None

    for candidate in candidates:
        fit = fit_residual(
            prepared,
            coarse,
            candidate,
            FittingOptions(
                ransac_threshold=opts.ransac_threshold,
                min_inliers=opts.min_inliers,
                seed=opts.seed,
            ),
        )
        if fit is None:
            attempts.append(
                ModelAttempt(
                    model=candidate,
                    confidence=None,
                    inliers=0,
                    inlier_ratio=0,
                    reprojection_error=math.nan,
                    rejected=True,
                    selected=False,
                )
            )
            continue

        agreement = judge(fit.matrix)
        confidence = to_confidence(agreement)
        attempt = ModelAttempt(
            model=candidate,
            confidence=confidence,
            inliers=fit.inliers,
            inlier_ratio=fit.inlier_ratio,
            reprojection_error=fit.reprojection_error,
            rejected=False,
            selected=False,
        )
        attempts.append(attempt)

        if prefers(
            ScoredModel(model=candidate, confidence=confidence),
            None if best is None else ScoredModel(model=best.model, confidence=best.confidence),
            opts.model_preference_margin,
        ):
            best = _Contender(candidate, fit, agreement, confidence, attempt)

        if best is not None and best.confidence >= opts.confidence_target:
            break

    # --- Once, for the winner: the full-resolution warp and the encode. ---

    matrix: Matrix3 = coarse.matrix if best is None else best.fit.matrix
    agreement = judge(matrix) if best is None else best.agreement
    # The coarse estimate is a similarity; that is what it reports when it
    # stands alone.
    selected_model: TransformModel = "similarity" if best is None else best.model
    if best is not None:
        best.attempt.selected = True

    raster = warp_raster(
        scanned_raster,
        matrix,
        original_raster.width,
        original_raster.height,
        WarpOptions(
            background=opts.background,
            interpolation=opts.interpolation,
            prefilter=True,
        ),
    )

    return AlignResult(
        raster=raster,
        image=None if opts.output == "none" else encode_image(raster, opts.output, opts.quality),
        # The aligned pixels sit on the original's canvas, so they are at its
        # resolution.
        dpi=None,
        width=raster.width,
        height=raster.height,
        matrix=matrix,
        inverse=invert(matrix),
        transform=decompose(matrix, selected_model),
        confidence=to_confidence(agreement),
        method="coarse" if best is None else "features",
        diagnostics=AlignDiagnostics(
            coarse_score=coarse.score,
            coarse_strategy=coarse.strategy,
            skew_deg=SkewDegrees(
                original=coarse.skew.original * 180 / math.pi,
                scanned=coarse.skew.scanned * 180 / math.pi,
            ),
            features=FeatureCounts(
                original=prepared.features.original,
                scanned=prepared.features.scanned,
            ),
            matches=len(prepared.matches),
            inliers=0 if best is None else best.fit.inliers,
            inlier_ratio=0 if best is None else best.fit.inlier_ratio,
            reprojection_error=math.nan if best is None else best.fit.reprojection_error,
            correlation=agreement.correlation,
            intersection_over_union=agreement.iou,
            selected_model=selected_model,
            attempts=attempts,
            duration_ms=(time.monotonic() - started_at) * 1000,
        ),
    )
