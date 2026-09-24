"""``Math.hypot``, held to V8's own output.

This file exists because of a bug it would have caught. The port used
:func:`math.hypot`, every plane-geometry golden agreed, all 1,227 tests passed,
and the divergence only surfaced from ``@scanmate/align``'s RANSAC goldens -
where a mean over 40 reprojection errors came out one ULP low.

So the negative controls below are not decoration. A test that only asserts
"our hypot matches the golden" would have passed against the broken version too
if the goldens had been drawn from tidier numbers; asserting that
:func:`math.hypot` and :func:`numpy.hypot` *do not* match is what pins the
reason this module has to exist at all.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from .hypot_algorithm import hypot, hypot2

_GOLDEN = json.loads(
    (Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "js-hypot.json").read_text(
        encoding="utf-8"
    )
)

_PAIRS: list[list[float]] = _GOLDEN["pairs"]
_VALUES: list[float] = _GOLDEN["values"]


def _decode(value: float | str) -> float:
    """``"Infinity"`` back to a float. JSON has no literal for it."""
    return float(value) if isinstance(value, str) else value


class TestAgainstV8:
    """Every pair, exactly."""

    def test_every_pair_in_the_sweep(self) -> None:
        wrong = [
            (a, b, hypot(a, b), want)
            for (a, b), want in zip(_PAIRS, _VALUES, strict=True)
            if hypot(a, b) != want
        ]
        assert wrong == [], f"{len(wrong)} of {len(_PAIRS)} pairs disagree with Math.hypot"

    @pytest.mark.parametrize("edge", _GOLDEN["edges"])
    def test_the_named_edges(self, edge: dict[str, float | str]) -> None:
        # Zero (which short-circuits before the scaling divides by it), a
        # single zero component, negatives, and the overflow and infinity
        # cases the scaling exists to survive.
        assert hypot(_decode(edge["a"]), _decode(edge["b"])) == _decode(edge["hypot"])

    @pytest.mark.parametrize("case", _GOLDEN["three"])
    def test_three_arguments(self, case: dict[str, list[float] | float]) -> None:
        # With three summands the Kahan compensation is no longer zero, so the
        # two-argument simplification `sqrt(x^2 + y^2)` parts company with the
        # answer. JavaScript's Math.hypot is variadic and so is this.
        values = case["values"]
        assert isinstance(values, list)
        assert hypot(*values) == case["hypot"]


class TestTheReasonThisExists:
    """The negative controls.

    If either of these ever starts passing, the standard library has changed
    its algorithm and this module should be re-measured - not deleted, because
    "they agree today" is not the same claim as "they are the same function".
    """

    def test_cpython_disagrees_with_v8_on_a_sixth_of_the_sweep(self) -> None:
        disagreements = sum(
            1 for (a, b), want in zip(_PAIRS, _VALUES, strict=True) if math.hypot(a, b) != want
        )
        # Measured at 16.03% over 20,000 pairs; asserted as a broad band so
        # this pins the PHENOMENON rather than one sample's exact count.
        assert disagreements > len(_PAIRS) * 0.05, (
            "math.hypot now agrees with V8 far more often than measured - "
            "re-measure before trusting it"
        )

    def test_numpy_disagrees_too(self) -> None:
        a = np.array([p[0] for p in _PAIRS], dtype=np.float64)
        b = np.array([p[1] for p in _PAIRS], dtype=np.float64)
        want = np.array(_VALUES, dtype=np.float64)
        assert int(np.count_nonzero(np.hypot(a, b) != want)) > len(_PAIRS) * 0.05

    def test_it_is_not_simply_sqrt_of_the_sum_of_squares_either(self) -> None:
        # The other tempting shortcut. V8 scales first, so this is a third
        # answer again - which is why the scaling has to be reproduced rather
        # than reasoned around.
        naive = sum(
            1
            for (a, b), want in zip(_PAIRS, _VALUES, strict=True)
            if math.sqrt(a * a + b * b) != want
        )
        assert naive > 0


class TestVectorised:
    """:func:`hypot2` must equal :func:`hypot`, not merely approximate it."""

    def test_it_agrees_with_the_scalar_form_over_the_whole_sweep(self) -> None:
        a = np.array([p[0] for p in _PAIRS], dtype=np.float64)
        b = np.array([p[1] for p in _PAIRS], dtype=np.float64)
        got = hypot2(a, b)
        want = np.array(_VALUES, dtype=np.float64)
        assert int(np.count_nonzero(got != want)) == 0

    def test_zero_magnitudes_come_back_as_zero_rather_than_nan(self) -> None:
        # The branch that matters: without the `where`, the scaling divides by
        # zero and the whole column is NaN.
        got = hypot2(np.array([0.0, 3.0]), np.array([0.0, 4.0]))
        assert got.tolist() == [0.0, 5.0]

    def test_it_preserves_shape(self) -> None:
        got = hypot2(np.zeros((2, 3)) + 3, np.zeros((2, 3)) + 4)
        assert got.shape == (2, 3)
        assert np.all(got == 5)
