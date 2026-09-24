"""The vectorised stream, against the generator it is an optimisation of.

There is no golden here, and there should not be: this is not a second
generator that has to agree with the TypeScript, it is the SAME sequence
computed differently. What it has to agree with is
:func:`~.create_random_algorithm.create_random`, which is already measured
against the TypeScript's own goldens. Checking it against those instead would
prove the same thing one step further from the claim.

The seeds are the ones ``tools/parity`` uses for the PRNG goldens, plus the two
the synthetic document and its noise are built from - so every seed this
package actually draws on is covered, not a sample of plausible ones.
"""

from __future__ import annotations

import numpy as np
import pytest

from .create_random_algorithm import create_random
from .random_stream_algorithm import random_stream

#: Every seed used anywhere in this package, plus both 32-bit boundaries.
_SEEDS = [0, 1, 42, 99, 7, 1234, 2024, 31337, 123_456_789, 20_260_923, 2_147_483_647, 4_294_967_295]


@pytest.mark.parametrize("seed", _SEEDS)
def test_the_stream_is_the_generator(seed: int) -> None:
    """Every value, in order, bit for bit.

    :param seed: The seed to compare under.
    """
    generator = create_random(seed)
    scalar = [generator() for _ in range(2000)]

    assert list(random_stream(seed, 2000)) == scalar


def test_a_stream_spanning_the_state_wrap_still_matches() -> None:
    """The k-th state is ``seed + k * 0x6D2B79F5`` reduced mod 2^32.

    Computing it directly is the whole trick, and the reduction is the part
    that could be got wrong quietly: a seed near the top of the range wraps on
    the very first step, so this starts there and runs long enough to wrap
    several times over.
    """
    generator = create_random(4_294_967_295)
    scalar = [generator() for _ in range(5000)]

    assert list(random_stream(4_294_967_295, 5000)) == scalar


def test_asking_for_nothing_gives_nothing() -> None:
    """Zero and negative counts return an empty array rather than raising.

    ``arange(1, 1)`` is already empty, so the guard is about not handing back
    a shape numpy would object to later - and about a caller looping over a
    scan with no pixels.
    """
    assert random_stream(42, 0).size == 0
    assert random_stream(42, -5).size == 0
    assert random_stream(42, 0).dtype == np.float64


def test_every_value_is_in_the_unit_interval() -> None:
    """``[0, 1)`` - the contract the scalar generator states.

    Cheap, and it is the assertion that would catch a sign error in the
    avalanche: a stream that matched nothing would still match the scalar
    generator if BOTH were wrong the same way, and this does not depend on
    either of them.
    """
    values = random_stream(2024, 20_000)

    assert float(values.min()) >= 0
    assert float(values.max()) < 1
