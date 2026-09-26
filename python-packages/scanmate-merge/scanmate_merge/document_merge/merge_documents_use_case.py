"""Many files in, one PDF out."""

from __future__ import annotations

import io
import time
from collections.abc import Sequence
from typing import Any

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject
from scanmate_ink import ImageMetadata, Raster, decode_image, encode_image, read_image_metadata

from ..page_placement import place_image, resolve_dpi
from ..source_reading import (
    MergeSourceError,
    PdfPasswordError,
    ResolvedSource,
    open_pdf,
    read_source,
)
from .image_xobject_mapper import embed_jpeg, embed_pixels, image_page_content, image_resources
from .merge_result_contract import MergedPage, MergeOptions, MergeResult

#: PDF colour modes a JPEG may be embedded in as it stands. The TypeScript
#: tests libvips' `space` for `srgb` or `b-w`; Pillow reports the same two as
#: `RGB` and `L`. A CMYK JPEG is decoded and re-encoded instead, in both.
_DIRECT_JPEG_MODES = ("RGB", "L")


def merge_documents(
    sources: Sequence[Any], options: MergeOptions | None = None
) -> MergeResult:
    """Merge PDFs, images and rasters, in the order given, mixed freely.

    A PDF's pages are copied, not re-rendered, so their text layer, vectors and
    any signatures stay as they were. A JPEG with no EXIF rotation, in RGB or
    grey, is embedded as its own bytes, so a scan is not compressed a second
    time; a PNG's pixels are carried over losslessly. Anything else is decoded -
    EXIF rotation applied, transparency flattened onto white, every page of a
    multi-page TIFF - and encoded once.

    :param sources: What to merge.
    :param options: How to merge it.
    :returns: The merged document and an account of what went into it.
    :raises ValueError: ``sources`` is empty.
    :raises MergeSourceError: One of the sources could not be used.

    .. note::
       The produced **bytes** are not held to the TypeScript's, and cannot be:
       two PDF writers lay out objects, streams and the cross-reference table
       differently, so two valid merges of the same sources are never the same
       file. Every *decision* is held - the page count, which source each page
       came from, how it was embedded, its size and resolution - and so is the
       geometry, which is ordinary arithmetic.
    """
    settings = options if options is not None else MergeOptions()
    if len(sources) == 0:
        raise ValueError("nothing to merge")

    resolved = [read_source(source, index) for index, source in enumerate(sources)]

    writer = PdfWriter()
    pages: list[MergedPage] = []

    for index, source in enumerate(resolved):
        started = time.monotonic()
        _report(settings, "start", index, len(resolved), None, None)
        before = len(pages)

        if source.kind == "pdf":
            _append_pdf(writer, pages, source, index, settings)
        elif source.kind == "image":
            _append_image_file(writer, pages, source, index, settings)
        else:
            _append_raster(writer, pages, source, index, settings)

        _report(
            settings,
            "done",
            index,
            len(resolved),
            (time.monotonic() - started) * 1000,
            {"kind": source.kind, "pages": len(pages) - before},
        )

    first = resolved[0]
    if (
        settings.pass_through
        and settings.metadata is None
        and len(resolved) == 1
        and first.kind == "pdf"
    ):
        # Byte for byte, signatures and all. The only path that does not write
        # a new file, and the reason it exists: re-saving a signed PDF breaks
        # its signature, and a single PDF "merged" alone has nothing to merge.
        assert first.bytes_ is not None
        return MergeResult(
            pdf=first.bytes_, page_count=len(pages), pages=pages, passed_through=True
        )

    _apply_metadata(writer, settings)
    out = io.BytesIO()
    writer.write(out)

    return MergeResult(
        pdf=out.getvalue(), page_count=len(pages), pages=pages, passed_through=False
    )


def _report(
    settings: MergeOptions,
    phase: str,
    index: int,
    total: int,
    duration_ms: float | None,
    detail: dict[str, Any] | None,
) -> None:
    """Tell the caller where the merge has got to, when it asked."""
    if settings.on_progress is None:
        return
    event: dict[str, Any] = {
        "stage": "merge",
        "phase": phase,
        "page": index + 1,
        "index": index + 1,
        "total": total,
    }
    if duration_ms is not None:
        event["durationMs"] = duration_ms
    if detail is not None:
        event["detail"] = detail
    settings.on_progress(event)


def _apply_metadata(writer: PdfWriter, settings: MergeOptions) -> None:
    """Write the information dictionary. The producer is always this package."""
    info: dict[str, str] = {"/Producer": "scanmate-merge"}
    metadata = settings.metadata
    if metadata is not None:
        if metadata.title is not None:
            info["/Title"] = metadata.title
        if metadata.author is not None:
            info["/Author"] = metadata.author
        if metadata.subject is not None:
            info["/Subject"] = metadata.subject
        if metadata.keywords is not None:
            info["/Keywords"] = " ".join(metadata.keywords)
        if metadata.creator is not None:
            info["/Creator"] = metadata.creator
    writer.add_metadata(info)


def _append_pdf(
    writer: PdfWriter,
    pages: list[MergedPage],
    source: ResolvedSource,
    index: int,
    settings: MergeOptions,
) -> None:
    """Copy every page of a source PDF, as it is."""
    assert source.bytes_ is not None
    try:
        reader = open_pdf(source.bytes_, settings.password)
    except PdfPasswordError as error:
        raise MergeSourceError(
            index,
            "it is an encrypted PDF, and `password` does not open it"
            if error.given
            else "it is an encrypted PDF that needs a password to open - pass `password`",
        ) from error
    except Exception as error:
        raise MergeSourceError(index, f"it is not a readable PDF ({error})") from error

    for i, page in enumerate(reader.pages):
        writer.add_page(page)
        box = page.mediabox
        pages.append(
            MergedPage(
                page=len(pages) + 1,
                source=index + 1,
                source_page=i + 1,
                kind="pdf",
                embedding="pdf-page",
                width=float(box.width),
                height=float(box.height),
                dpi=None,
            )
        )


def _append_image_file(
    writer: PdfWriter,
    pages: list[MergedPage],
    source: ResolvedSource,
    index: int,
    settings: MergeOptions,
) -> None:
    """Embed an image file, as its own bytes where a PDF can hold them."""
    assert source.bytes_ is not None
    meta = _image_metadata(source.bytes_, index)
    dpi = resolve_dpi(None, meta.density, settings.image_dpi)
    upright = (meta.orientation or 1) == 1
    as_jpeg = meta.format == "jpeg" and upright and meta.mode in _DIRECT_JPEG_MODES
    as_png = meta.format == "png" and upright

    if meta.pages == 1 and (as_jpeg or as_png):
        image = (
            embed_jpeg(source.bytes_, meta.width, meta.height, meta.mode == "L")
            if as_jpeg
            else embed_pixels(decode_image(source.bytes_))
        )
        _place(
            writer, pages, image.stream, meta.width, meta.height, dpi,
            index, 1, "image", "jpeg" if as_jpeg else "png", settings,
        )

        return

    for page in range(meta.pages):
        raster = decode_image(source.bytes_, page=page)
        stream, embedding = _encode_and_embed(raster, settings)
        _place(
            writer, pages, stream, raster.width, raster.height, dpi,
            index, page + 1, "image", embedding, settings,
        )


def _image_metadata(data: bytes, index: int) -> ImageMetadata:
    """Read what the file says about itself, or say it is not an image."""
    try:
        return read_image_metadata(data)
    except Exception as error:
        raise MergeSourceError(
            index, "it is neither a PDF nor an image that can be read"
        ) from error


def _append_raster(
    writer: PdfWriter,
    pages: list[MergedPage],
    source: ResolvedSource,
    index: int,
    settings: MergeOptions,
) -> None:
    """Embed already-decoded pixels, or the bytes they came with."""
    raster = source.raster
    assert raster is not None
    dpi = resolve_dpi(source.dpi, None, settings.image_dpi)
    data = source.bytes_
    fmt = None if data is None else _embeddable_format(data)

    if data is not None and fmt is not None:
        meta = read_image_metadata(data)
        image = (
            embed_jpeg(data, raster.width, raster.height, meta.mode == "L")
            if fmt == "jpeg"
            else embed_pixels(raster)
        )
        _place(
            writer, pages, image.stream, raster.width, raster.height, dpi,
            index, 1, "raster", fmt, settings,
        )

        return

    stream, embedding = _encode_and_embed(raster, settings)
    _place(
        writer, pages, stream, raster.width, raster.height, dpi,
        index, 1, "raster", embedding, settings,
    )


def _encode_and_embed(
    raster: Raster, settings: MergeOptions
) -> tuple[DecodedStreamObject, str]:
    """Encode a raster once, the way the caller asked for."""
    if settings.encoding == "jpeg":
        jpeg = encode_image(raster, "jpeg", settings.quality)
        meta = read_image_metadata(jpeg)

        return (
            embed_jpeg(jpeg, raster.width, raster.height, meta.mode == "L").stream,
            "encoded-jpeg",
        )

    return embed_pixels(raster).stream, "encoded-png"


def _place(
    writer: PdfWriter,
    pages: list[MergedPage],
    stream: DecodedStreamObject,
    pixel_width: int,
    pixel_height: int,
    dpi: float,
    index: int,
    source_page: int,
    kind: str,
    embedding: str,
    settings: MergeOptions,
) -> None:
    """Add a page sized for the image, with the image on it."""
    placement = place_image(
        pixel_width, pixel_height, dpi, settings.page_size, settings.margin
    )
    page = writer.add_blank_page(placement.page_width, placement.page_height)
    name = "Im0"
    page[NameObject("/Resources")] = image_resources(name, stream)
    content = DecodedStreamObject()
    content.set_data(
        image_page_content(
            placement.x, placement.y, placement.width, placement.height, name
        )
    )
    page[NameObject("/Contents")] = content

    pages.append(
        MergedPage(
            page=len(pages) + 1,
            source=index + 1,
            source_page=source_page,
            kind=kind,
            embedding=embedding,
            width=placement.page_width,
            height=placement.page_height,
            dpi=dpi,
        )
    )


def _embeddable_format(data: bytes) -> str | None:
    """PNG or JPEG by signature - the two formats a PDF takes as they are."""
    if data[:4] == b"\x89PNG":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"

    return None
