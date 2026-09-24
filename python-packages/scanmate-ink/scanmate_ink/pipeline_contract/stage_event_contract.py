"""Progress, reported the same way by every stage.

One shape, defined once, so that an orchestrator can forward every stage's
progress to one callback without adapting eight different signatures. It is
also the only logging seam: a published package never imports an application's
logger, it reports here and lets the host decide what a log line looks like.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

#: Which stage of the pipeline is reporting.
PipelineStage = Literal["merge", "extract", "align", "enhance", "ocr", "diff", "find", "audit"]

#: ``start`` before a page is worked on, ``done`` after.
StagePhase = Literal["start", "done"]


@dataclass(frozen=True, slots=True)
class StageEvent:
    """One page, starting or finishing, in one stage."""

    stage: PipelineStage
    phase: StagePhase
    #: One-based page number in the original document.
    page: int
    #: One-based position in this run, and how many pages the run holds.
    index: int
    total: int
    #: Milliseconds the page took. Present on ``done`` only.
    duration_ms: float | None = None
    #: Stage-specific facts worth logging, e.g. the model an alignment settled
    #: on. A ``Mapping`` rather than a ``dict`` so the annotation says the
    #: callback may read it and must not write to it.
    detail: Mapping[str, Any] | None = None


#: Receives :class:`StageEvent`s.
#:
#: Must not raise; an exception out of here aborts the stage. That is the
#: TypeScript's contract too, and it is the reason this is a plain callable
#: rather than something with a richer protocol - there is nothing useful a
#: progress sink can tell the pipeline, and pretending otherwise invites a
#: logger to take a stage down.
ProgressCallback = Callable[[StageEvent], None]
