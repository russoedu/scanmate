"""Encoding and decoding, through Pillow.

Pillow is the codec and **only** the codec - the exact boundary ``sharp`` has
on the TypeScript side. Decode, encode, read metadata, count pages, and nothing
else.

WHAT DELIBERATELY IS NOT HERE, AND WHY
--------------------------------------

``resample_raster`` and ``blur_raster`` exist in the TypeScript and are absent
here. They are not an oversight and they are not a to-do: Pillow cannot
reproduce what libvips does, and the gap was measured rather than assumed, on
the same 64x48 page the goldens are built from.

===============  ==========================================================
operation        Pillow against libvips
===============  ==========================================================
PNG decode       identical, byte for byte
resize lanczos3  max difference 18, **78.8%** of pixels differ
blur sigma 1.7   max difference 29, **100%** of pixels differ
===============  ==========================================================

The blur is the clearer of the two: libvips' ``blur`` is an integer
APPROXIMATION of a Gaussian, built from a generated mask, not a Gaussian - so
no true Gaussian will ever match it, in Pillow or in numpy. Matching either
operation means reimplementing libvips' own algorithm, which is a decision
worth taking deliberately rather than discovering through a test that fails by
18 grey levels.

Until then, a caller needing a resampled page uses the TypeScript. Shipping an
approximation under the same name would be worse than the absence: every
downstream comparison would then differ for a reason nobody could see.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
from PIL import Image, ImageOps

from .raster_model import Raster, is_raster, to_bytes
from .source_contract import ScanmateSource

ImageFormat = Literal["png", "jpeg", "webp", "tiff"]

_RGBA = "RGBA"
_DEFAULT_QUALITY = 92


@dataclass(frozen=True, slots=True)
class ImageMetadata:
    """What the file says about itself, before any pixels are decoded."""

    format: str
    width: int
    height: int
    mode: str
    has_alpha: bool
    #: Pixels per inch as recorded in the file, or ``None`` when it records nothing.
    density: float | None
    #: EXIF orientation, 1-8, or ``None``. Values above 4 swap width and height.
    orientation: int | None
    #: Frames or pages. Above one for a multi-page TIFF - what a sheet-fed scanner emits.
    pages: int


def _open(source: Any) -> Image.Image:  # noqa: ANN401 - mirrors the TS union
    """Open an encoded source, whatever shape it arrived in.

    :param source: Bytes or a path.
    :returns: The opened, still-undecoded image.
    :raises ValueError: When the buffer is empty.
    """
    if isinstance(source, str):
        return Image.open(source)
    encoded = to_bytes(source)
    if not encoded:
        message = "cannot decode an empty image buffer"
        raise ValueError(message)

    return Image.open(io.BytesIO(encoded))


def decode_image(source: ScanmateSource, *, auto_orient: bool = True, page: int = 0) -> Raster:
    """Decode anything Pillow can read to RGBA.

    A :class:`Raster` passes straight through, so this is safe to call on a
    value that may already be decoded - which is what makes it cheap to align
    one page against several scans: decode once, reuse.

    :param source: A raster, encoded bytes, or a path.
    :param auto_orient: Apply the EXIF orientation tag. On by default, because
        ignoring it is a silent 90-degree error on any photograph taken in
        portrait - and the aligner's skew limit cannot recover from that.
    :param page: Page to read from a multi-page source such as a scanner's TIFF.
    :returns: The decoded raster.
    """
    if is_raster(source):
        return source

    with _open(source) as opened:
        if page:
            opened.seek(page)
        oriented = ImageOps.exif_transpose(opened) if auto_orient else opened
        rgba = (oriented or opened).convert(_RGBA)

        return Raster(np.asarray(rgba, dtype=np.uint8).copy())


def encode_image(
    image: Raster,
    image_format: ImageFormat = "png",
    quality: int = _DEFAULT_QUALITY,
) -> bytes:
    """Encode a raster.

    PNG by default, because a scan re-encoded as JPEG is a scan with new
    artefacts - and telling a real mark from an artefact is what the pipeline
    downstream of this exists to do.

    :param image: The raster to encode.
    :param image_format: The container to write.
    :param quality: JPEG and WebP quality, 1-100. Ignored for PNG and TIFF.
    :returns: The encoded bytes.
    """
    buffer = io.BytesIO()
    pillow_image = Image.fromarray(image.pixels, _RGBA)
    if image_format in {"jpeg"}:
        # JPEG has no alpha channel; flatten rather than let Pillow refuse.
        pillow_image = pillow_image.convert("RGB")
    options: dict[str, Any] = {"quality": quality} if image_format in {"jpeg", "webp"} else {}
    pillow_image.save(buffer, format=image_format.upper(), **options)

    return buffer.getvalue()


def read_image_metadata(source: Any) -> ImageMetadata:  # noqa: ANN401
    """Read what a file claims about itself without decoding its pixels.

    :param source: Encoded bytes or a path, never a decoded raster.
    :returns: The metadata.
    :raises TypeError: When handed a raster, which has no file to describe.
    """
    if is_raster(source):
        message = "read_image_metadata needs an encoded image or a path, not a decoded raster"
        raise TypeError(message)

    with _open(source) as opened:
        dpi = opened.info.get("dpi")
        exif = opened.getexif()

        return ImageMetadata(
            format=(opened.format or "unknown").lower(),
            width=opened.width,
            height=opened.height,
            mode=opened.mode,
            has_alpha="A" in opened.mode or "transparency" in opened.info,
            density=float(dpi[0]) if dpi else None,
            # 0x0112 is the EXIF Orientation tag.
            orientation=exif.get(0x0112),
            pages=getattr(opened, "n_frames", 1),
        )


def count_pages(source: Any) -> int:  # noqa: ANN401
    """How many pages a source holds.

    One for an ordinary image, more for a scanner's TIFF.

    :param source: Encoded bytes or a path.
    :returns: The page count.
    """
    return read_image_metadata(source).pages
