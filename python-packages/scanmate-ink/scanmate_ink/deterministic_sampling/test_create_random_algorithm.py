"""The port is measured against the TypeScript, not against itself.

Every assertion here compares with ``tools/parity/goldens/prng.json``, which is
written by running the real ``@scanmate/ink`` build. A test that only asserted
"the numbers are in [0, 1) and look random" would pass on a port that is subtly
wrong in the low bits - and that port would then diverge from the TypeScript on
every downstream result, silently, because RANSAC and the BRIEF pattern both
consume this generator.
"""

import json
from pathlib import Path

import pytest

from ..js_semantics import imul, to_int32, to_uint32, ushr
from .create_random_algorithm import create_random, gaussian

_Goldens = dict[str, dict[str, list[float]]]

_GOLDENS: _Goldens = json.loads(
    (Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "prng.json").read_text(
        encoding="utf-8",
    ),
)


def _seeds(group: str) -> list[str]:
    """The seeds of one golden group, in numeric order.

    Sorted numerically rather than as strings so the parametrised ids read in
    the order the goldens were written, and typed so `key=int` is checkable.

    :param group: The golden group name.
    :returns: The seeds, as the strings JSON gave them.
    """
    return sorted(_GOLDENS[group], key=lambda seed: int(seed))


@pytest.mark.parametrize("seed", _seeds("createRandom"))
def test_create_random_matches_the_typescript_bit_for_bit(seed: str) -> None:
    """Exact equality, never ``pytest.approx``.

    The value is fed back into nothing, but it *is* consumed by callers that
    branch on it, so a last-bit difference is a different sample and a
    different matrix. Approximate equality here would hide exactly the class of
    bug this file exists to catch.
    """
    expected = _GOLDENS["createRandom"][seed]
    random = create_random(int(seed))

    assert [random() for _ in expected] == expected


@pytest.mark.parametrize("seed", _seeds("gaussian"))
def test_gaussian_matches_and_consumes_the_generator_in_the_same_order(seed: str) -> None:
    """Box-Muller draws two uniforms per value, so this pins the ORDER too.

    A port that swapped ``u`` and ``v`` would still produce a perfectly good
    Gaussian and disagree with the TypeScript on every single value.
    """
    expected = _GOLDENS["gaussian"][seed]
    random = create_random(int(seed))

    assert [gaussian(random) for _ in expected] == expected


def test_the_seed_is_coerced_to_unsigned_32_bit() -> None:
    """``seed >>> 0`` means a negative seed and its unsigned twin are the same stream."""
    negative = create_random(-1)
    unsigned = create_random(0xFFFF_FFFF)

    assert [negative() for _ in range(4)] == [unsigned() for _ in range(4)]


def test_values_stay_in_the_unit_interval() -> None:
    """The weak property, kept because it is the one a caller actually relies on."""
    random = create_random(7)
    drawn = [random() for _ in range(500)]

    assert all(0.0 <= value < 1.0 for value in drawn)
    # And it is not a constant, which the equality tests above would not notice
    # if the goldens were ever regenerated from a broken build.
    assert len(set(drawn)) > 400


class TestJsNumericSemantics:
    """The coercions the port would be wrong without.

    Each of these is a place Python and JavaScript genuinely disagree, so they
    are asserted directly rather than only through the generator - when the
    generator's output drifts, these say which coercion moved.
    """

    def test_to_uint32_wraps_rather_than_growing(self) -> None:
        assert to_uint32(-1) == 0xFFFF_FFFF
        assert to_uint32(0x1_0000_0000) == 0
        assert to_uint32(0x1_2345_6789) == 0x2345_6789

    def test_to_int32_sign_extends_from_the_high_bit(self) -> None:
        assert to_int32(0x8000_0000) == -2_147_483_648
        assert to_int32(0xFFFF_FFFF) == -1
        assert to_int32(0x7FFF_FFFF) == 2_147_483_647

    def test_imul_wraps_like_math_imul(self) -> None:
        # The case that separates it from Python's `*`: the true product is far
        # wider than 32 bits, and JavaScript keeps only the low half.
        assert imul(0xFFFF_FFFF, 5) == -5
        assert imul(2, 4) == 8
        assert imul(-5, 12) == -60

    def test_ushr_is_logical_where_pythons_shift_is_arithmetic(self) -> None:
        # Python's `-1 >> 1` is -1 forever; JavaScript's `-1 >>> 1` is 2**31 - 1.
        assert ushr(-1, 1) == 0x7FFF_FFFF
        assert ushr(-1, 0) == 0xFFFF_FFFF
        assert ushr(1024, 4) == 64
