"""The field reader, held to the TypeScript's own reading of the same bytes.

The inputs are committed PDFs rather than PDFs made here, because signing needs
an RSA key and key generation cannot be seeded. See
``tools/parity/fixtures/make-seal-fixtures.mts``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from .find_signature_fields_algorithm import find_signature_fields

_ROOT = Path(__file__).parents[4]
_FIXTURES = _ROOT / "tools" / "parity" / "fixtures" / "seal"
_GOLDEN: dict[str, Any] = json.loads(
    (_ROOT / "tools" / "parity" / "goldens" / "seal-signature-fields.json").read_text(
        encoding="utf-8"
    )
)["fixtures"]


def _pdf(name: str) -> bytes:
    return (_FIXTURES / f"{name}.pdf").read_bytes()


@pytest.mark.parametrize("name", sorted(_GOLDEN))
def test_reads_exactly_what_the_typescript_reads(name: str) -> None:
    """Every field of every dictionary, `==` and not "close"."""
    expected = _GOLDEN[name]
    fields = find_signature_fields(_pdf(name))

    assert len(fields) == len(expected)
    for field, want in zip(fields, expected, strict=True):
        assert list(field.byte_range) == want["byteRange"]
        # The signature in full - 2048 bytes of it. A reader off by a byte at
        # either end still produces something that looks entirely plausible,
        # and would fail only later, as an unexplained verification failure.
        assert field.contents.hex() == want["contents"]
        assert field.sub_filter == want["subFilter"]
        assert field.name == want["name"]
        assert field.signed_at == want["signedAt"]
        assert field.reason == want["reason"]
        assert field.location == want["location"]
        assert field.offset == want["offset"]


class TestWhatTheFixturesPin:
    """The properties the golden encodes, said out loud.

    A parametrised `==` against a golden proves agreement but explains nothing;
    these name what each fixture is for, so a failure points at a behaviour
    rather than at a diff.
    """

    def test_a_file_with_no_signature_yields_nothing(self) -> None:
        assert find_signature_fields(_pdf("unsigned")) == []

    def test_a_hex_name_with_a_byte_order_mark_is_utf_16(self) -> None:
        # The other half of `_literal`, and the half a latin-1 reading gets
        # silently wrong - it would return "\xfe\xff\x00A" and look like data.
        assert find_signature_fields(_pdf("utf16-name"))[0].name == "A"

    def test_a_plain_name_is_read_as_written(self) -> None:
        assert find_signature_fields(_pdf("plain"))[0].name == "A Person"

    def test_the_byte_range_leaves_a_hole_for_the_signature_itself(self) -> None:
        # The invariant the whole package rests on: the two ranges never meet,
        # and what lies between them is the /Contents hex no signature can
        # cover.
        before_at, before_length, after_at, _ = find_signature_fields(_pdf("plain"))[0].byte_range

        assert before_at == 0
        assert after_at > before_at + before_length

    def test_the_offset_points_at_the_dictionary_not_the_byte_range(self) -> None:
        pdf = _pdf("plain")
        field = find_signature_fields(pdf)[0]

        assert pdf[field.offset : field.offset + 2] == b"<<"
        assert b"/ByteRange" in pdf[field.offset :]

    def test_a_file_too_broken_for_a_parser_is_still_read(self) -> None:
        # `wrecked` has its cross-reference table destroyed. No PDF library
        # will open it, and "was this file tampered with" is exactly the
        # question such a file raises.
        assert len(find_signature_fields(_pdf("wrecked"))) == 1


class TestMalformedInput:
    """Bytes no fixture can carry, because a signer would never write them."""

    def test_a_byte_range_without_four_numbers_is_ignored(self) -> None:
        assert find_signature_fields(b"<< /ByteRange [0 1 2] /Contents <00> >>") == []

    def test_a_byte_range_that_is_not_numbers_is_ignored(self) -> None:
        assert find_signature_fields(b"<< /ByteRange [a b c d] /Contents <00> >>") == []

    def test_a_non_finite_byte_range_is_ignored(self) -> None:
        assert find_signature_fields(b"<< /ByteRange [0 Infinity 2 3] /Contents <00> >>") == []

    def test_a_hexadecimal_byte_range_is_a_real_range(self) -> None:
        # `.map(Number)` means a /ByteRange written in hex is READ, not
        # rejected - confirmed against the TypeScript, which returns
        # [0, 16, 2, 3] for this. A port reaching for float() would drop the
        # whole dictionary instead, and report a signed file as unsigned.
        fields = find_signature_fields(b"<< /ByteRange [0 0x10 2 3] /Contents <00> >>")

        assert fields[0].byte_range == (0, 16, 2, 3)

    def test_a_dictionary_without_contents_is_ignored(self) -> None:
        assert find_signature_fields(b"<< /ByteRange [0 1 2 3] >>") == []

    def test_an_odd_length_hex_string_is_padded_rather_than_refused(self) -> None:
        # PDF says a trailing nibble is padded with zero. A signature truncated
        # by one character has to be READ so that verifying it is what fails.
        fields = find_signature_fields(b"<< /ByteRange [0 1 2 3] /Contents <abc> >>")

        assert fields[0].contents == bytes([0xAB, 0xC0])

    def test_the_enclosing_dictionary_is_found_past_nested_ones(self) -> None:
        # The bug this replaced: taking the nearest `<<` finds /Prop_Build and
        # misses /SubFilter entirely. Note the `>>>>` run, which is why
        # brackets are consumed whole rather than counted at every position.
        pdf = (
            b"<< /Type /Sig /SubFilter /adbe.pkcs7.detached "
            b"/Prop_Build << /App << /Name /Acrobat >> >>"
            b" /ByteRange [0 1 2 3] /Contents <00> >>"
        )

        assert find_signature_fields(pdf)[0].sub_filter == "adbe.pkcs7.detached"

    def test_a_run_of_closing_brackets_closes_one_dictionary_per_pair(self) -> None:
        """The case the spaced version above does not reach.

        Two dictionaries ending flush - ``>>>>`` - close exactly two. Reading a
        bracket at every position instead counts three, and the depth is then
        permanently wrong for the rest of the scan, so the enclosing dictionary
        is never found and /SubFilter is silently lost. PDFs are full of such
        runs, and a signature dictionary is the one place they matter.
        """
        pdf = (
            b"<< /Type /Sig /SubFilter /adbe.pkcs7.detached "
            b"/Prop_Build << /App << /Name /Acrobat >>>>"
            b" /ByteRange [0 1 2 3] /Contents <00> >>"
        )

        assert find_signature_fields(pdf)[0].sub_filter == "adbe.pkcs7.detached"

    def test_a_run_of_opening_brackets_opens_one_dictionary_per_pair(self) -> None:
        """The same rule forwards, where the dictionary's END is found.

        Miscounting here does not lose the dictionary - it ends it in the wrong
        place, so /Contents may fall outside what is read.
        """
        pdf = (
            b"<< /Type /Sig /ByteRange [0 1 2 3] "
            b"/Prop_Build <<<< /Name /Acrobat >>>>"
            b" /Contents <abcd> >>"
        )

        assert find_signature_fields(pdf)[0].contents == bytes([0xAB, 0xCD])

    def test_an_unbalanced_dictionary_is_ignored_rather_than_read_to_the_end(self) -> None:
        assert find_signature_fields(b"<< /ByteRange [0 1 2 3] /Contents <00>") == []
