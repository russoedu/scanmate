"""A source resolved to what merging needs: its bytes and what they are, or its pixels."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeAlias
from urllib.parse import urlparse
from urllib.request import url2pathname

from scanmate_ink import Raster, is_raster

from .merge_source_contract import MergeSourceError

#: A PDF may carry junk before its header; readers look for it in the first kilobyte.
_PDF_HEADER = b"%PDF-"
_HEADER_WINDOW = 1024


@dataclass(frozen=True, slots=True)
class ResolvedSource:
    """A source, resolved. Content decides, never the file name.

    A scanner that saves a PDF as ``scan.jpg`` still gives a PDF.
    """

    #: ``"pdf"``, ``"image"`` or ``"raster"``.
    kind: str
    #: The source's bytes, or ``None`` for a raster given without them.
    bytes_: bytes | None = None
    #: The decoded pixels, for a raster source.
    raster: Raster | None = None
    #: The resolution the caller attached, when it did.
    dpi: float | None = None


#: Anything that can become pages of the merged PDF: a path, a file URL, bytes,
#: a decoded raster, or an image with its resolution.
ScanmateSource: TypeAlias = Any


def read_source(source: ScanmateSource, index: int) -> ResolvedSource:
    """Resolve one source to bytes or pixels.

    :param source: A path, a file URL, bytes, a raster, or ``{raster, dpi}``.
    :param index: Zero-based position in the list given, for error messages.
    :returns: What the source turned out to be.
    :raises MergeSourceError: It is empty, unreadable, or not a kind of source.

    .. note::
       ``readSource`` is ``async`` in the TypeScript because it reads files;
       this reads them synchronously, which is the convention the rest of the
       Python port uses.
    """
    if is_raster(source):
        return ResolvedSource(kind="raster", raster=source, dpi=None, bytes_=None)
    if _is_image_with_resolution(source):
        return ResolvedSource(
            kind="raster",
            raster=source["raster"],
            dpi=source.get("dpi"),
            bytes_=source.get("image"),
        )

    data = _read_bytes(source, index)
    if len(data) == 0:
        raise MergeSourceError(index, "it is empty")

    return (
        ResolvedSource(kind="pdf", bytes_=data)
        if is_pdf(data)
        else ResolvedSource(kind="image", bytes_=data, dpi=None)
    )


def is_pdf(data: bytes) -> bool:
    """Whether these bytes are a PDF, by looking for its header.

    :param data: The bytes to inspect.
    :returns: Whether ``%PDF-`` appears within the first kilobyte.
    """
    # The window is inclusive of 1024, matching the TypeScript's `start <= end`
    # - so a header beginning exactly at offset 1024 is found and one at 1025
    # is not.
    end = min(len(data) - len(_PDF_HEADER), _HEADER_WINDOW)
    for start in range(end + 1):
        if data[start : start + len(_PDF_HEADER)] == _PDF_HEADER:
            return True

    return False


def _is_image_with_resolution(source: ScanmateSource) -> bool:
    """Whether this is the pipeline's ``{raster, dpi}`` shape."""
    return isinstance(source, dict) and "raster" in source and is_raster(source["raster"])


def _read_bytes(source: ScanmateSource, index: int) -> bytes:
    """Read whatever kind of reference this is.

    :param source: A path, a file URL, or bytes.
    :param index: Zero-based position, for the error message.
    :returns: The bytes.
    :raises MergeSourceError: It could not be read, or is not a kind of source.
    """
    try:
        if isinstance(source, (bytes, bytearray, memoryview)):
            return bytes(source)
        if isinstance(source, os.PathLike):
            return Path(source).read_bytes()
        if isinstance(source, str):
            # A string may be a path or a file URL; the TypeScript takes a URL
            # object for the second, which Python has no separate type for.
            parsed = urlparse(source)

            return (
                Path(url2pathname(parsed.path)).read_bytes()
                if parsed.scheme == "file"
                else Path(source).read_bytes()
            )
    except OSError as error:
        raise MergeSourceError(index, f"it could not be read ({error})") from error

    raise MergeSourceError(
        index, "expected a path, a file URL, bytes, a raster or { raster, dpi }"
    )
