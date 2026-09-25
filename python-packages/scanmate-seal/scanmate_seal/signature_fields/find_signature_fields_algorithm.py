"""Every signature dictionary in a PDF, read from the file's own bytes."""

from __future__ import annotations

import math
import re

from .js_number_algorithm import js_number
from .signature_field_contract import SignatureField

#: JavaScript's ``\s``, restricted to the code points a latin-1 decode can
#: produce. Spelled out rather than written ``\s``, because neither of Python's
#: two readings of ``\s`` is JavaScript's over this range: the Unicode default
#: also matches ``\x85`` (NEL), which JavaScript does not, and ``re.ASCII``
#: drops ``\xa0`` (no-break space), which JavaScript does match. Either way a
#: dictionary would be split differently from the TypeScript's reading of the
#: same bytes.
_SPACE = r"[\t\n\v\f\r \xa0]"

_BYTE_RANGE = re.compile(rf"/ByteRange{_SPACE}*\[([^\]]*)\]")
_CONTENTS = re.compile(rf"/Contents{_SPACE}*<([0-9a-fA-F{_SPACE[1:-1]}]*)>")
_SPACE_RUN = re.compile(rf"{_SPACE}+")


def find_signature_fields(pdf: bytes) -> list[SignatureField]:
    """Read every signature dictionary a PDF carries.

    A signature is the one part of a PDF that cannot be hidden from a reader
    like this, and that is by construction rather than by luck: ``/Contents``
    holds the signature over the file's bytes, so it cannot be compressed into
    an object stream or encrypted without the offsets in ``/ByteRange`` ceasing
    to mean anything. Every signed PDF therefore carries its signature
    dictionaries in plain sight, which is why this needs no PDF parser and no
    PDF library - and why it still works on a file a parser would refuse, which
    matters when the question is whether the file was tampered with.

    :param pdf: The whole file, as bytes.
    :returns: One entry per signature dictionary, in the order the file holds
        them.
    """
    # latin-1 because it is the one encoding that maps every byte to exactly
    # one character, so a string index IS a byte offset - which is what makes
    # the `offset` and `/ByteRange` numbers below mean anything.
    text = pdf.decode("latin-1")
    fields: list[SignatureField] = []

    for match in _BYTE_RANGE.finditer(text):
        stripped = match.group(1).strip()
        tokens = _SPACE_RUN.split(stripped) if stripped != "" else [""]
        numbers = [js_number(token) for token in tokens]
        if len(numbers) != 4 or any(not math.isfinite(n) for n in numbers):
            continue

        # The dictionary /ByteRange belongs to, found by balancing brackets
        # rather than by taking the nearest `<<`. A real signature dictionary
        # holds nested dictionaries - /Prop_Build names the signing software,
        # and inside it /App names the application - so the nearest `<<` is
        # usually one of those, and everything the enclosing dictionary says,
        # /SubFilter included, would be missed.
        start = _enclosing_dictionary(text, match.start())
        if start is None:
            continue
        end = _closing_bracket(text, start)
        if end is None:
            continue
        dictionary = text[start:end]
        contents = _CONTENTS.search(dictionary)
        if contents is None:
            continue

        fields.append(
            SignatureField(
                # `Number` yields floats; the TypeScript carries them as JS
                # numbers throughout, and every one that reaches here is finite.
                byte_range=(
                    _as_index(numbers[0]),
                    _as_index(numbers[1]),
                    _as_index(numbers[2]),
                    _as_index(numbers[3]),
                ),
                contents=_hex(contents.group(1)),
                sub_filter=_name(dictionary, "SubFilter"),
                name=_literal(dictionary, "Name"),
                signed_at=_literal(dictionary, "M"),
                reason=_literal(dictionary, "Reason"),
                location=_literal(dictionary, "Location"),
                offset=start,
            )
        )

    return fields


def _as_index(value: float) -> int:
    """A finite JavaScript number as the integer the byte ranges are used as.

    JavaScript never distinguishes the two, so ``/ByteRange [0 1234.0 ...]``
    slices exactly as ``1234`` does there. Truncating toward zero is what
    indexing a typed array does with a fractional value, so a range written
    with a decimal point covers the same bytes in both ports.
    """
    return int(value)


def _enclosing_dictionary(text: str, at: int) -> int | None:
    """Where the dictionary containing ``at`` begins: backwards, counting brackets."""
    depth = 0
    i = at - 2
    while i >= 0:
        pair = text[i : i + 2]
        # Each bracket is consumed whole: a run of `>>>>` closes two
        # dictionaries, and counting it as three - which reading every position
        # does - leaves the depth permanently wrong. PDFs are full of such runs.
        if pair == ">>":
            depth += 1
            i -= 1
        elif pair == "<<":
            if depth == 0:
                return i
            depth -= 1
            i -= 1
        i -= 1

    return None


def _closing_bracket(text: str, start: int) -> int | None:
    """Where that dictionary ends: forwards from its ``<<``, counting brackets."""
    depth = 0
    i = start
    limit = len(text) - 1
    while i < limit:
        pair = text[i : i + 2]
        if pair == "<<":
            depth += 1
            i += 1
        elif pair == ">>":
            depth -= 1
            if depth == 0:
                return i
            i += 1
        i += 1

    return None


def _name(dictionary: str, key: str) -> str | None:
    """``/Key /Value`` - a name, as ``/SubFilter`` is."""
    found = re.search(rf"/{key}{_SPACE}*/([^{_SPACE[1:-1]}/<>\]]+)", dictionary)

    return found.group(1) if found is not None else None


def _literal(dictionary: str, key: str) -> str | None:
    """``/Key (value)`` or ``/Key <hex>`` - a string, as ``/Name`` and ``/M`` are."""
    plain = re.search(rf"/{key}{_SPACE}*\(((?:\\.|[^\\)])*)\)", dictionary, re.DOTALL)
    if plain is not None:
        return re.sub(r"\\([()\\])", r"\1", plain.group(1))
    encoded = re.search(rf"/{key}{_SPACE}*<([0-9a-fA-F{_SPACE[1:-1]}]*)>", dictionary)
    if encoded is None:
        return None
    raw = _hex(encoded.group(1))

    # A hex string is UTF-16BE when it starts with a byte-order mark, else PDFDoc.
    if len(raw) >= 2 and raw[0] == 0xFE and raw[1] == 0xFF:
        # `errors="replace"` because a TextDecoder is non-fatal: an odd trailing
        # byte or a lone surrogate becomes U+FFFD there rather than throwing,
        # and a port that raised would refuse a file the TypeScript reads.
        return raw[2:].decode("utf-16-be", errors="replace")

    return raw.decode("latin-1")


def _hex(source: str) -> bytes:
    """A PDF hex string, which may carry whitespace and may be odd in length."""
    digits = _SPACE_RUN.sub("", source)
    # An odd count is not an error: PDF says a trailing nibble is padded with
    # zero, and a signature truncated by one character must still be read so
    # that verifying it can be what fails.
    even = digits if len(digits) % 2 == 0 else digits + "0"

    return bytes(int(even[i : i + 2], 16) for i in range(0, len(even), 2))
