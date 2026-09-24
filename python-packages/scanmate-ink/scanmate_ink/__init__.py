"""scanmate-ink: the numeric core, ported from @scanmate/ink.

A parallel port, not a rewrite. The TypeScript remains the reference, and every
subfeature here is measured against goldens produced by running the real
TypeScript build - see ``tools/parity``.
"""

from .deterministic_sampling import create_random, gaussian
from .plane_geometry import (
    IDENTITY,
    Matrix3,
    Point,
    PointMatch,
    TransformModel,
    TransformSummary,
    apply_point,
    decompose,
    invert,
    is_plausible,
    multiply,
    normalize,
    similarity,
    solve,
)
from .raster_codec import (
    BinaryImage,
    GrayImage,
    Raster,
    clone_raster,
    count_pages,
    create_binary,
    create_gray,
    create_raster,
    decode_image,
    encode_image,
    is_raster,
    read_image_metadata,
)

__all__ = [
    "IDENTITY",
    "BinaryImage",
    "GrayImage",
    "Raster",
    "clone_raster",
    "count_pages",
    "create_binary",
    "create_gray",
    "create_raster",
    "create_random",
    "decode_image",
    "encode_image",
    "Matrix3",
    "Point",
    "PointMatch",
    "TransformModel",
    "TransformSummary",
    "apply_point",
    "decompose",
    "gaussian",
    "invert",
    "is_plausible",
    "is_raster",
    "multiply",
    "normalize",
    "similarity",
    "solve",
    "read_image_metadata",
]
