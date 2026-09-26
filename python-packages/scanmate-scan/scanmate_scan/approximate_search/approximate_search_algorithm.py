"""Where a short text occurs inside a long one, allowing for OCR's errors.

Sellers' algorithm: edit distance in which the match may start and end anywhere
in the text - the first row of the table is zero, so skipping text before the
match is free, and the best end is read off the last row. An exact ``in`` would
call a perfectly good scan incomplete for one misread letter; this finds
``"Initial Subscription Term"`` in ``"lnitial Subscription Terrn"`` and says how
far off it was.

Figures are held to more than closeness. A match for something containing digits
must contain **the same digits, in order**, and must not run into more digits on
either side - so ``1,250.00`` is not found inside ``11,250.00``, and ``7,250.00``
is not an approximate ``1,250.00``. A letter standing alone - the "A" of
"Schedule A", the "B" of "Option B" - is an identifier the same way, and must be
there as a word of its own: one letter in ten is 90% similar.
"""

from __future__ import annotations

import math
import unicodedata
from dataclasses import dataclass

from scanmate_ocr import utf16_units

#: JavaScript's ``\s``, which is not Python's - see
#: ``scanmate_ocr.text_similarity`` for the same note. As code units, because
#: everything in this file is indexed in them.
_JS_SPACE = frozenset(
    ord(c)
    for c in "\t\n\v\f\r       　﻿"
    + "".join(chr(c) for c in range(0x2000, 0x200B))
)

_ZERO = ord("0")
_NINE = ord("9")


@dataclass(frozen=True, slots=True)
class ApproximateMatch:
    """One place the needle was found."""

    #: Characters of the text the match covers, ``[start, end)``.
    start: int
    end: int
    #: Edits between the needle and the match.
    distance: int
    #: ``1 - distance / needle length``.
    score: float


@dataclass(frozen=True, slots=True)
class SearchOptions:
    """How close a match has to be."""

    #: Least score a match may have.
    min_score: float = 0.85


@dataclass(frozen=True, slots=True)
class Span:
    """A half-open range of the text."""

    start: int
    end: int


def approximate_search(
    needle: str, text: str, options: SearchOptions | None = None
) -> list[ApproximateMatch]:
    """Every acceptable match, best first; overlapping matches keep only the best.

    :param needle: What to look for.
    :param text: What to look in.
    :param options: How close a match has to be.
    :returns: The matches, best first.

    .. note::
       Offsets are **UTF-16 code units**, as JavaScript's string indices are,
       so a caller slicing the text with them gets the same span in both ports.
       They differ from Python character offsets only outside the Basic
       Multilingual Plane.
    """
    settings = options if options is not None else SearchOptions()
    needle_units = utf16_units(needle)
    m = len(needle_units)
    if m == 0:
        return []
    text_units = utf16_units(text)
    n = len(text_units)

    # `1e-9` before the floor is the TypeScript's, and it matters: at
    # minScore 0.85 and a 20-character needle, (1 - 0.85) * 20 is
    # 3.0000000000000004 in binary floating point, and without the nudge the
    # floor would give 3 anyway - but at other lengths it lands just below an
    # integer and would lose an edit.
    max_edits = math.floor((1 - settings.min_score) * m + 1e-9)

    width = n + 1
    table = [0] * ((m + 1) * width)
    for i in range(1, m + 1):
        table[i * width] = i
    for i in range(1, m + 1):
        row = i * width
        previous = (i - 1) * width
        unit = needle_units[i - 1]
        for j in range(1, n + 1):
            table[row + j] = min(
                table[previous + j - 1] + (0 if unit == text_units[j - 1] else 1),
                table[previous + j] + 1,
                table[row + j - 1] + 1,
            )

    last = m * width
    ends = [j for j in range(1, n + 1) if table[last + j] <= max_edits]
    ends.sort(key=lambda j: (table[last + j], j))

    wanted = _digits_of(needle_units)
    letters = [word for word in _split_words(needle_units) if _is_single_letter(word)]
    found: list[ApproximateMatch] = []
    for end in ends:
        start = _start_of(table, width, m, end, needle_units, text_units)
        if any(start < f.end and end > f.start for f in found):
            continue
        if wanted != "" and not _keeps_figures(text_units, start, end, wanted):
            continue
        if len(letters) > 0 and not _keeps_letters(text_units, start, end, letters):
            continue
        distance = table[last + end]
        found.append(
            ApproximateMatch(start=start, end=end, distance=distance, score=1 - distance / m)
        )

    return found


def best_match(
    needle: str, text: str, options: SearchOptions | None = None
) -> ApproximateMatch | None:
    """The best acceptable match, or ``None``."""
    matches = approximate_search(needle, text, options)

    return matches[0] if len(matches) > 0 else None


def word_span(text: str, start: int, end: int) -> Span:
    """A match widened to whole words.

    The cheapest alignment may stop inside a word - "subscription ter" costs
    less than "subscription terrn" - which is right for scoring and wrong for
    showing someone what was found.

    :param text: The text the offsets are into.
    :param start: Where the match starts, in UTF-16 code units.
    :param end: Where it ends.
    :returns: The widened span.
    """
    units = utf16_units(text)

    return _word_span(units, start, end)


def _word_span(units: list[int], start: int, end: int) -> Span:
    """The same, on code units already in hand."""
    left = start
    right = end
    while left > 0 and units[left - 1] not in _JS_SPACE:
        left -= 1
    while right < len(units) and units[right] not in _JS_SPACE:
        right += 1

    return Span(start=left, end=right)


def _start_of(
    table: list[int], width: int, m: int, end: int, needle: list[int], text: list[int]
) -> int:
    """Walk the table back from the match's end, preferring the diagonal."""
    i = m
    j = end
    while i > 0 and j > 0:
        here = table[i * width + j]
        diagonal = table[(i - 1) * width + j - 1] + (
            0 if needle[i - 1] == text[j - 1] else 1
        )
        if here == diagonal:
            i -= 1
            j -= 1
        elif here == table[(i - 1) * width + j] + 1:
            i -= 1
        else:
            j -= 1

    return j


def _keeps_figures(text: list[int], start: int, end: int, wanted: str) -> bool:
    """The match has exactly the wanted digits, and no digit touches it outside."""
    if _digits_of(text[start:end]) != wanted:
        return False

    return not _is_digit(text, start - 1) and not _is_digit(text, end)


def _keeps_letters(text: list[int], start: int, end: int, letters: list[list[int]]) -> bool:
    """Every lone letter of the needle stands as a word in the match."""
    span = _word_span(text, start, end)
    words = {tuple(word) for word in _split_words(text[span.start : span.end])}

    return all(tuple(letter) in words for letter in letters)


def _split_words(units: list[int]) -> list[list[int]]:
    """Split on runs of JavaScript whitespace, as ``String.split(/\\s+/u)`` does.

    Including the empty pieces a leading or trailing run produces, because the
    TypeScript keeps them too and a set membership test is what they feed.
    """
    words: list[list[int]] = []
    current: list[int] = []
    in_space = False
    for unit in units:
        if unit in _JS_SPACE:
            if not in_space:
                words.append(current)
                current = []
                in_space = True
            continue
        in_space = False
        current.append(unit)
    words.append(current)

    return words


def _is_single_letter(word: list[int]) -> bool:
    """``/^\\p{L}$/u``: exactly one Unicode letter.

    Python's ``re`` has no property escapes, so the category is asked for
    directly - ``\\p{L}`` is General_Category ``L*``.
    """
    return len(word) == 1 and unicodedata.category(chr(word[0])).startswith("L")


def _digits_of(units: list[int]) -> str:
    """The ASCII digits, in order.

    ``\\D`` in JavaScript is "not 0-9"; Python's is "not a Unicode decimal
    digit", which would keep an Arabic-Indic numeral the TypeScript strips.
    """
    return "".join(chr(u) for u in units if _ZERO <= u <= _NINE)


def _is_digit(units: list[int], index: int) -> bool:
    """Whether the unit at ``index`` is an ASCII digit, off either end included."""
    if index < 0 or index >= len(units):
        return False

    return _ZERO <= units[index] <= _NINE
