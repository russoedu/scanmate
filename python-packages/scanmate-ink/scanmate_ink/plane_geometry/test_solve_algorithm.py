"""The dense solvers, measured against the TypeScript.

Asserted with ``==`` throughout. These are additions, multiplications,
divisions and ``math.sqrt`` - and sqrt is one of the primitives Python and V8
agree on exactly (measured over the same sweep that found hypot, atan2, cos and
log differing by a ULP). So a literal transcription is genuinely bit-exact.

That is also the reason ``numpy.linalg`` is not used in the module under test.
LAPACK would give an answer just as correct and NOT the same one in the last
bits, which would make every assertion here approximate for no benefit.
"""

from __future__ import annotations

import json
from pathlib import Path

from .solve_algorithm import jacobi_eigen, smallest_eigenvector, solve

_GOLDEN = json.loads(
    (Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "plane-geometry.json").read_text(
        encoding="utf-8",
    ),
)
_EXACT = _GOLDEN["exact"]
_INPUTS = _GOLDEN["inputs"]


class TestSolve:
    def test_matches_the_typescript_exactly(self) -> None:
        assert solve(_INPUTS["solveA"], _INPUTS["solveB"], 3) == _EXACT["solve"]

    def test_returns_none_for_a_singular_system(self) -> None:
        """A RETURN VALUE, not an exception: for the affine fit a singular
        system means the sample points were collinear, which is a real and
        common case rather than an exceptional one.
        """
        assert solve([1, 2, 2, 4], [1, 2], 2) is None
        assert _EXACT["solveSingular"] is True

    def test_does_not_destroy_the_caller_s_input(self) -> None:
        """The TypeScript documents ``a`` as destroyed and then copies it
        anyway. This copies too, and here it is asserted rather than assumed.
        """
        a = list(_INPUTS["solveA"])
        b = list(_INPUTS["solveB"])
        solve(a, b, 3)

        assert a == _INPUTS["solveA"]
        assert b == _INPUTS["solveB"]

    def test_solves_a_system_whose_answer_is_known_by_hand(self) -> None:
        """2x = 4, 3y = 9 - a check that reads as arithmetic rather than as a
        golden, so a wrong golden could not make this pass.
        """
        assert solve([2, 0, 0, 3], [4, 9], 2) == [2, 3]

    def test_pivots_rather_than_dividing_by_a_zero_diagonal(self) -> None:
        """The first pivot is 0, so without partial pivoting this divides by
        zero. The system is perfectly well conditioned.
        """
        assert solve([0, 1, 1, 0], [5, 7], 2) == [7, 5]


class TestJacobiEigen:
    def test_values_match_the_typescript_exactly(self) -> None:
        values, _ = jacobi_eigen(_INPUTS["symmetric4"], 4)

        assert values == _EXACT["jacobiValues"]

    def test_vectors_match_the_typescript_exactly(self) -> None:
        """Sign and column order are part of the contract, not incidental: the
        homography fit reads one specific column out of this.
        """
        _, vectors = jacobi_eigen(_INPUTS["symmetric4"], 4)

        assert vectors == _EXACT["jacobiVectors"]

    def test_does_not_modify_its_input(self) -> None:
        source = list(_INPUTS["symmetric4"])
        jacobi_eigen(source, 4)

        assert source == _INPUTS["symmetric4"]

    def test_diagonalises_a_matrix_whose_eigenvalues_are_obvious(self) -> None:
        """A diagonal matrix is already diagonal, so the values come straight
        back and the vectors are the identity - arithmetic, not a golden.
        """
        values, vectors = jacobi_eigen([3, 0, 0, 0, 5, 0, 0, 0, 7], 3)

        assert values == [3, 5, 7]
        assert vectors == [1, 0, 0, 0, 1, 0, 0, 0, 1]


class TestSmallestEigenvector:
    def test_matches_the_typescript_exactly(self) -> None:
        assert smallest_eigenvector(_INPUTS["symmetric6"], 6) == _EXACT["smallestEigen"]

    def test_picks_the_smallest_eigenvalue_and_returns_a_unit_vector(self) -> None:
        """The null-space direction is what the homography fit is after - the
        direction the data constrains LEAST.
        """
        vector = smallest_eigenvector([9, 0, 0, 0, 2, 0, 0, 0, 5], 3)

        assert [abs(value) for value in vector] == [0, 1, 0]
