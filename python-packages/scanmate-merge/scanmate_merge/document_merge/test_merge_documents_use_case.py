"""Merging, held to the TypeScript's DECISIONS.

Not to its bytes, and that boundary is the point of this file. Two PDF writers
lay out objects, streams and the cross-reference table differently, so two valid
merges of the same sources are never the same file. What must agree is every
choice that went into it - how many pages, from which source, embedded how, at
what size and resolution - and those are checked here field by field.

The same boundary ``scanmate-ink`` already draws around ``resampleRaster`` and
``blurRaster``: where two engines cannot agree by construction, say so rather
than write a golden nobody can meet.
"""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

import pytest
from pypdf import PdfReader

from ..page_placement import PageDimensions
from ..source_reading import MergeSourceError
from .merge_documents_use_case import merge_documents
from .merge_result_contract import MergeMetadata, MergeOptions

_ROOT = Path(__file__).parents[4]
_FIXTURES = _ROOT / "tools" / "parity" / "fixtures" / "merge"
_SEAL_PDF = (_ROOT / "tools" / "parity" / "fixtures" / "seal" / "plain.pdf").read_bytes()
_GOLDEN: dict[str, Any] = json.loads(
    (_ROOT / "tools" / "parity" / "goldens" / "merge-decisions.json").read_text(encoding="utf-8")
)["cases"]


def _image(name: str) -> bytes:
    return (_FIXTURES / name).read_bytes()


def _only_image(page: Any) -> Any:
    """The one image XObject a generated page carries."""
    return next(iter(page["/Resources"]["/XObject"].values()))


#: The same cases the golden was generated from, in the same order.
def _cases() -> dict[str, tuple[list[bytes], MergeOptions]]:
    return {
        "one-jpeg": ([_image("photo.jpg")], MergeOptions()),
        "one-grey-jpeg": ([_image("grey.jpg")], MergeOptions()),
        "one-png": ([_image("page.png")], MergeOptions()),
        "images-in-order": (
            [_image("photo.jpg"), _image("page.png"), _image("grey.jpg")],
            MergeOptions(),
        ),
        "a-pdf-alone-passes-through": ([_SEAL_PDF], MergeOptions()),
        "a-pdf-alone-with-metadata-does-not": (
            [_SEAL_PDF],
            MergeOptions(metadata=MergeMetadata(title="A Title")),
        ),
        "a-pdf-alone-with-passthrough-off": ([_SEAL_PDF], MergeOptions(pass_through=False)),
        "pdf-then-image": ([_SEAL_PDF, _image("photo.jpg")], MergeOptions()),
        "image-then-pdf": ([_image("photo.jpg"), _SEAL_PDF], MergeOptions()),
        "on-a4": ([_image("photo.jpg")], MergeOptions(page_size="a4")),
        "on-a4-with-a-margin": ([_image("photo.jpg")], MergeOptions(page_size="a4", margin=36)),
        "on-letter": ([_image("page.png")], MergeOptions(page_size="letter")),
        "at-a-given-dpi": ([_image("photo.jpg")], MergeOptions(image_dpi=300)),
        "re-encoded-as-jpeg": (
            [_image("page.png")],
            MergeOptions(encoding="jpeg", quality=80, page_size="a4"),
        ),
        "cmyk-jpeg-is-not-embedded-directly": ([_image("cmyk.jpg")], MergeOptions()),
        "cmyk-jpeg-re-encoded-as-jpeg": ([_image("cmyk.jpg")], MergeOptions(encoding="jpeg")),
        "exif-rotated-jpeg-is-not-embedded-directly": (
            [_image("rotated.jpg")],
            MergeOptions(),
        ),
        "multi-page-tiff": ([_image("three-pages.tiff")], MergeOptions()),
    }


@pytest.mark.parametrize("name", sorted(_GOLDEN))
def test_every_decision_matches_the_typescript(name: str) -> None:
    sources, options = _cases()[name]
    want = _GOLDEN[name]
    result = merge_documents(sources, options)

    assert result.page_count == want["pageCount"]
    assert result.passed_through == want["passedThrough"]
    assert (result.pdf == sources[0]) == want["identicalToFirstSource"]
    assert len(result.pages) == len(want["pages"])

    for page, expected in zip(result.pages, want["pages"], strict=True):
        assert page.page == expected["page"]
        assert page.source == expected["source"]
        assert page.source_page == expected["sourcePage"]
        assert page.kind == expected["kind"]
        assert page.embedding == expected["embedding"]
        assert page.width == expected["width"]
        assert page.height == expected["height"]
        assert page.dpi == expected["dpi"]


class TestThePdfItActuallyProduces:
    """The bytes are not held to the TypeScript, so what IS true of them?"""

    def test_it_is_a_readable_pdf_with_the_pages_it_reports(self) -> None:
        result = merge_documents(
            [_image("photo.jpg"), _image("page.png"), _SEAL_PDF], MergeOptions()
        )
        document = PdfReader(io.BytesIO(result.pdf))

        assert len(document.pages) == result.page_count == 3

    def test_each_page_is_the_size_the_result_reports(self) -> None:
        # Otherwise the metadata is a claim about a file that does not match it,
        # which is worse than no metadata at all.
        result = merge_documents([_image("photo.jpg"), _SEAL_PDF], MergeOptions())
        document = PdfReader(io.BytesIO(result.pdf))

        for page, reported in zip(document.pages, result.pages, strict=True):
            assert float(page.mediabox.width) == pytest.approx(reported.width)
            assert float(page.mediabox.height) == pytest.approx(reported.height)

    def test_a_jpeg_is_carried_through_uncompressed_a_second_time(self) -> None:
        # The promise that matters for evidence: a scan does not acquire a
        # second generation of artefacts on its way into the file.
        result = merge_documents([_image("photo.jpg")], MergeOptions())
        page = PdfReader(io.BytesIO(result.pdf)).pages[0]
        image = _only_image(page)

        assert "/DCTDecode" in image["/Filter"]

    def test_a_png_is_carried_over_as_pixels_losslessly(self) -> None:
        # A PDF cannot hold a PNG file, so this is the PNG's PIXELS, deflated -
        # which is what the TypeScript's embedPng does too.
        result = merge_documents([_image("page.png")], MergeOptions())
        page = PdfReader(io.BytesIO(result.pdf)).pages[0]
        image = _only_image(page)

        assert "/FlateDecode" in image["/Filter"]

    def test_a_cmyk_jpeg_is_decoded_rather_than_embedded_as_it_is(self) -> None:
        # The case the colour-space check exists for. A PDF cannot take CMYK
        # JPEG bytes as they are, so embedding every JPEG directly would write
        # a file whose colours are wrong - and it would look like it worked.
        result = merge_documents([_image("cmyk.jpg")], MergeOptions())

        assert result.pages[0].embedding == "encoded-png"

    def test_an_exif_rotated_jpeg_is_turned_rather_than_embedded_as_it_is(self) -> None:
        # Embedded as it is, it lands on the page sideways - and nothing about
        # the merge would say so. The page tells you: the source is 120 x 160,
        # and a quarter turn makes the page wider than it is tall.
        page = merge_documents([_image("rotated.jpg")], MergeOptions()).pages[0]

        assert page.embedding == "encoded-png"
        assert page.width > page.height

    def test_every_frame_of_a_multi_page_tiff_becomes_a_page(self) -> None:
        # What a sheet-fed scanner emits. A port that embedded only the first
        # frame would lose two sheets of a document and report one page as if
        # that were the whole of it.
        result = merge_documents([_image("three-pages.tiff")], MergeOptions())

        assert result.page_count == 3
        assert [p.source_page for p in result.pages] == [1, 2, 3]
        assert {p.source for p in result.pages} == {1}

    def test_a_directly_embeddable_format_never_has_more_than_one_page(self) -> None:
        """An invariant, not a gap.

        ``meta.pages == 1 and (as_jpeg or as_png)`` guards the single-embed
        path, and removing the page count from it changes nothing that can be
        reached: the only formats a PDF takes as they are - JPEG and PNG - are
        single-frame by definition, and the multi-frame format that exists,
        TIFF, is never ``as_jpeg`` or ``as_png``.

        Mutation testing surfaced it as a survivor, and the honest resolution
        is to state the invariant rather than invent a fixture that cannot
        exist. If a multi-frame PNG ever became a thing, this fails first.
        """
        from scanmate_ink import read_image_metadata

        for name in ("photo.jpg", "grey.jpg", "page.png", "rotated.jpg", "cmyk.jpg"):
            meta = read_image_metadata(_image(name))
            directly_embeddable = meta.format in ("jpeg", "png")

            assert not directly_embeddable or meta.pages == 1

        # And the converse: the multi-frame fixture is not a format that could
        # have taken the single-embed path anyway.
        assert read_image_metadata(_image("three-pages.tiff")).format not in ("jpeg", "png")

    def test_the_producer_names_this_package(self) -> None:
        result = merge_documents([_image("page.png")], MergeOptions())

        info = PdfReader(io.BytesIO(result.pdf)).metadata
        assert info is not None
        assert str(info["/Producer"]) == "scanmate-merge"

    def test_metadata_given_is_written(self) -> None:
        result = merge_documents(
            [_image("page.png")],
            MergeOptions(metadata=MergeMetadata(title="A Title", author="A Person")),
        )
        info = PdfReader(io.BytesIO(result.pdf)).metadata

        assert info is not None
        assert str(info["/Title"]) == "A Title"
        assert str(info["/Author"]) == "A Person"


class TestPassThrough:
    """The one path that produces no new file."""

    def test_a_single_pdf_comes_back_byte_for_byte(self) -> None:
        # Re-saving a signed PDF breaks its signature, and a single PDF
        # "merged" alone has nothing to merge. So it is not touched at all.
        result = merge_documents([_SEAL_PDF], MergeOptions())

        assert result.passed_through is True
        assert result.pdf == _SEAL_PDF

    def test_asking_for_metadata_turns_it_off(self) -> None:
        # Writing metadata means writing a new file, so it cannot also be the
        # original bytes - and saying so is better than silently ignoring one.
        result = merge_documents(
            [_SEAL_PDF], MergeOptions(metadata=MergeMetadata(title="A Title"))
        )

        assert result.passed_through is False
        assert result.pdf != _SEAL_PDF

    def test_it_does_not_apply_to_more_than_one_source(self) -> None:
        result = merge_documents([_SEAL_PDF, _image("page.png")], MergeOptions())

        assert result.passed_through is False

    def test_it_does_not_apply_to_an_image(self) -> None:
        result = merge_documents([_image("page.png")], MergeOptions())

        assert result.passed_through is False


class TestWhatItRefuses:
    def test_nothing_to_merge(self) -> None:
        with pytest.raises(ValueError, match="nothing to merge"):
            merge_documents([], MergeOptions())

    def test_a_source_that_is_neither_a_pdf_nor_an_image(self) -> None:
        with pytest.raises(MergeSourceError) as raised:
            merge_documents([b"not a document at all"], MergeOptions())

        assert "source 1" in str(raised.value)

    def test_an_empty_source(self) -> None:
        with pytest.raises(MergeSourceError, match="it is empty"):
            merge_documents([b""], MergeOptions())

    def test_the_error_names_which_source_it_was(self) -> None:
        # One-based, as a caller counts them - the whole reason the index is
        # carried through the resolve.
        with pytest.raises(MergeSourceError) as raised:
            merge_documents([_image("page.png"), b""], MergeOptions())

        assert str(raised.value).startswith("source 2:")


class TestProgress:
    def test_it_reports_a_start_and_a_done_for_every_source(self) -> None:
        events: list[dict[str, Any]] = []
        merge_documents(
            [_image("page.png"), _SEAL_PDF],
            MergeOptions(pass_through=False, on_progress=events.append),
        )

        assert [(e["phase"], e["index"]) for e in events] == [
            ("start", 1), ("done", 1), ("start", 2), ("done", 2),
        ]
        assert all(e["stage"] == "merge" for e in events)

    def test_only_a_done_event_carries_a_duration_and_a_detail(self) -> None:
        events: list[dict[str, Any]] = []
        merge_documents([_image("page.png")], MergeOptions(on_progress=events.append))

        start, done = events
        assert "durationMs" not in start
        assert done["durationMs"] >= 0
        assert done["detail"] == {"kind": "image", "pages": 1}

    def test_no_callback_is_fine(self) -> None:
        assert merge_documents([_image("page.png")], MergeOptions()).page_count == 1


def test_an_explicit_page_size_is_honoured() -> None:
    result = merge_documents(
        [_image("page.png")], MergeOptions(page_size=PageDimensions(width=300, height=500))
    )

    assert (result.pages[0].width, result.pages[0].height) == (300, 500)
