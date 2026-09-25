"""JavaScript's ``Number(string)``, which is not Python's ``float(string)``.

The field reader calls ``.map(Number)`` on whatever a ``/ByteRange`` contains
and then rejects anything non-finite. Whether a given token survives that is a
question about *JavaScript's* string-to-number conversion, and the two
languages disagree in both directions:

===================  ==================  ==============================
Token                ``Number(token)``   ``float(token)``
===================  ==================  ==============================
``"0x10"``           ``16``              ``ValueError``
``"0b11"``           ``3``               ``ValueError``
``"0o17"``           ``15``              ``ValueError``
``""``               ``0``               ``ValueError``
``"Infinity"``       ``Infinity``        ``ValueError``
``"inf"``            ``NaN``             ``inf``
``"nan"``            ``NaN``             ``nan``
``"1_000"``          ``NaN``             ``1000``
===================  ==================  ==============================

Both halves matter here. A PDF whose ``/ByteRange`` reads ``[0x10 ...]`` is
read by the TypeScript as a real range; one reading ``[1_0 ...]`` is rejected.
A port using ``float`` would disagree on the first by refusing it and on the
last by accepting it, and in both cases the *verdict about a signature* changes.
"""

from __future__ import annotations

import math
import re

#: The literal forms JavaScript accepts, anchored and whitespace-free - the
#: caller has already split on whitespace, and `Number` trims anyway.
_DECIMAL = re.compile(
    r"""^
    [+-]?
    (?:
        Infinity
      | (?: \d+ (?: \. \d* )? | \. \d+ )      # 1, 1., 1.5, .5
        (?: [eE] [+-]? \d+ )?                 # optional exponent
    )
    $""",
    re.VERBOSE,
)

#: The three radix prefixes, each with the digits it admits. The digit patterns
#: are spelled out rather than left to ``int(digits, base)``, because Python's
#: ``int`` is more permissive than JavaScript in two ways that both showed up
#: when this was measured against Node: it accepts ``_`` as a digit separator
#: (``int('1_0', 16)`` is 16, ``Number('0x1_0')`` is NaN) and it accepts a sign
#: (``int('+10', 16)`` is 16, ``Number('0x+10')`` is NaN).
_RADIX = (
    ("0x", 16, re.compile(r"^[0-9a-fA-F]+$")),
    ("0X", 16, re.compile(r"^[0-9a-fA-F]+$")),
    ("0o", 8, re.compile(r"^[0-7]+$")),
    ("0O", 8, re.compile(r"^[0-7]+$")),
    ("0b", 2, re.compile(r"^[01]+$")),
    ("0B", 2, re.compile(r"^[01]+$")),
)


def js_number(token: str) -> float:
    """Convert ``token`` exactly as JavaScript's ``Number`` would.

    :param token: The text to convert. Surrounding whitespace is ignored, as
        ``Number`` ignores it.
    :returns: The number, or ``nan`` where JavaScript yields ``NaN``.
    """
    text = token.strip()

    # `Number('')` and `Number('   ')` are 0, not NaN. The one case where an
    # empty `/ByteRange` entry becomes a real number rather than being rejected.
    if text == "":
        return 0.0

    for prefix, base, digits_only in _RADIX:
        if text.startswith(prefix):
            digits = text[len(prefix) :]

            return float(int(digits, base)) if digits_only.match(digits) else math.nan

    if _DECIMAL.match(text) is None:
        return math.nan

    if text.endswith("Infinity"):
        return -math.inf if text[0] == "-" else math.inf

    return float(text)
