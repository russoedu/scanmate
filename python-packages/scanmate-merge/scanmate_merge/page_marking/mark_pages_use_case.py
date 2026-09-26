"""Draw each mark on the original, with its bleed around it."""

from __future__ import annotations

import io
import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from pypdf import PdfWriter
from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, NameObject
from scanmate_ink import (
    Bleed,
    ScanmateRect,
    grow_by,
    has_bleed,
    resolve_bleed,
    resolve_region_bleed,
)

from ..source_reading import open_pdf, read_source
from .page_mark_contract import MarkOptions, MarkResult, PageMark
from .page_viewport_mapper import PageGeometry, to_user_space, viewport_size, viewport_transform

#: The colours of the audit's evidence page, so the two read the same way: the
#: region in blue, its bleed in magenta.
_REGION = (0.0, 23 / 255, 252 / 255)
_BLEED = (245 / 255, 0.0, 252 / 255)
_LABEL_SIZE = 7
#: Chosen not to collide with a resource the document already names.
_FONT_NAME = "F-scanmate-label"


@dataclass(frozen=True, slots=True)
class _Box:
    """A rectangle in the PDF's own coordinates."""

    x: float
    y: float
    width: float
    height: float


def mark_pages(
    pdf: Any, marks: Sequence[PageMark], options: MarkOptions | None = None
) -> MarkResult:
    """Draw the marks and hand the PDF back.

    A way to see whether the positions a validation will use are where the
    fields actually are, before anything is measured with them.

    Drawn on the document itself, as vectors: the page is not re-rendered, so it
    stays sharp at any zoom and the boxes sit exactly where their coordinates
    say. Nothing is aligned or adjusted, because there is nothing to align -
    this is the original, and the marks were measured against it.

    :param pdf: The document, as a path, file URL or bytes.
    :param marks: The regions to draw.
    :param options: How to draw them.
    :returns: The marked document, how many were drawn, and what was wrong.
    :raises TypeError: What was given is not a PDF.

    .. note::
       The marked file's **bytes** are not held to the TypeScript's - see
       :func:`~scanmate_merge.merge_documents` for why no two PDF writers agree.
       The geometry is: where each box lands in user space is the same
       arithmetic, and it is checked against the TypeScript's own numbers.
    """
    settings = options if options is not None else MarkOptions()
    source = read_source(pdf, 0)
    if source.kind != "pdf":
        raise TypeError("marks are drawn on a PDF, and this is not one")

    assert source.bytes_ is not None
    # Decrypted if encrypted, as a signed document usually is - see `open_pdf`
    # for why that and not "ignore the encryption", which silently drops every
    # mark into a file a viewer then decrypts into nothing.
    reader = open_pdf(source.bytes_, settings.password)
    writer = PdfWriter()
    writer.append_pages_from_reader(reader)

    bleed = resolve_bleed(
        Bleed(
            bleed=settings.bleed,
            bleed_top=settings.bleed_top,
            bleed_right=settings.bleed_right,
            bleed_bottom=settings.bleed_bottom,
            bleed_left=settings.bleed_left,
        )
    )
    pages = writer.pages
    warnings: list[str] = []
    drawn = 0

    for mark in marks:
        name = mark.id if mark.id is not None else f"mark {drawn + len(warnings) + 1}"
        if mark.page < 1 or mark.page > len(pages):
            warnings.append(
                f"{name} is on page {mark.page}, and the document has {len(pages)}"
            )
            continue

        page = pages[mark.page - 1]
        geometry = _geometry_of(page)
        size = viewport_size(geometry)
        if (
            mark.x < 0
            or mark.y < 0
            or mark.x + mark.width > size.width
            or mark.y + mark.height > size.height
        ):
            warnings.append(
                f"{name} reaches past the edge of page {mark.page}, "
                f"which is {_round(size.width)} x {_round(size.height)} pt"
            )

        operations: list[str] = []
        # The band first, so the region's own outline draws over it where they
        # meet.
        room = resolve_region_bleed(
            Bleed(
                bleed=mark.bleed,
                bleed_top=mark.bleed_top,
                bleed_right=mark.bleed_right,
                bleed_bottom=mark.bleed_bottom,
                bleed_left=mark.bleed_left,
            ),
            bleed,
        )
        if has_bleed(room):
            grown = grow_by(
                ScanmateRect(x=mark.x, y=mark.y, width=mark.width, height=mark.height),
                room,
            )
            operations.append(
                _rectangle(_user_box(geometry, grown), _BLEED, width=0.6, dashed=True)
            )
        operations.append(
            _rectangle(
                _user_box(
                    geometry,
                    ScanmateRect(x=mark.x, y=mark.y, width=mark.width, height=mark.height),
                ),
                _REGION,
                width=0.9,
                dashed=False,
            )
        )
        if settings.labels and mark.id is not None:
            operations.append(_label(geometry, mark))
            _register_font(page)

        _append_content(page, "\n".join(operations))
        drawn += 1

    out = io.BytesIO()
    writer.write(out)

    return MarkResult(pdf=out.getvalue(), drawn=drawn, warnings=warnings)


def _geometry_of(page: Any) -> PageGeometry:
    """The page's visible box and rotation, as pdf.js would read them."""
    crop = page.cropbox
    rotation = page.get("/Rotate", 0)

    return PageGeometry(
        view=(float(crop.left), float(crop.bottom), float(crop.right), float(crop.top)),
        rotation=float(rotation or 0),
    )


def _user_box(geometry: PageGeometry, rect: ScanmateRect) -> _Box:
    """A rectangle measured as displayed, in the PDF's own coordinates.

    A quarter turn keeps a rectangle a rectangle, so its corners are taken back
    to user space and their extent is the box to draw.
    """
    transform = viewport_transform(geometry)
    first = to_user_space(transform, rect.x, rect.y)
    second = to_user_space(transform, rect.x + rect.width, rect.y + rect.height)

    return _Box(
        x=min(first.x, second.x),
        y=min(first.y, second.y),
        width=abs(second.x - first.x),
        height=abs(second.y - first.y),
    )


def _rectangle(
    box: _Box, colour: tuple[float, float, float], width: float, dashed: bool
) -> str:
    """The operators that stroke one box."""
    red, green, blue = colour
    dash = "[2.5 1.5] 0 d" if dashed else "[] 0 d"

    return (
        f"q {_n(red)} {_n(green)} {_n(blue)} RG {_n(width)} w {dash} "
        f"{_n(box.x)} {_n(box.y)} {_n(box.width)} {_n(box.height)} re S Q"
    )


def _label(geometry: PageGeometry, mark: PageMark) -> str:
    """The id inside the box's top-left corner, upright to the reader.

    Inside rather than above: on the original a field is empty, so the corner is
    free, while the space above it is usually the printed line before - and a
    label written over that would obscure the very edge being checked.
    """
    at = to_user_space(
        viewport_transform(geometry), mark.x + 2, mark.y + _LABEL_SIZE
    )
    # Text is laid in user space; turning it with the page keeps it readable.
    radians = math.radians(geometry.rotation)
    cos = round(math.cos(radians), 10)
    sin = round(math.sin(radians), 10)
    red, green, blue = _REGION

    return (
        f"q BT /{_FONT_NAME} {_LABEL_SIZE} Tf {_n(red)} {_n(green)} {_n(blue)} rg "
        f"{_n(cos)} {_n(sin)} {_n(-sin)} {_n(cos)} {_n(at.x)} {_n(at.y)} Tm "
        f"({_escape(mark.id or '')}) Tj ET Q"
    )


def _register_font(page: Any) -> None:
    """Name Helvetica in the page's resources, once.

    One of the base fourteen, so nothing is embedded and the file grows by a
    dictionary rather than by a font.
    """
    resources = page.get("/Resources")
    if resources is None:
        resources = DictionaryObject()
        page[NameObject("/Resources")] = resources
    fonts = resources.get("/Font")
    if fonts is None:
        fonts = DictionaryObject()
        resources[NameObject("/Font")] = fonts
    if f"/{_FONT_NAME}" in fonts:
        return

    helvetica = DictionaryObject()
    helvetica[NameObject("/Type")] = NameObject("/Font")
    helvetica[NameObject("/Subtype")] = NameObject("/Type1")
    helvetica[NameObject("/BaseFont")] = NameObject("/Helvetica")
    helvetica[NameObject("/Encoding")] = NameObject("/WinAnsiEncoding")
    fonts[NameObject(f"/{_FONT_NAME}")] = helvetica


def _append_content(page: Any, operations: str) -> None:
    """Add a content stream after whatever the page already draws."""
    stream = DecodedStreamObject()
    stream.set_data(operations.encode("latin-1", errors="replace"))
    existing = page.get("/Contents")
    if existing is None:
        page[NameObject("/Contents")] = stream

        return
    contents = existing if isinstance(existing, ArrayObject) else ArrayObject([existing])
    # A `q`/`Q` pair around each addition keeps the page's own graphics state
    # from leaking into the marks, and the marks' from leaking back.
    page[NameObject("/Contents")] = ArrayObject([*contents, stream])


def _escape(text: str) -> str:
    """A PDF literal string: the three characters that end or nest one."""
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def _n(value: float) -> str:
    """A number as a content stream writes it, without an exponent."""
    return f"{value:.6f}".rstrip("0").rstrip(".") or "0"


def _round(value: float) -> str:
    """One decimal place, formatted as JavaScript would put it in a message.

    `Math.round(v * 10) / 10` gives 200 for an A4-ish width, and JavaScript
    prints that as "200"; Python's equivalent is 200.0 and prints "200.0". The
    warning is user-facing text held to the TypeScript's, so the trailing
    ".0" has to go.
    """
    rounded = math.floor(value * 10 + 0.5) / 10

    return str(int(rounded)) if rounded == int(rounded) else str(rounded)
