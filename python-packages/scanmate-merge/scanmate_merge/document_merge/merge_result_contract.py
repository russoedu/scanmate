"""What a merge takes, and what it reports about what it did."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal, TypeAlias

from ..page_placement import PageSize

#: How a page got into the merged file.
Embedding: TypeAlias = Literal["pdf-page", "jpeg", "png", "encoded-png", "encoded-jpeg"]


@dataclass(frozen=True, slots=True)
class MergeMetadata:
    """Information dictionary for the merged file.

    The producer is always ``scanmate-merge``.
    """

    title: str | None = None
    author: str | None = None
    subject: str | None = None
    keywords: list[str] | None = None
    creator: str | None = None


@dataclass(frozen=True, slots=True)
class MergeOptions:
    """How to merge."""

    #: Opens an encrypted PDF source that needs a password to be read. The
    #: usual encrypted PDF - a signed or permission-restricted document, locked
    #: with an owner password alone - needs none and is decrypted as it is
    #: copied. The same password is tried on every encrypted source.
    password: str | None = None
    #: Size of each image page: the image at its resolution (``"image"``, the
    #: default), or a paper size to fit it in.
    page_size: PageSize = "image"
    #: Points of white kept around an image on a paper-size page.
    margin: float = 0
    #: Resolution for an image that does not say, or says 72 or 96.
    image_dpi: float = 150
    #: How to encode an image that cannot be embedded as it is - any format but
    #: JPEG and PNG, a JPEG that needs its EXIF rotation applied, a raster.
    #: ``"png"`` is lossless: a scan should not gain compression artefacts on
    #: its way into evidence. ``"jpeg"`` is a fraction of the size.
    encoding: Literal["png", "jpeg"] = "png"
    #: JPEG quality, 1-100, when :attr:`encoding` is ``"jpeg"``.
    quality: int = 92
    #: A single PDF on its own comes back byte for byte - stored exactly as
    #: scanned, signatures and all. Setting :attr:`metadata` turns it off, since
    #: that means writing a new file.
    pass_through: bool = True
    metadata: MergeMetadata | None = None
    on_progress: Callable[[Any], None] | None = None


@dataclass(frozen=True, slots=True)
class MergedPage:
    """How one page got into the merged file."""

    #: One-based, in the merged file.
    page: int
    #: One-based position of the source it came from, in the list given.
    source: int
    #: One-based page within that source - above one for a PDF or a multi-page TIFF.
    source_page: int
    kind: str
    #: ``"jpeg"`` is the source's own bytes and ``"png"`` its pixels,
    #: losslessly; the ``encoded-`` ones were decoded and encoded again.
    embedding: str
    #: Page width in points.
    width: float
    #: Page height in points.
    height: float
    #: Resolution the image was placed at; ``None`` for a PDF page.
    dpi: float | None


@dataclass(frozen=True, slots=True)
class MergeResult:
    """The merged document, and an account of what went into it."""

    pdf: bytes
    page_count: int
    pages: list[MergedPage] = field(default_factory=list)
    #: The single PDF given was returned unchanged.
    passed_through: bool = False
