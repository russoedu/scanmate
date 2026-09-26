"""An image, as the PDF object that holds it.

Two ways in, matching what the TypeScript's ``embedJpg`` and ``embedPng`` do:

- **JPEG**: the file's own bytes, carried straight through as ``/DCTDecode``.
  Nothing is decoded and nothing is re-compressed, so a scan does not acquire a
  second generation of artefacts on its way into evidence.
- **Pixels**: deflated as ``/FlateDecode``. Note this is *not* the PNG file - a
  PDF cannot hold one - it is the PNG's pixels, losslessly, which is exactly
  what pdf-lib's ``embedPng`` does too.
"""

from __future__ import annotations

import zlib
from dataclasses import dataclass

import numpy
from pypdf.generic import (
    ArrayObject,
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
    NumberObject,
)
from scanmate_ink import Raster


@dataclass(frozen=True, slots=True)
class EmbeddedImage:
    """A PDF image XObject and the pixel dimensions it was built from."""

    stream: DecodedStreamObject
    width: int
    height: int


def _xobject(
    data: bytes,
    width: int,
    height: int,
    colour_space: str,
    filters: list[str],
    bits: int = 8,
) -> DecodedStreamObject:
    """Build the image XObject itself.

    :param data: The stream's already-encoded bytes.
    :param width: Pixel width.
    :param height: Pixel height.
    :param colour_space: ``DeviceRGB`` or ``DeviceGray``.
    :param filters: The ``/Filter`` chain, outermost first.
    :param bits: Bits per component.
    :returns: The XObject.
    """
    stream = DecodedStreamObject()
    stream.set_data(data)
    stream[NameObject("/Type")] = NameObject("/XObject")
    stream[NameObject("/Subtype")] = NameObject("/Image")
    stream[NameObject("/Width")] = NumberObject(width)
    stream[NameObject("/Height")] = NumberObject(height)
    stream[NameObject("/ColorSpace")] = NameObject(f"/{colour_space}")
    stream[NameObject("/BitsPerComponent")] = NumberObject(bits)
    stream[NameObject("/Filter")] = ArrayObject([NameObject(f"/{f}") for f in filters])

    return stream


def embed_jpeg(data: bytes, width: int, height: int, greyscale: bool) -> EmbeddedImage:
    """Carry a JPEG's own bytes into the PDF, uncompressed a second time.

    :param data: The JPEG file.
    :param width: Its pixel width.
    :param height: Its pixel height.
    :param greyscale: Whether it has one component rather than three.
    :returns: The image object.
    """
    return EmbeddedImage(
        stream=_xobject(
            data,
            width,
            height,
            "DeviceGray" if greyscale else "DeviceRGB",
            ["DCTDecode"],
        ),
        width=width,
        height=height,
    )


def embed_pixels(raster: Raster) -> EmbeddedImage:
    """Carry a raster's pixels into the PDF, losslessly.

    Alpha is dropped by flattening onto white before this is reached, so what
    arrives is always opaque; a PDF would otherwise need a separate soft-mask
    stream, and a half-transparent page in evidence is nobody's intent.

    :param raster: The decoded image.
    :returns: The image object.
    """
    # A ScanMate raster is always RGBA, so the alpha column is always present
    # and always dropped. Flattening onto white happens before this, in the
    # decode, exactly as the TypeScript does it.
    rgb = numpy.ascontiguousarray(raster.pixels[:, :, :3])

    return EmbeddedImage(
        stream=_xobject(
            zlib.compress(rgb.tobytes(), 9),
            raster.width,
            raster.height,
            "DeviceRGB",
            ["FlateDecode"],
        ),
        width=raster.width,
        height=raster.height,
    )


def image_page_content(x: float, y: float, width: float, height: float, name: str) -> bytes:
    """The content stream that draws one image at one place.

    :param x: Points from the page's left edge.
    :param y: Points from the page's bottom edge.
    :param width: Drawn width in points.
    :param height: Drawn height in points.
    :param name: The resource name the image is registered under.
    :returns: The content stream.
    """
    # `cm` sets the image's box: a PDF image is always drawn into the unit
    # square, so the matrix IS the placement.
    return (
        f"q {_number(width)} 0 0 {_number(height)} {_number(x)} {_number(y)} cm "
        f"/{name} Do Q"
    ).encode("latin-1")


def image_resources(name: str, stream: DecodedStreamObject) -> DictionaryObject:
    """The ``/Resources`` dictionary naming one image.

    :param name: The resource name.
    :param stream: The image XObject.
    :returns: The resources dictionary.
    """
    xobjects = DictionaryObject()
    xobjects[NameObject(f"/{name}")] = stream
    resources = DictionaryObject()
    resources[NameObject("/XObject")] = xobjects

    return resources


def _number(value: float) -> str:
    """A number as a PDF content stream writes it, without an exponent."""
    return f"{value:.6f}".rstrip("0").rstrip(".") or "0"
