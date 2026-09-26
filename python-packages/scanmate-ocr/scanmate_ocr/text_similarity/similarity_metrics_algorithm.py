"""Ways to say how alike two texts are.

They fail differently, which is why several are reported rather than one:

- **edit distance** counts every insertion, deletion and substitution, so it
  notices a changed digit - and punishes text that reflowed;
- **set and bag measures** (Jaccard, Dice, cosine, recall) ignore order, so they
  survive reflow and a reading order OCR got wrong - and miss a swapped clause;
- **character and word error rates** are what anyone who works with OCR expects
  to see;
- **Jaro-Winkler** is for short strings - names, references - and meaningless on
  a page.

All take text already normalised; similarities run from 0 to 1.

.. note::
   Every length and every character here is a **UTF-16 code unit**, not a Python
   character, because that is what JavaScript counts. They differ only outside
   the Basic Multilingual Plane - an emoji is one Python character and two
   JavaScript ones - and where they differ every measure below moves: the
   length, the bigrams, the match window, the error rates. Normalised OCR text
   rarely holds such a character, which is exactly why a port that ignored this
   would agree on every ordinary page and disagree on the one that mattered.
"""

from __future__ import annotations

import math
from collections.abc import Sequence


def utf16_units(text: str) -> list[int]:
    """A string as JavaScript sees it: a list of UTF-16 code units.

    :param text: The string.
    :returns: One integer per code unit, so an astral character is two.
    """
    units: list[int] = []
    for character in text:
        code = ord(character)
        if code > 0xFFFF:
            offset = code - 0x10000
            units.append(0xD800 + (offset >> 10))
            units.append(0xDC00 + (offset & 0x3FF))
        else:
            units.append(code)

    return units


def utf16_length(text: str) -> int:
    """``String.prototype.length``: the number of UTF-16 code units."""
    return len(utf16_units(text))


def _edit_distance(a: Sequence[object], b: Sequence[object]) -> int:
    """Levenshtein distance over any two sequences.

    The TypeScript reaches for `fastest-levenshtein`, which is Myers'
    bit-parallel algorithm - a faster route to the same number, so an ordinary
    row-by-row table agrees with it exactly.
    """
    if len(a) == 0:
        return len(b)
    if len(b) == 0:
        return len(a)

    previous = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        current = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            current[j] = min(
                current[j - 1] + 1,
                previous[j] + 1,
                previous[j - 1] + (0 if a[i - 1] == b[j - 1] else 1),
            )
        previous = current

    return previous[len(b)]


def levenshtein(a: str, b: str) -> int:
    """Characters inserted, deleted or substituted to turn one text into the other.

    :param a: The first text.
    :param b: The second.
    :returns: The edit distance, in UTF-16 code units.
    """
    return _edit_distance(utf16_units(a), utf16_units(b))


def levenshtein_similarity(a: str, b: str) -> float:
    """``1 - distance / longer length``: 1 for identical, 0 for nothing in common."""
    longest = max(utf16_length(a), utf16_length(b))

    return 1.0 if longest == 0 else 1 - levenshtein(a, b) / longest


def word_distance(a: Sequence[str], b: Sequence[str]) -> int:
    """Words inserted, deleted or substituted: edit distance over words.

    :param a: The first word list.
    :param b: The second.
    :returns: The word-level edit distance.
    """
    # The TypeScript maps each distinct word to a private-use character so its
    # fast CHARACTER routine can do the work, and falls back to a table when it
    # runs out of the 6400 available. Both branches compute the same word-level
    # distance, so this computes it directly - there is nothing to reproduce in
    # the encoding, only in the answer.
    return _edit_distance(list(a), list(b))


def jaccard(a: Sequence[str], b: Sequence[str]) -> float:
    """Shared distinct words over all distinct words."""
    left = set(a)
    right = set(b)
    if len(left) == 0 and len(right) == 0:
        return 1.0

    shared = len(left & right)

    return shared / (len(left) + len(right) - shared)


def dice(a: str, b: str) -> float:
    """Sørensen-Dice over character bigrams, counted with multiplicity."""
    if a == b:
        return 1.0
    left = utf16_units(a)
    right = utf16_units(b)
    if len(left) < 2 or len(right) < 2:
        return 0.0

    bigrams: dict[tuple[int, int], int] = {}
    for i in range(len(left) - 1):
        pair = (left[i], left[i + 1])
        bigrams[pair] = bigrams.get(pair, 0) + 1

    shared = 0
    for i in range(len(right) - 1):
        pair = (right[i], right[i + 1])
        count = bigrams.get(pair, 0)
        if count > 0:
            shared += 1
            bigrams[pair] = count - 1

    return (2 * shared) / (len(left) - 1 + len(right) - 1)


def cosine(a: Sequence[str], b: Sequence[str]) -> float:
    """Cosine of the two word-frequency vectors."""
    left = _frequencies(a)
    right = _frequencies(b)
    if len(left) == 0 and len(right) == 0:
        return 1.0

    dot = sum(count * right.get(word, 0) for word, count in left.items())
    denominator = _magnitude(left) * _magnitude(right)

    return 0.0 if denominator == 0 else dot / denominator


def word_recall(expected: Sequence[str], actual: Sequence[str]) -> float:
    """Share of the expected words found, each found word used once.

    The question "is what should be there, there?".
    """
    if len(expected) == 0:
        return 1.0

    available = _frequencies(actual)
    found = 0
    for word in expected:
        count = available.get(word, 0)
        if count > 0:
            found += 1
            available[word] = count - 1

    return found / len(expected)


def jaro_winkler(a: str, b: str, prefix_scale: float = 0.1) -> float:
    """Characters matched within a window, transpositions counted, a prefix bonus.

    Tuned for short strings - names, references - and meaningless on a page.

    :param a: The first string.
    :param b: The second.
    :param prefix_scale: Weight of the shared-prefix bonus, up to four characters.
    :returns: The similarity, 0 to 1.
    """
    if a == b:
        return 1.0
    left = utf16_units(a)
    right = utf16_units(b)
    if len(left) == 0 or len(right) == 0:
        return 0.0

    window = max(0, max(len(left), len(right)) // 2 - 1)
    a_matched = [False] * len(left)
    b_matched = [False] * len(right)
    matches = 0
    for i, character in enumerate(left):
        j = _partner(
            right,
            b_matched,
            character,
            max(0, i - window),
            min(len(right) - 1, i + window),
        )
        if j == -1:
            continue
        a_matched[i] = True
        b_matched[j] = True
        matches += 1
    if matches == 0:
        return 0.0

    # Matched characters of each, in order; every position where they disagree
    # is half a transposition.
    left_matched = [c for i, c in enumerate(left) if a_matched[i]]
    right_matched = [c for j, c in enumerate(right) if b_matched[j]]
    transpositions = sum(1 for k, c in enumerate(left_matched) if c != right_matched[k])

    jaro = (
        matches / len(left)
        + matches / len(right)
        + (matches - transpositions / 2) / matches
    ) / 3
    prefix = 0
    while prefix < min(4, len(left), len(right)) and left[prefix] == right[prefix]:
        prefix += 1

    return jaro + prefix * prefix_scale * (1 - jaro)


def _partner(
    text: Sequence[int], matched: list[bool], character: int, start: int, end: int
) -> int:
    """The first unmatched ``character`` in ``text[start..end]``, or ``-1``."""
    for j in range(start, end + 1):
        if not matched[j] and text[j] == character:
            return j

    return -1


def _magnitude(counts: dict[str, int]) -> float:
    """The Euclidean length of a frequency vector."""
    return math.sqrt(sum(count * count for count in counts.values()))


def _frequencies(words: Sequence[str]) -> dict[str, int]:
    """How often each word appears."""
    counts: dict[str, int] = {}
    for word in words:
        counts[word] = counts.get(word, 0) + 1

    return counts
