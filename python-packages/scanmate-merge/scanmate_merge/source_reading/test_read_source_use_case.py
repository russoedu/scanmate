"""Telling a PDF from an image by its content, never by its name."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from .merge_source_contract import MergeSourceError
from .read_source_use_case import is_pdf, read_source

_ROOT = Path(__file__).parents[4]
_GOLDEN: dict[str, Any] = json.loads(
    (_ROOT / "tools" / "parity" / "goldens" / "merge-source-reading.json").read_text(
        encoding="utf-8"
    )
)

_BYTES: dict[str, bytes] = {
    "plain": b"%PDF-1.7\nbody",
    "empty": b"",
    "junk-then-header": b"junkjunkjunkjunk%PDF-1.4",
    "header-at-window-edge": bytes(1024) + b"%PDF-" + bytes(171),
    "header-past-the-window": bytes(1025) + b"%PDF-" + bytes(170),
    "png": bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    "truncated-header": b"%PDF",
}


@pytest.mark.parametrize("name", sorted(_GOLDEN["isPdf"]))
def test_is_pdf_matches_the_typescript(name: str) -> None:
    assert is_pdf(_BYTES[name]) is _GOLDEN["isPdf"][name]


class TestTheHeaderWindow:
    """A PDF may carry junk before its header; readers look in the first kilobyte."""

    def test_a_header_a_kilobyte_in_is_still_found(self) -> None:
        assert is_pdf(_BYTES["header-at-window-edge"]) is True

    def test_one_byte_further_is_not(self) -> None:
        # The boundary is inclusive of offset 1024, and both ports have to
        # agree on which side of it a file falls.
        assert is_pdf(_BYTES["header-past-the-window"]) is False

    def test_a_header_too_short_to_be_one_is_not_one(self) -> None:
        assert is_pdf(b"%PDF") is False


class TestWhatDecides:
    def test_content_decides_and_not_the_name(self, tmp_path: Path) -> None:
        # A scanner that saves a PDF as `scan.jpg` still gives a PDF.
        lying = tmp_path / "scan.jpg"
        lying.write_bytes(b"%PDF-1.7\nbody")

        assert read_source(str(lying), 0).kind == "pdf"

    def test_bytes_are_taken_as_given(self) -> None:
        assert read_source(b"%PDF-1.7\n", 0).kind == "pdf"
        assert read_source(bytes([0x89, 0x50, 0x4E, 0x47]), 0).kind == "image"

    def test_an_empty_source_is_named(self) -> None:
        with pytest.raises(MergeSourceError, match="source 3: it is empty"):
            read_source(b"", 2)

    def test_a_missing_file_is_named(self, tmp_path: Path) -> None:
        with pytest.raises(MergeSourceError, match="source 1: it could not be read"):
            read_source(str(tmp_path / "nothing-here.pdf"), 0)

    def test_something_that_is_not_a_source_at_all(self) -> None:
        with pytest.raises(MergeSourceError, match="expected a path"):
            read_source(42, 0)

    def test_the_index_in_the_message_is_one_based(self) -> None:
        # A caller counts its own list from one, and the message is for them.
        with pytest.raises(MergeSourceError) as raised:
            read_source(b"", 4)

        assert str(raised.value).startswith("source 5:")
        assert raised.value.index == 4
