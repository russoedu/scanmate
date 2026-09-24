"""The two image shapes everything speaks, and the bytes they come from."""

from .image_codec_client import (
    ImageFormat,
    ImageMetadata,
    count_pages,
    decode_image,
    encode_image,
    read_image_metadata,
)
from .raster_model import (
    BinaryImage,
    GrayImage,
    Raster,
    clone_raster,
    create_binary,
    create_gray,
    create_raster,
    is_raster,
    to_bytes,
)
from .source_contract import Rgba, ScanmateBinarySource, ScanmateSource

__all__ = [
    "BinaryImage",
    "GrayImage",
    "ImageFormat",
    "ImageMetadata",
    "Raster",
    "Rgba",
    "ScanmateBinarySource",
    "ScanmateSource",
    "clone_raster",
    "count_pages",
    "create_binary",
    "create_gray",
    "create_raster",
    "decode_image",
    "encode_image",
    "is_raster",
    "read_image_metadata",
    "to_bytes",
]
