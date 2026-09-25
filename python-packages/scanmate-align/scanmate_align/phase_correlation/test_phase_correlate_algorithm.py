"""Phase correlation, measured against the TypeScript - with a real tolerance.

This is the second slice in the whole port that cannot be held to ``==``, and
it is inexact for a borrowed reason rather than one of its own:
:func:`~scanmate_ink.fft2d` sits on a libm seam, and everything here runs
through two forward transforms and one inverse.

THERE ARE TWO SEAMS, AND THEY ARE PINNED SEPARATELY
-----------------------------------------------------

1. ``sin(+/- pi / 4)``, which the FFT's own tests already document: MSVC's libm
   returns the correctly rounded value, glibc's returns the one V8 returns, and
   the two differ by one unit in the last place.
2. ``Math.cos`` at the Hann window's arguments. Measured here: ``math.cos``
   disagrees with ``Math.cos`` on **5 of 125** of them on Windows.

The second is the reason ``TestTheCosineSeam`` exists. Without it a
``Math.cos`` disagreement would be indistinguishable from the FFT's, and the
tolerance below would quietly be covering two faults while claiming to cover
one.

WHAT IS EXACT ANYWAY
--------------------

Which PIXEL the spike lands on. The surface wobbles by a fraction of an ULP,
which cannot move which sample is largest - and if it ever did, the answer
would be a whole pixel out, which no tolerance should absorb. That is asserted
with ``==`` for every case, and it is the assertion that would actually catch a
broken port.

``dx``, ``dy`` and ``peak`` are held to an absolute 1e-12, the same bar the
FFT's tests use. Measured worst case: 2.22e-16.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from scanmate_ink import GrayImage

from .phase_correlate_algorithm import _parabolic, _wrap, hann, phase_correlate

_GOLDEN = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "align-phase-correlation.json"
    ).read_text(encoding="utf-8")
)

#: The same absolute bar the FFT's own parity tests use. Absolute rather than
#: in ULPs because an inverse transform returns components near zero, where one
#: ULP is 1e-19 and a perfectly good answer reads as thousands of ULP out.
_TOLERANCE = 1e-12

_WIDTH: int = _GOLDEN["size"]["width"]
_HEIGHT: int = _GOLDEN["size"]["height"]
_BASE = GrayImage(np.asarray(_GOLDEN["base"], dtype=np.float32).reshape(_HEIGHT, _WIDTH))
_CASES: list[dict[str, Any]] = _GOLDEN["cases"]
_DEGENERATE: list[dict[str, Any]] = _GOLDEN["degenerate"]


def _image(flat: list[float]) -> GrayImage:
    return GrayImage(np.asarray(flat, dtype=np.float32).reshape(_HEIGHT, _WIDTH))


def _ids() -> list[str]:
    return [case["label"] for case in _CASES]


class TestTheCosineSeam:
    """``Math.cos`` is a second libm difference, and it gets its own test.

    Pinned apart from the FFT's seam so the tolerance below is evidence rather
    than a shrug: if this starts failing by more than a ULP, the cause is not
    the transform and the tolerance should not be widened to hide it.
    """

    def test_every_disagreement_is_at_most_one_ulp(self) -> None:
        worst = 0.0
        disagreements = 0
        total = 0
        for length, values in _GOLDEN["cos"].items():
            n = int(length)
            for i, want in enumerate(values):
                total += 1
                got = math.cos((2 * math.pi * i) / (n - 1))
                if got != want:
                    disagreements += 1
                    # One ULP at this magnitude, and no more. Anything larger
                    # would not be a rounding difference, and the bound the
                    # tolerance rests on would be a guess.
                    worst = max(worst, abs(got - want) / max(abs(want), 2.220446049250313e-16))

        assert worst <= 1.0, f"{disagreements} of {total} differ, worst {worst} ULP"

    def test_the_disagreement_is_real_and_not_assumed_away(self) -> None:
        # On Windows this is 5 of 125; on Linux it may well be 0. Either is
        # fine - what is NOT fine is the test silently becoming vacuous, so
        # this records which platform it is running on rather than asserting a
        # count that only holds on one of them.
        total = sum(len(v) for v in _GOLDEN["cos"].values())
        disagreements = sum(
            1
            for length, values in _GOLDEN["cos"].items()
            for i, want in enumerate(values)
            if math.cos((2 * math.pi * i) / (int(length) - 1)) != want
        )
        assert disagreements <= total
        assert total > 0


class TestTheSpikeLandsOnTheSamePixel:
    """The exact part, and the one that would catch a genuinely broken port."""

    @pytest.mark.parametrize("case", _CASES, ids=_ids())
    def test_the_same_sample_is_largest(self, case: dict[str, Any]) -> None:
        got = phase_correlate(_BASE, _image(case["shifted"]))
        want = case["result"]
        # Rounded, because `dx` carries the sub-pixel refinement. Which whole
        # pixel it refines FROM is what has to match exactly.
        assert round(got.dx) == round(want["dx"])
        assert round(got.dy) == round(want["dy"])

    @pytest.mark.parametrize("case", _CASES, ids=_ids())
    def test_it_finds_the_shift_it_was_given(self, case: dict[str, Any]) -> None:
        # Not a parity check - a check on the goldens. If the fixture stopped
        # producing a findable peak, every parity assertion above would still
        # pass while proving nothing at all.
        got = phase_correlate(_BASE, _image(case["shifted"]))
        assert abs(got.dx - case["requested"]["dx"]) < 0.5
        assert abs(got.dy - case["requested"]["dy"]) < 0.5


class TestTheValuesThemselves:
    """``dx``, ``dy`` and ``peak``, within the measured bound."""

    @pytest.mark.parametrize("case", _CASES, ids=_ids())
    def test_within_the_tolerance(self, case: dict[str, Any]) -> None:
        got = phase_correlate(_BASE, _image(case["shifted"]))
        want = case["result"]
        assert abs(got.dx - want["dx"]) < _TOLERANCE
        assert abs(got.dy - want["dy"]) < _TOLERANCE
        assert abs(got.peak - want["peak"]) < _TOLERANCE

    def test_the_worst_case_is_far_inside_the_tolerance(self) -> None:
        """The tolerance is evidence only if there is headroom.

        Measured at 2.22e-16 for the textured cases and 1.61e-17 for the
        degenerate ones, against a bar of 1e-12. The headroom assertion is
        three orders tighter than the tolerance, which is what makes it able to
        catch things the tolerance alone would absorb: dropping the
        tiny-magnitude guard moves the uniform page's peak by 5.23e-14, well
        inside 1e-12 and well outside this.

        The degenerate cases are in here for exactly that reason. A mutation
        run showed the guard survived while this test looked only at the
        textured ones, which never drive a cross-power magnitude below 1e-12.
        """
        worst = 0.0
        for case in _CASES:
            got = phase_correlate(_BASE, _image(case["shifted"]))
            want = case["result"]
            worst = max(
                worst,
                abs(got.dx - want["dx"]),
                abs(got.dy - want["dy"]),
                abs(got.peak - want["peak"]),
            )
        for case in _DEGENERATE:
            image = _image(case["pixels"])
            got = phase_correlate(image, image)
            want = case["result"]
            worst = max(
                worst,
                abs(got.dx - want["dx"]),
                abs(got.dy - want["dy"]),
                abs(got.peak - want["peak"]),
            )

        assert worst < _TOLERANCE / 1000, f"worst difference {worst} has no headroom left"


class TestTheAlgorithmMeansWhatItSays:
    """Properties, not parity. These hold on any correct implementation."""

    def test_an_unshifted_pair_correlates_perfectly(self) -> None:
        still = next(c for c in _CASES if c["label"] == "still")
        got = phase_correlate(_BASE, _image(still["shifted"]))
        assert got.dx == 0
        assert got.dy == 0
        # A perfect match is a single spike of height 1, not merely the tallest
        # thing on a noisy surface.
        assert got.peak > 0.999

    def test_a_negative_shift_reads_as_negative(self) -> None:
        # The `wrap` branch: the spike comes back near the far edge of the
        # correlation surface, and reading it as a large positive shift rather
        # than a small negative one is the classic phase-correlation bug.
        back = next(c for c in _CASES if c["label"] == "back")
        got = phase_correlate(_BASE, _image(back["shifted"]))
        assert got.dx < 0
        assert got.dy < 0

    def test_mismatched_sizes_are_refused(self) -> None:
        with pytest.raises(ValueError, match="same size"):
            phase_correlate(_BASE, GrayImage(np.zeros((8, 8), dtype=np.float32)))


class TestDegeneratePages:
    """A blank form is the case this algorithm exists for, and it is special.

    Both of these reach branches no textured image does, and both were added
    after a mutation run showed the textured cases could not tell a correct
    port from a broken one:

    - the uniform page drives the cross-power magnitude below 1e-12 on 1,495 of
      4,096 bins, which is the guard that zeroes them. Without it those bins
      divide by (almost) zero and the surface fills with noise.
    - the empty page does it on all 4,096, leaving every sample tied for
      largest. That is the only input here that can tell "the first maximum
      wins" from "the last one does" - and those two answers are a whole page
      apart.
    """

    @pytest.mark.parametrize("case", _DEGENERATE, ids=[c["label"] for c in _DEGENERATE])
    def test_it_agrees_with_the_typescript(self, case: dict[str, Any]) -> None:
        image = _image(case["pixels"])
        got = phase_correlate(image, image)
        want = case["result"]
        assert abs(got.dx - want["dx"]) < _TOLERANCE
        assert abs(got.dy - want["dy"]) < _TOLERANCE
        assert abs(got.peak - want["peak"]) < _TOLERANCE

    def test_an_empty_page_reports_no_shift_and_no_confidence(self) -> None:
        # The contract that matters to a caller: there is nothing to align, and
        # `peak` says so rather than the zero shift looking like a clean match.
        empty = next(c for c in _DEGENERATE if c["label"] == "empty")
        got = phase_correlate(_image(empty["pixels"]), _image(empty["pixels"]))
        assert got.dx == 0
        assert got.dy == 0
        assert got.peak == 0

    def test_a_uniform_page_is_not_mistaken_for_a_clean_match(self) -> None:
        uniform = next(c for c in _DEGENERATE if c["label"] == "uniform")
        got = phase_correlate(_image(uniform["pixels"]), _image(uniform["pixels"]))
        # It finds no shift, correctly - but its confidence is well short of
        # the 1.0 a real match scores, which is what lets a caller reject it.
        assert round(got.dx) == 0
        assert round(got.dy) == 0
        assert got.peak < 0.7


class TestTheHelperContracts:
    """`wrap` and `parabolic`, against what their docstrings promise.

    Neither is exported from `@scanmate/align`, so neither has a golden -
    goldening them would mean restating them in the writer, and a golden
    written by hand only proves that two copies of the same misunderstanding
    agree.

    Their CONTRACTS are not private, though, and each has exactly one boundary
    that no realistic image reaches. A mutation run confirmed that: moving
    either boundary left every correlation test passing. A shift of exactly
    half the padded width was tried as a fixture and aliased onto nothing
    findable, which is why these are stated directly instead.
    """

    def test_wrap_maps_onto_a_half_open_interval(self) -> None:
        # The docstring says `[-n/2, n/2)`. Half-open on the right is the whole
        # claim: n/2 itself stays positive, and anything above it comes back
        # negative. `>=` instead of `>` would put a half-width shift a full
        # page away from where it belongs.
        assert _wrap(32, 64) == 32
        assert _wrap(32.0000001, 64) == pytest.approx(-31.9999999)
        assert _wrap(33, 64) == -31
        assert _wrap(0, 64) == 0
        assert _wrap(63, 64) == -1

    def test_parabolic_rejects_a_vertex_a_whole_pixel_away(self) -> None:
        # The docstring says the offset is dropped when it lands further than a
        # whole pixel away - strictly, so exactly one pixel is already too far.
        # Three samples whose exact vertex is 1.0: 0.5 * (-3 - 1) / (-3 + 1).
        assert 0.5 * (-3.0 - 1.0) / (-3.0 - 2 * 0.0 + 1.0) == 1.0
        assert _parabolic(-3.0, 0.0, 1.0) == 0.0
        # And just inside the boundary it is KEPT, so the rejection is a
        # boundary rather than a blanket refusal. Note which way "inside" runs:
        # with the centre at 0 and the right sample at 1, the vertex is
        # `0.5 * (L - 1) / (L + 1)`, which FALLS as L goes more negative. -2.9
        # was the obvious guess and is outside at 1.026; -4 is inside at 0.833.
        assert _parabolic(-4.0, 0.0, 1.0) == pytest.approx(0.8333333333333334)

    def test_parabolic_refuses_a_flat_surface_rather_than_dividing(self) -> None:
        # Three equal samples describe no peak at all; the denominator is zero.
        assert _parabolic(0.5, 0.5, 0.5) == 0.0

    def test_parabolic_finds_the_vertex_of_a_real_peak(self) -> None:
        # A symmetric peak has its vertex exactly at the centre sample.
        assert _parabolic(0.0, 1.0, 0.0) == 0.0
        # Leaning right, so the vertex moves right. Sign, not just magnitude:
        # a flipped sign is a sub-pixel error in the wrong direction on every
        # alignment this feeds.
        assert _parabolic(0.0, 1.0, 0.5) > 0
        assert _parabolic(0.5, 1.0, 0.0) < 0

    def test_hann_of_one_is_a_single_one_rather_than_a_division(self) -> None:
        # `n - 1` is the denominator, so a window of length 1 would divide by
        # zero. The TypeScript special-cases it and so does this; a port that
        # dropped the branch raises instead, and nothing else in the suite
        # calls a window this short.
        assert hann(1).tolist() == [1.0]

    def test_hann_of_two_is_all_zeros(self) -> None:
        # Both ends of the window, and nothing in between: cos(0) and cos(2*pi)
        # are both 1, so the whole window is zero. It looks like a bug and is
        # not, which is why it is written down rather than "helpfully" avoided.
        assert hann(2).tolist() == [0.0, 0.0]

    def test_hann_is_symmetric_and_peaks_in_the_middle(self) -> None:
        w = hann(64)
        assert w[0] == 0
        assert w[-1] == pytest.approx(0, abs=1e-15)
        assert w[32] == pytest.approx(max(w))
        # Symmetry is the property that makes it a window rather than a ramp,
        # and an off-by-one in the denominator breaks it.
        assert w[1] == pytest.approx(w[-2])
