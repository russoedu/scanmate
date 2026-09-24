"""The codec boundary, measured against the TypeScript.

The golden page is not a fixture: it is BUILT from the seeded PRNG, by the
TypeScript when the goldens are written and again here when they are checked.
So the first test below is really two claims at once - that the codec agrees,
and that the PRNG port is still exact on a page-sized run rather than only on
the eight draws its own tests take.
"""

from __future__ import annotations

import base64
import io
import json
from pathlib import Path

import numpy as np
import numpy.typing as npt
import pytest

from ..deterministic_sampling import create_random
from .image_codec_client import (
    count_pages,
    decode_image,
    encode_image,
    read_image_metadata,
)
from .raster_model import Raster, create_raster, is_raster

_GOLDEN = json.loads(
    (Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "raster.json").read_text(
        encoding="utf-8",
    ),
)

_MAX_BYTE = 256


def _expected_pixels() -> npt.NDArray[np.uint8]:
    """:returns: The page exactly as the TypeScript built it."""
    return np.array(_GOLDEN["pixels"], dtype=np.uint8).reshape(
        _GOLDEN["height"], _GOLDEN["width"], 4,
    )


def _rebuild_page() -> Raster:
    """Rebuild the golden page here, from the same seed the TypeScript used.

    :returns: The rebuilt raster.
    """
    page = create_raster(_GOLDEN["width"], _GOLDEN["height"])
    random = create_random(_GOLDEN["seed"])
    for pixel in page.pixels.reshape(-1, 4):
        pixel[0] = int(random() * _MAX_BYTE)
        pixel[1] = int(random() * _MAX_BYTE)
        pixel[2] = int(random() * _MAX_BYTE)
        pixel[3] = 255

    return page


def _golden_png() -> bytes:
    """:returns: The PNG the TypeScript encoded."""
    return base64.b64decode(_GOLDEN["pngBase64"])


def test_the_prng_rebuilds_the_identical_page() -> None:
    """The PRNG port, exercised on 12 288 draws rather than eight.

    Its own tests pin the first handful of values per seed. This pins that it
    stays in step across a whole page - which is the length of run every real
    caller makes.
    """
    assert np.array_equal(_rebuild_page().pixels, _expected_pixels())


def test_decodes_the_typescripts_png_to_identical_pixels() -> None:
    """PNG is lossless, so this is exact equality and nothing weaker.

    Measured before it was relied on: Pillow and libvips agree byte for byte on
    PNG. They do NOT agree on resize or blur, which is why neither is ported.
    """
    assert np.array_equal(decode_image(_golden_png()).pixels, _expected_pixels())


def test_round_trips_through_its_own_encoder() -> None:
    """The encoders need not produce identical BYTES - only identical pixels.

    Two PNG encoders may choose different filters and compression and still be
    perfectly correct, so asserting on the encoded bytes would pin an
    implementation detail of libvips rather than the behaviour that matters.
    """
    page = _rebuild_page()

    assert np.array_equal(decode_image(encode_image(page)).pixels, page.pixels)


def test_a_decoded_raster_passes_straight_through() -> None:
    """What makes it cheap to align one page against several scans."""
    page = _rebuild_page()

    assert decode_image(page) is page


def test_metadata_agrees_with_the_typescript() -> None:
    """The fields both libraries can actually answer."""
    metadata = read_image_metadata(_golden_png())
    expected = _GOLDEN["metadata"]

    assert metadata.format == expected["format"]
    assert metadata.width == expected["width"]
    assert metadata.height == expected["height"]
    assert metadata.pages == expected["pages"]


def test_counts_one_page_for_an_ordinary_image() -> None:
    """More than one only for a multi-page TIFF - what a sheet-fed scanner emits."""
    assert count_pages(_golden_png()) == 1


def test_read_image_metadata_refuses_a_decoded_raster() -> None:
    """It describes a FILE, and a decoded raster no longer has one."""
    with pytest.raises(TypeError, match="not a decoded raster"):
        read_image_metadata(_rebuild_page())


def test_an_empty_buffer_is_rejected_rather_than_decoded() -> None:
    with pytest.raises(ValueError, match="empty image buffer"):
        decode_image(b"")


def test_jpeg_drops_alpha_rather_than_refusing() -> None:
    """JPEG has no alpha channel, and Pillow raises rather than flattening.

    The page is opaque, so the pixels survive; the point is that asking for
    JPEG does not explode.
    """
    page = _rebuild_page()
    decoded = decode_image(encode_image(page, "jpeg", quality=100))

    assert is_raster(decoded)
    assert decoded.pixels.shape == page.pixels.shape
    # Lossy, so only the alpha is asserted exactly.
    assert np.array_equal(decoded.pixels[:, :, 3], page.pixels[:, :, 3])


class TestExifOrientation:
    """The path the golden page cannot reach, because a PNG carries no EXIF.

    Worth its own fixture rather than left to the goldens: ignoring the
    orientation tag is a silent 90-degree error on any photograph taken in
    portrait, and the aligner's skew limit is 12 degrees, so it cannot recover.
    Found as a gap by mutation testing - removing the ``exif_transpose`` call
    left all 45 other tests passing.
    """

    @staticmethod
    def _portrait_jpeg_tagged_rotate_90() -> bytes:
        """A 4x2 JPEG whose EXIF says orientation 6 - rotate 90 degrees clockwise.

        :returns: The encoded bytes.
        """
        from PIL import Image  # noqa: PLC0415 - local, so the fixture stays self-contained

        image = Image.new("RGB", (4, 2), (255, 255, 255))
        # One dark pixel at the top-left, so the rotation is observable.
        image.putpixel((0, 0), (0, 0, 0))
        exif = image.getexif()
        exif[0x0112] = 6
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", exif=exif, quality=100)

        return bytes(buffer.getvalue())

    def test_applies_the_orientation_tag_by_default(self) -> None:
        """Orientation 6 swaps the axes, so 4x2 decodes as 2x4."""
        decoded = decode_image(self._portrait_jpeg_tagged_rotate_90())

        assert (decoded.width, decoded.height) == (2, 4)

    def test_leaves_the_pixels_alone_when_asked_not_to(self) -> None:
        """The escape hatch, for a caller that has already corrected for it."""
        decoded = decode_image(self._portrait_jpeg_tagged_rotate_90(), auto_orient=False)

        assert (decoded.width, decoded.height) == (4, 2)
