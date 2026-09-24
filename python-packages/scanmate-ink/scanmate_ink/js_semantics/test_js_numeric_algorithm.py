"""The coercions and the rounding a faithful port cannot do without.

Each of these is a place Python and JavaScript genuinely disagree, asserted
directly rather than only through a caller - when a caller's output drifts,
these say which primitive moved.
"""

from __future__ import annotations

import pytest

from .js_numeric_algorithm import imul, js_round, to_int32, to_uint32, ushr


class TestCoercions:
    def test_to_uint32_wraps_rather_than_growing(self) -> None:
        assert to_uint32(-1) == 0xFFFF_FFFF
        assert to_uint32(0x1_0000_0000) == 0
        assert to_uint32(0x1_2345_6789) == 0x2345_6789

    def test_to_int32_sign_extends_from_the_high_bit(self) -> None:
        assert to_int32(0x8000_0000) == -2_147_483_648
        assert to_int32(0xFFFF_FFFF) == -1
        assert to_int32(0x7FFF_FFFF) == 2_147_483_647

    def test_imul_wraps_like_math_imul(self) -> None:
        """The case that separates it from Python's ``*``: the true product is
        far wider than 32 bits, and JavaScript keeps only the low half.
        """
        assert imul(0xFFFF_FFFF, 5) == -5
        assert imul(2, 4) == 8
        assert imul(-5, 12) == -60

    def test_ushr_is_logical_where_pythons_shift_is_arithmetic(self) -> None:
        """Python's ``-1 >> 1`` is -1 forever; JavaScript's ``-1 >>> 1`` is
        ``2**31 - 1``.
        """
        assert ushr(-1, 1) == 0x7FFF_FFFF
        assert ushr(-1, 0) == 0xFFFF_FFFF
        assert ushr(1024, 4) == 64


class TestJsRound:
    """Python rounds half to EVEN; JavaScript rounds half towards +infinity.

    They disagree on every half-way case, which is why this exists at all. The
    values below are the four measured against the real V8.
    """

    @pytest.mark.parametrize(
        ("value", "expected"),
        [(0.5, 1), (2.5, 3), (-0.5, 0), (-1.5, -1), (1.5, 2), (3.5, 4)],
    )
    def test_matches_javascript_on_every_half_way_case(
        self, value: float, expected: int,
    ) -> None:
        assert js_round(value) == expected

    @pytest.mark.parametrize(
        ("value", "expected"),
        [(0.4, 0), (0.6, 1), (2.49, 2), (-2.4, -2), (-2.6, -3), (7.0, 7)],
    )
    def test_behaves_normally_away_from_the_half_way_cases(
        self, value: float, expected: int,
    ) -> None:
        assert js_round(value) == expected

    def test_differs_from_pythons_builtin_exactly_where_expected(self) -> None:
        """Stated as a contrast so the reason this helper exists cannot be
        forgotten and 'simplified' back to ``round``.
        """
        half_way = [0.5, 2.5, -0.5, -1.5]

        assert [js_round(v) for v in half_way] != [round(v) for v in half_way]
        assert all(js_round(v) == round(v) for v in [0.4, 0.6, 7.0, -2.4])
