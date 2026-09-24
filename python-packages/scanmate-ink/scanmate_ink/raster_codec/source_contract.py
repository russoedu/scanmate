"""What the codec accepts, and the one colour tuple everything writes.

Two names, and the split is the TypeScript's. :data:`ScanmateBinarySource` is
bytes, or where to find them, and is what anything reading a document format
asks for: a PDF is bytes and nothing more, because a raster is not a PDF.
:data:`ScanmateSource` adds the already-decoded shapes, and is what the image
codec accepts - which is what lets a caller decode one page once and align it
against several scans without deciding each time whether it has been decoded
yet.

These are aliases rather than classes because that is all they are in the
TypeScript too: a union, used to name an argument. Giving them a name here
replaces an ``Any`` on the codec's front door with something a reader and a
type checker can both act on.
"""

from __future__ import annotations

from os import PathLike

from .raster_model import Raster

#: Bytes, or where to find them.
ScanmateBinarySource = str | PathLike[str] | bytes | bytearray | memoryview

#: Anything the image codec accepts, decoded or not.
ScanmateSource = ScanmateBinarySource | Raster

#: One RGBA colour. A tuple rather than a list, so it cannot be edited in place
#: by a caller that received it from somewhere else.
Rgba = tuple[int, int, int, int]
