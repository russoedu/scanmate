"""What a PDF page says about itself, without anything being rendered."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, TypeAlias

from scanmate_ink import PdfTextRun, ScanmateRect

#: - ``vector`` - born-digital: text and drawing operators, perhaps a logo.
#: - ``scanned`` - one bitmap covering the page, and no text: a scan.
#: - ``scanned-with-text-layer`` - a scan with an OCR layer on top, as many
#:   scanners produce.
#: - ``empty`` - nothing to read at all.
PageKind: TypeAlias = Literal["vector", "scanned", "scanned-with-text-layer", "empty"]

#: ``mask`` for a one-bit stencil - how bi-level fax-style scans are usually
#: stored - otherwise what the reader decoded it to. ``None`` when the image was
#: not resolved.
ColorKind: TypeAlias = Literal["mask", "gray-1bpp", "rgb-24bpp", "rgba-32bpp"] | None


@dataclass(frozen=True, slots=True)
class EmbeddedImage:
    """One bitmap painted on the page."""

    #: Intrinsic pixel size of the image as stored.
    width: int
    height: int
    #: Size it is painted at, in PDF points (1/72 inch).
    placed_width: float
    placed_height: float
    #: Pixels per inch as painted, per axis.
    dpi_x: float
    dpi_y: float
    color_kind: ColorKind = None


@dataclass(frozen=True, slots=True)
class PageMetadata:
    """Everything a later stage needs before a page is rendered.

    ``kind`` and ``effective_dpi`` decide how to render, ``text`` gives
    ``scanmate-ocr`` ground truth for a born-digital original, and
    ``embedded_images`` is the evidence behind both.
    """

    #: One-based.
    page: int
    #: Page size in PDF points (1/72 inch), before rotation.
    point_width: float
    point_height: float
    #: Clockwise rotation the page asks to be displayed at. Rendering applies it.
    rotation: int
    #: The page's MediaBox, in points.
    media_box: ScanmateRect
    kind: PageKind
    #: Fraction of the page area covered by painted bitmaps, in ``[0, 1]``.
    #:
    #: This, not the NUMBER of images, is what separates a scan from a document
    #: with a letterhead logo: measured on a real born-digital order form, the
    #: logo covers 1.2% of the page; every page of its scans, 100%.
    image_coverage: float
    has_text_layer: bool
    #: The page's own text, with line ends as newlines, or ``None`` when there
    #: is none.
    text: str | None
    #: Every run of the text layer, placed on the page as displayed, in points
    #: from the top-left. Empty when there is no text layer.
    text_items: list[PdfTextRun] = field(default_factory=list)
    character_count: int = 0
    embedded_images: list[EmbeddedImage] = field(default_factory=list)
    #: The page's real resolution when it is a scan: the covering bitmap's
    #: pixels over the page's inches. ``None`` for anything that is not a scan,
    #: because a logo's resolution says nothing about the page.
    effective_dpi: float | None = None
