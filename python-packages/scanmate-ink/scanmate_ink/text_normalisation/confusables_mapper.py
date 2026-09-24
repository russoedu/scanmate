"""Characters and pairs OCR mistakes for one another, folded to one form each.

Off by default, and deliberately so: ``0`` for ``o`` and ``5`` for ``s`` are
OCR's commonest errors, and the very substitutions someone altering an amount
or a reference would make. Folding them raises a score by hiding exactly what a
check is for. Use it to compare prose, never figures.

Applied after case folding, to lower-case text - which is why the table has no
upper-case entries and would quietly miss them if it ran earlier.

PAIRS BEFORE SINGLES, AND ONLY THAT
------------------------------------

The pairs run first, and that ordering is load-bearing - but not for the
reason the obvious example suggests. ``rn1`` folds to ``ml`` and ``cli`` to
``dl`` under EITHER order, so neither shows anything. The case that does is
``c1``: pairs first leaves ``cl``, while singles first turns the ``1`` into an
``l``, manufactures a ``cl`` that was never in the text, and folds it to ``d``.
Running the singles first therefore invents confusions rather than resolving
them.

The order AMONG the pairs, by contrast, does not matter at all: none of the
three produces a character another one consumes. Checked exhaustively over
every string up to length five in the alphabet they touch - zero differ. Kept
in the TypeScript's order for readability, not for behaviour.
"""

from __future__ import annotations

#: Two-character confusions, applied first and in this order.
_PAIRS: tuple[tuple[str, str], ...] = (
    ("rn", "m"),
    ("cl", "d"),
    ("vv", "w"),
)

#: Single characters, applied afterwards, one pass over the whole string.
_SINGLES: dict[str, str] = {
    "0": "o",
    "1": "l",
    "i": "l",
    "|": "l",
    "!": "l",
    "5": "s",
    "8": "b",
    "6": "b",
    "2": "z",
}


def fold_confusables(text: str) -> str:
    """Fold the characters OCR confuses onto one representative each.

    :param text: Lower-cased text.
    :returns: The folded text.
    """
    folded = text
    for pattern, replacement in _PAIRS:
        folded = folded.replace(pattern, replacement)

    return "".join(_SINGLES.get(character, character) for character in folded)
