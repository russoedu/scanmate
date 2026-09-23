"""A seeded PRNG, so that two runs on the same bytes give the same matrix.

A faithful port of ``packages/ink/src/deterministic-sampling/create-random.algorithm.ts``.
RANSAC samples at random and the BRIEF pattern is drawn at random; with an
unseeded generator the library would return a slightly different answer every
time, which makes a regression test a coin toss and a production bug impossible
to reproduce from the inputs alone. mulberry32 is 32 bits of state and passes
the statistical tests that matter at this scale.

Every arithmetic step goes through :mod:`js_numeric_algorithm` rather than
Python's own operators, because the two languages disagree about integer width
and shift semantics - see that module for why the difference is invisible until
it is compared against goldens from the real TypeScript build.
"""

import math
from collections.abc import Callable

from .js_numeric_algorithm import imul, to_int32, to_uint32, ushr

_INCREMENT = 0x6D2B_79F5
_TWO_32 = 4_294_967_296


def create_random(seed: int) -> Callable[[], float]:
    """Build a mulberry32 generator.

    :param seed: The seed, coerced to unsigned 32-bit exactly as ``seed >>> 0`` does.
    :returns: A callable returning successive floats in ``[0, 1)``.
    """
    state = to_uint32(seed)

    def next_value() -> float:
        nonlocal state
        state = to_uint32(state + _INCREMENT)
        t = to_int32(state)
        t = imul(t ^ ushr(t, 15), to_int32(t | 1))
        t = to_int32(t ^ to_int32(t + imul(t ^ ushr(t, 7), to_int32(t | 61))))

        return ushr(t ^ ushr(t, 14), 0) / _TWO_32

    return next_value


def gaussian(random: Callable[[], float]) -> float:
    """Box-Muller, used to draw the BRIEF sampling pattern from a Gaussian around the patch centre.

    Draws TWO values from ``random`` per result, in that order. The order is
    part of the contract: swapping them still yields a Gaussian, and still
    disagrees with the TypeScript on every value.

    :param random: A generator as returned by :func:`create_random`.
    :returns: One standard normal sample.
    """
    # `sys.float_info.epsilon` is Number.EPSILON: the floor stops log(0).
    u = max(random(), _EPSILON)
    v = random()

    return math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * v)


_EPSILON = 2.220446049250313e-16
