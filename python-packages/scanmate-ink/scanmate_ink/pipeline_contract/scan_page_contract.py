"""The shapes the pipeline stages hand one another.

They live here rather than beside whichever stage produces them so that no
stage has to import another to accept its output: the aligner accepts what the
extractor produces without depending on it, and the comparison and the reader
accept what the aligner produces the same way. Each stage consumes the previous
one's output structurally, which is what lets an orchestrator later be a plain
pipe rather than a layer of adapters.

WHERE ``None`` MEANS SOMETHING
-------------------------------

Two fields are nullable and neither is an oversight. ``image`` is ``None`` when
the producer skipped encoding, which is the common case inside a pipeline that
never writes the intermediate to disk. ``dpi`` is ``None`` when nothing said -
a bare image file carries no resolution, and guessing one silently would put
every downstream measurement on a fabricated scale.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Generic, TypeVar

from ..plane_geometry import Matrix3
from ..raster_codec import Raster
from .text_run_contract import TextRun


@dataclass(frozen=True, slots=True, kw_only=True)
class PageImage:
    """One side of a page pair: the pixels, and what the producer knew about them."""

    raster: Raster
    #: ``raster`` encoded, or ``None`` when the producer skipped encoding.
    #:
    #: Required, NOT defaulted - the TypeScript writes `Uint8Array | null`,
    #: which is a required member whose value may be null, and that is the
    #: point: a producer has to SAY it skipped encoding rather than leave the
    #: question unanswered.
    image: bytes | None
    width: int
    height: int
    #: Resolution the raster was produced at, or ``None`` when nothing said -
    #: a bare image file carries none. Required for the same reason, and
    #: defaulting it to 72 or 300 would put every downstream measurement on a
    #: fabricated scale.
    dpi: float | None


@dataclass(frozen=True, slots=True, kw_only=True)
class ScanPage:
    """A page of the original and the matching page of what came back."""

    #: One-based page number in the original.
    page: int
    original: PageImage
    scanned: PageImage


@dataclass(frozen=True, slots=True, kw_only=True)
class AlignedImage(PageImage):
    """What a downstream stage needs from an alignment.

    The aligner's own result carries this and a good deal more; any stage that
    only needs the aligned pixels and the transform asks for this, so it stays
    independent of the aligner that produced them.
    """

    #: Maps original coordinates to scanned coordinates.
    matrix: Matrix3
    #: Maps scanned coordinates back to original coordinates.
    inverse: Matrix3
    #: How far to trust the alignment, in ``[0, 1]``.
    confidence: float


_Aligned = TypeVar("_Aligned", bound=AlignedImage)


@dataclass(frozen=True, slots=True, kw_only=True)
class AlignedPage(ScanPage, Generic[_Aligned]):
    """A :class:`ScanPage` with the scan put back on the original's canvas.

    Generic in the alignment, so a stage that produces a richer one can hand it
    on without the type being widened back to the minimum.
    """

    aligned: _Aligned


@dataclass(frozen=True, slots=True, kw_only=True)
class OriginalMetadata:
    """What is known about the ORIGINAL, separately from the scan.

    Only the original's text layer is ever used. A scan's own text layer is
    ignored, deliberately - hidden or stale text must not vouch for what the
    paper shows, and giving it nowhere to live here is how that is enforced
    rather than merely intended.
    """

    text_items: tuple[TextRun, ...] | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class ReadablePage(AlignedPage[AlignedImage]):
    """A page a reader can work on.

    Aligned, optionally cleaned, and optionally carrying the original's own
    text layer.
    """

    enhanced: PageImage | None = None
    metadata: OriginalMetadata = field(default_factory=OriginalMetadata)
