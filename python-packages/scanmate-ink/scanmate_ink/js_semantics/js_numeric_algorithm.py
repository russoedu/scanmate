"""JavaScript's numeric semantics, in Python.

This module exists because the port has to be bit-exact, not merely
statistically similar. Python integers are arbitrary precision and its ``>>``
is an arithmetic shift on a signed value; JavaScript's bitwise operators
coerce to a 32-bit signed integer first, ``>>>`` is a logical shift on a 32-bit
unsigned value, and ``Math.imul`` multiplies as 32-bit signed with wraparound.

Written out rather than inlined at the call sites because getting one of these
subtly wrong produces a generator that still looks random - the sequence is
plausible, passes any smell test, and simply disagrees with the TypeScript. The
only way to catch that is to compare against goldens produced by the real
build, which is what ``tools/parity`` does.

This lives in its own subfeature rather than inside ``deterministic_sampling``
because a second slice needs it: ``ink_separation`` rounds a blur radius and a
histogram bin, and JavaScript's rounding is not Python's. JS numeric semantics
is its own concept, owned by neither caller.
"""

import math

_MASK32 = 0xFFFF_FFFF
_SIGN_BIT = 0x8000_0000


def to_uint32(value: int) -> int:
    """Coerce to an unsigned 32-bit integer, the way JavaScript's ``>>> 0`` does.

    :param value: Any integer, possibly negative or wider than 32 bits.
    :returns: The value in ``[0, 2**32)``.
    """
    return value & _MASK32


def to_int32(value: int) -> int:
    """Coerce to a signed 32-bit integer, the way JavaScript's ``|``, ``^`` and ``&`` do.

    JavaScript applies this ToInt32 coercion to *both* operands of every
    bitwise operator, so a Python port that skips it diverges as soon as the
    high bit is set.

    :param value: Any integer.
    :returns: The value in ``[-2**31, 2**31)``.
    """
    masked = value & _MASK32

    return masked - 0x1_0000_0000 if masked & _SIGN_BIT else masked


def imul(left: int, right: int) -> int:
    """Multiply as 32-bit signed integers with wraparound, like ``Math.imul``.

    :param left: The left operand.
    :param right: The right operand.
    :returns: The low 32 bits of the product, as a signed 32-bit integer.
    """
    return to_int32(to_int32(left) * to_int32(right))


def ushr(value: int, bits: int) -> int:
    """Logical right shift on the unsigned 32-bit value, like ``>>>``.

    Python's ``>>`` is arithmetic and sign-extends, so shifting a negative
    value there keeps the sign bits that JavaScript would have shifted out.

    :param value: Any integer, coerced to unsigned 32-bit first.
    :param bits: How far to shift.
    :returns: The shifted value, in ``[0, 2**32)``.
    """
    return to_uint32(value) >> bits


def js_round(value: float) -> int:
    """Round half AWAY FROM ZERO-ish, the way JavaScript's ``Math.round`` does.

    Python's built-in ``round`` is banker's rounding - it rounds half to even -
    and JavaScript rounds half towards positive infinity. They disagree on
    every half-way case::

        value    JS   Python
        0.5       1        0
        2.5       3        2
       -0.5      -0        0
       -1.5      -1       -2

    That is not a curiosity here. ``otsu_threshold`` rounds a float32 value
    onto a 256-bin histogram, so a value landing exactly on a bin boundary
    picks a different bin in each language - and the threshold that comes out
    then splits the page differently.

    :param value: The value to round.
    :returns: The rounded value, matching ``Math.round``.
    """
    return int(math.floor(value + 0.5))
