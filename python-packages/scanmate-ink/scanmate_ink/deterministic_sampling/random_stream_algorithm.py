"""The same mulberry32 sequence, produced all at once.

:func:`~.create_random_algorithm.create_random` hands out one value per call,
which is the right shape wherever the draws are interleaved with decisions -
laying out a line of text, for instance, where the next draw depends on where
the last word ended. It is the wrong shape for sensor noise, which needs three
draws for every pixel: a twelve-megapixel scan is thirty-six million calls
through a Python closure, and that is not a wait anyone accepts.

WHY THIS CAN EXIST AT ALL
--------------------------

mulberry32 advances its state by a CONSTANT: ``state += 0x6D2B79F5`` every
call, wrapping at 2^32. So the state before the k-th draw is
``seed + k * 0x6D2B79F5`` reduced mod 2^32 - computable directly, without
running the k-1 draws before it. Everything after that is a fixed avalanche
of shifts and multiplies on that one word, which numpy does a million at a
time.

That makes this an optimisation with no licence to differ, rather than a
second generator that happens to look similar. The equality is not assumed:
:mod:`.test_random_stream_algorithm` walks the scalar generator and compares
every value.
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

#: The constant mulberry32 adds to its state each step.
_INCREMENT = 0x6D2B79F5
_TWO_32 = 4294967296.0
_MASK32 = 0xFFFFFFFF


def _imul(left: npt.NDArray[np.uint32], right: npt.NDArray[np.uint32]) -> npt.NDArray[np.uint32]:
    """``Math.imul`` on whole arrays.

    The widening to 64 bits and the explicit mask are for legibility, not
    correctness: numpy's uint32 multiplication already wraps modulo 2^32, which
    IS the low 32 bits, and measured over 200,000 random pairs the two agree
    everywhere and warn nowhere. Written out anyway, because "the low 32 bits
    of the product" is the contract `Math.imul` states, and relying on a
    silent overflow to express it reads like an accident.

    :param left: The left operands.
    :param right: The right operands.
    :returns: The low 32 bits of each product.
    """
    product = left.astype(np.uint64) * right.astype(np.uint64)

    return (product & np.uint64(_MASK32)).astype(np.uint32)


def random_stream(seed: int, count: int) -> npt.NDArray[np.float64]:
    """The first ``count`` values a generator seeded with ``seed`` would return.

    :param seed: The seed, coerced to unsigned 32-bit as ``seed >>> 0`` does.
    :param count: How many values to produce.
    :returns: The values, in the order the scalar generator yields them.
    """
    if count <= 0:
        return np.zeros(0, dtype=np.float64)

    steps = np.arange(1, count + 1, dtype=np.uint64)
    advanced = np.uint64(seed & _MASK32) + steps * np.uint64(_INCREMENT)
    state = (advanced & np.uint64(_MASK32)).astype(np.uint32)

    # The avalanche, in the scalar version's own order. Every shift is
    # LOGICAL - JavaScript's `>>>` - which on an unsigned array is what `>>`
    # already does; the scalar port needs `ushr` only because a Python int is
    # signed and arbitrarily wide.
    t = state
    t = _imul(t ^ (t >> np.uint32(15)), t | np.uint32(1))
    t = t ^ (t + _imul(t ^ (t >> np.uint32(7)), t | np.uint32(61)))

    return (t ^ (t >> np.uint32(14))).astype(np.float64) / _TWO_32
