"""Align every page pair a document produced, and hand each back with its alignment."""

from __future__ import annotations

import dataclasses
from collections.abc import Sequence
from dataclasses import dataclass

from scanmate_ink import AlignedPage, ProgressCallback, ScanPage, StageEvent

from .align_result_contract import AlignOptions, AlignResult
from .align_scan_use_case import align_scan


@dataclass(frozen=True, slots=True)
class AlignPagesOptions:
    """:class:`AlignOptions`, plus the one logging seam.

    Composition rather than inheritance, and deliberately: the TypeScript writes
    ``extends AlignOptions`` because a TypeScript interface can be widened for
    free, while a frozen dataclass subclass would have to restate all twenty
    fields and keep them in step forever. ``align`` holds the alignment options
    and ``on_progress`` sits beside it.
    """

    align: AlignOptions = dataclasses.field(default_factory=AlignOptions)
    #: Called before and after each page. The only logging seam - see
    #: :class:`~scanmate_ink.StageEvent`.
    on_progress: ProgressCallback | None = None


def align_pages(
    pages: Sequence[ScanPage],
    options: AlignPagesOptions | None = None,
) -> list[AlignedPage[AlignResult]]:
    """Align every page pair, in order.

    Pages run one after another, not concurrently. The estimator is CPU-bound
    and synchronous, so starting several on one thread only interleaves them and
    makes each slower; real parallelism needs worker processes, which is a
    decision for the caller or an orchestrator, not for a library call.

    Every page passes through with ``aligned`` added - whatever else the producer
    attached is still there, because the page is copied rather than rebuilt.

    :param pages: The page pairs, typically from ``scanmate-extract``.
    :param options: Alignment options and the progress callback.
    :returns: One :class:`~scanmate_ink.AlignedPage` per input page, in order.
    """
    opts = AlignPagesOptions() if options is None else options
    aligned: list[AlignedPage[AlignResult]] = []

    for position, page in enumerate(pages):
        index = position + 1
        if opts.on_progress is not None:
            opts.on_progress(
                StageEvent(
                    stage="align",
                    phase="start",
                    page=page.page,
                    index=index,
                    total=len(pages),
                )
            )

        result = align_scan(page.original.raster, page.scanned.raster, opts.align)
        aligned.append(
            AlignedPage(
                page=page.page,
                original=page.original,
                scanned=page.scanned,
                aligned=result,
            )
        )

        if opts.on_progress is not None:
            opts.on_progress(
                StageEvent(
                    stage="align",
                    phase="done",
                    page=page.page,
                    index=index,
                    total=len(pages),
                    duration_ms=result.diagnostics.duration_ms,
                    detail={
                        "confidence": result.confidence,
                        "model": result.diagnostics.selected_model,
                        "method": result.method,
                        "attempts": len(result.diagnostics.attempts),
                    },
                )
            )

    return aligned
