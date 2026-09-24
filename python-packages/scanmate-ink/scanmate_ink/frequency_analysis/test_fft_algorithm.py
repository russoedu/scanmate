"""The FFT, measured against the TypeScript - the one slice with a real tolerance.

TWO BARS, AND WHICH SIZE GETS WHICH IS THE EVIDENCE
---------------------------------------------------

Transforms of 1, 2 and 4 points are asserted with ``==``, and they pass. They
never run a ``len = 8`` stage, so they never touch ``sin(+/- pi / 4)`` - the one
twiddle base where V8 and Python CAN disagree.

Whether they actually do is a property of the C library this Python was built
against rather than of either implementation. On Windows, CPython returns the
correctly rounded 0.7071067811865476 and V8 returns 0.7071067811865475; on
Linux, CPython returns V8's value and the two agree exactly. Both are within
one unit in the last place of the true value, and the bar below holds either
way.

Transforms of 8 points and up are asserted to an absolute 1e-12. The worst
deviation actually measured across every golden here is 6.22e-15, so the bar
carries about 160x headroom. That is deliberate: ``math.sin`` calls the
platform's libm, this measurement was taken on one platform, and a bar tuned to
the exact number seen here would be a test that passes on a developer's machine
and fails on CI for a reason that is not a bug.

The split is what makes the tolerance evidence rather than a shrug. A port that
was wrong in some ordinary way would miss the small sizes too.

WHAT THE TOLERANCE STILL CANNOT SEE, STATED
--------------------------------------------

One thing genuinely hides behind it, and it is worth naming rather than
discovering later. Recovering the butterfly's even term from the value just
written - ``re[j] = re[i] - odd - odd`` instead of ``even - odd`` - is a real
reassociation, and it deviates from the goldens by 2.66e-15, which is LESS than
the 6.22e-15 the faithful transcription deviates by. No tolerance can reject
something closer to the answer than the correct code is. Mutation testing found
it; it is recorded here instead of being papered over with a tighter bar that
would only fail on someone else's libm.

WHY NOT ULPS
------------

``plane_geometry`` states its bar in units in the last place, and that is the
right unit there because every value it compares is O(1). Here the round trip
returns components near zero, where one ULP is 1e-19 and a perfectly good
answer reads as 14336 ULP out. The bar is absolute for that reason.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from .fft_algorithm import fft1d, fft2d, is_power_of_two, next_power_of_two

_GOLDEN = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "frequency-analysis.json"
    ).read_text(encoding="utf-8"),
)

#: Sizes whose butterflies never reach the disagreeing twiddle.
_EXACT_SIZES = {1, 2, 4}
#: See the module docstring: 160x the worst deviation measured.
_TOLERANCE = 1e-12
#: The one twiddle base V8 gets wrong, as the correctly rounded double.
_SIN_QUARTER_PI = 0.7071067811865476
#: The transform lengths the goldens hold, smallest first.
_SIZES = sorted(_GOLDEN["fft1d"], key=lambda key: int(key))


@pytest.mark.parametrize(("n", "expected"), [(n, e) for n, e in _GOLDEN["nextPowerOfTwo"]])
def test_next_power_of_two(n: int, expected: int) -> None:
    """Including 0 and negatives, which return 1 rather than anything clever.

    :param n: The input.
    :param expected: What the TypeScript returned.
    """
    assert next_power_of_two(n) == expected


@pytest.mark.parametrize(("n", "expected"), [(n, e) for n, e in _GOLDEN["isPowerOfTwo"]])
def test_is_power_of_two(n: int, expected: bool) -> None:
    """``n & (n - 1)`` says yes for 0 and for negatives in two's complement, so
    the positivity test in front of it is load-bearing rather than defensive.

    :param n: The input.
    :param expected: What the TypeScript returned.
    """
    assert is_power_of_two(n) is expected


def test_no_twiddle_base_disagrees_with_v8_by_more_than_one_bit() -> None:
    """The whole tolerance, bounded at its single possible cause.

    Every twiddle base for every size up to 4096 is 24 values, and this checks
    all of them. The cosines agree everywhere, on every platform tried. The
    sines agree everywhere too, EXCEPT possibly at a quarter pi - and whether
    they do there is a property of the C library this Python was built against,
    not of either implementation:

        Windows (MSVC)   sin(pi/4) = 0.7071067811865476   <- correctly rounded
        Linux (glibc)    sin(pi/4) = 0.7071067811865475   <- agrees with V8
        V8               sin(pi/4) = 0.7071067811865475

    So this asserts the bound rather than the outcome: nothing outside that one
    angle may differ, and the difference there may not exceed one unit in the
    last place. An earlier version asserted the disagreement was PRESENT, which
    passed on Windows and failed on CI - a test that had hard-coded the
    developer's libm.

    That bound is what the 1e-12 tolerance below rests on. It holds either way,
    which is why the tolerance does not change between platforms.
    """
    disagreeing = []
    for length, sign, angle, cosine, sine in _GOLDEN["twiddleAngles"]:
        assert (sign * 2 * math.pi) / length == angle
        assert math.cos(angle) == cosine, f"cos disagreed at len {length}"
        if math.sin(angle) != sine:
            disagreeing.append((length, sign, math.sin(angle), sine))

    assert {(length, sign) for length, sign, _, _ in disagreeing} <= {(8, -1), (8, 1)}

    for length, sign, ours, theirs in disagreeing:
        # One ULP at this magnitude, and no more. Anything larger would not be
        # a rounding difference and the tolerance below would be a guess.
        assert abs(ours - theirs) == pytest.approx(1.1102230246251565e-16)
        assert ours == sign * _SIN_QUARTER_PI, f"len {length}: not the quarter-pi value"


def test_the_correctly_rounded_quarter_pi_sine_is_the_one_python_may_return() -> None:
    """Whichever way this platform went, the value is one of exactly two.

    Pinned separately because it is the fact that makes the bound above safe:
    there is no third answer for a library to return here, so "at most one ULP
    at one angle" is the complete statement of how far the two runtimes can be
    apart in this slice.
    """
    quarter_pi = (2 * math.pi) / 8

    assert math.sin(quarter_pi) in {_SIN_QUARTER_PI, 0.7071067811865475}
    assert _SIN_QUARTER_PI == math.sqrt(2) / 2


@pytest.mark.parametrize("size", _SIZES)
def test_fft1d_forward(size: str) -> None:
    """Exact below eight points, within the measured bound at eight and above.

    :param size: The transform length, as the golden keys it.
    """
    case = _GOLDEN["fft1d"][size]
    re = np.asarray(case["input"]["re"], dtype=np.float64)
    im = np.asarray(case["input"]["im"], dtype=np.float64)
    fft1d(re, im)

    if int(size) in _EXACT_SIZES:
        assert re.tolist() == case["forward"]["re"]
        assert im.tolist() == case["forward"]["im"]

        return

    assert np.abs(re - np.asarray(case["forward"]["re"])).max() <= _TOLERANCE
    assert np.abs(im - np.asarray(case["forward"]["im"])).max() <= _TOLERANCE


@pytest.mark.parametrize("size", _SIZES)
def test_fft1d_round_trip(size: str) -> None:
    """The inverse of the forward, matching what the TypeScript's own round trip gave.

    Compared against the golden rather than against the input, so this measures
    parity rather than only that the inverse undoes the forward. Those are
    different claims, and only the first one is this file's job.

    :param size: The transform length, as the golden keys it.
    """
    case = _GOLDEN["fft1d"][size]
    re = np.asarray(case["input"]["re"], dtype=np.float64)
    im = np.asarray(case["input"]["im"], dtype=np.float64)
    fft1d(re, im)
    fft1d(re, im, inverse=True)

    if int(size) in _EXACT_SIZES:
        assert re.tolist() == case["roundTrip"]["re"]
        assert im.tolist() == case["roundTrip"]["im"]

        return

    assert np.abs(re - np.asarray(case["roundTrip"]["re"])).max() <= _TOLERANCE
    assert np.abs(im - np.asarray(case["roundTrip"]["im"])).max() <= _TOLERANCE


def test_the_inverse_recovers_the_input() -> None:
    """Separate from parity: that the transform is a transform at all.

    The golden comparisons above would pass just as happily against a port that
    matched the TypeScript's bug, if it had one. This asks the independent
    question, and it is the reason ``inverse`` divides by ``n``.
    """
    case = _GOLDEN["fft1d"]["64"]
    re = np.asarray(case["input"]["re"], dtype=np.float64)
    im = np.asarray(case["input"]["im"], dtype=np.float64)
    fft1d(re, im)
    fft1d(re, im, inverse=True)

    assert np.abs(re - np.asarray(case["input"]["re"])).max() <= _TOLERANCE
    assert np.abs(im - np.asarray(case["input"]["im"])).max() <= _TOLERANCE


def test_fft2d_forward_and_round_trip() -> None:
    """8 wide by 16 tall - non-square, so a width/height swap cannot pass.

    The two axes are different lengths AND the data is not symmetric, which is
    what makes the swap detectable; a square plane would hide it entirely.
    """
    case = _GOLDEN["fft2d"]
    re = np.asarray(case["input"]["re"], dtype=np.float64)
    im = np.asarray(case["input"]["im"], dtype=np.float64)
    fft2d(re, im, case["width"], case["height"])

    assert np.abs(re - np.asarray(case["forward"]["re"])).max() <= _TOLERANCE
    assert np.abs(im - np.asarray(case["forward"]["im"])).max() <= _TOLERANCE

    fft2d(re, im, case["width"], case["height"], inverse=True)

    assert np.abs(re - np.asarray(case["roundTrip"]["re"])).max() <= _TOLERANCE
    assert np.abs(im - np.asarray(case["roundTrip"]["im"])).max() <= _TOLERANCE


def test_fft2d_is_not_the_same_as_transposing_it() -> None:
    """Guards the guard: the goldens above only bite if the swap is visible."""
    case = _GOLDEN["fft2d"]
    swapped_re = np.asarray(case["input"]["re"], dtype=np.float64)
    swapped_im = np.asarray(case["input"]["im"], dtype=np.float64)
    fft2d(swapped_re, swapped_im, case["height"], case["width"])

    assert not np.allclose(swapped_re, np.asarray(case["forward"]["re"]))


def test_fft1d_rejects_a_length_that_is_not_a_power_of_two() -> None:
    """A wrong length silently produces a plausible spectrum, so it throws."""
    re = np.zeros(6, dtype=np.float64)
    im = np.zeros(6, dtype=np.float64)

    with pytest.raises(ValueError, match="power of two"):
        fft1d(re, im)


def test_a_single_point_transform_is_a_no_op() -> None:
    """Length one returns before the butterflies, and before the bit reversal."""
    re = np.asarray([0.25], dtype=np.float64)
    im = np.asarray([-0.5], dtype=np.float64)
    fft1d(re, im)

    assert (re.tolist(), im.tolist()) == ([0.25], [-0.5])
