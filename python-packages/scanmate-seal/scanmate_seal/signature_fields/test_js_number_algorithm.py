"""``Number(string)``, pinned case by case.

There is no golden for this one. It is not a ScanMate algorithm - it is a
language's conversion rule, and the reference is the language. Every case below
was checked against Node before it was written down, together with a 4000-case
fuzz over the alphabet these tokens are drawn from; what is kept here is the
part a reader needs to see, not the part that takes a minute to run.
"""

from __future__ import annotations

import math

import pytest

from .js_number_algorithm import js_number


class TestWhatPythonWouldRefuse:
    """Tokens ``float()`` rejects and ``Number`` accepts."""

    @pytest.mark.parametrize(
        ("token", "expected"),
        [("0x10", 16), ("0X1F", 31), ("0b11", 3), ("0o17", 15), ("0B101", 5), ("0O7", 7)],
    )
    def test_radix_prefixes_are_numbers(self, token: str, expected: int) -> None:
        assert js_number(token) == expected

    @pytest.mark.parametrize("token", ["", "   ", "\t\n"])
    def test_an_empty_token_is_zero_not_an_error(self, token: str) -> None:
        # The one case where an empty `/ByteRange` entry becomes a real number
        # rather than being rejected as non-finite.
        assert js_number(token) == 0.0

    def test_infinity_is_spelled_with_a_capital(self) -> None:
        assert js_number("Infinity") == math.inf
        assert js_number("-Infinity") == -math.inf
        assert js_number("+Infinity") == math.inf


class TestWhatPythonWouldAccept:
    """Tokens ``float()`` accepts and ``Number`` does not.

    The direction that matters more: each of these would turn a malformed
    ``/ByteRange`` into a plausible one, and a plausible ``/ByteRange`` is a
    verdict about a signature.
    """

    @pytest.mark.parametrize("token", ["inf", "infinity", "nan", "-inf", "INF"])
    def test_pythons_spellings_of_infinity_and_nan_are_not_numbers(self, token: str) -> None:
        assert math.isnan(js_number(token))

    @pytest.mark.parametrize("token", ["1_000", "0x1_0", "1_0.5"])
    def test_underscores_are_not_digit_separators(self, token: str) -> None:
        assert math.isnan(js_number(token))

    @pytest.mark.parametrize("token", ["0x+10", "0x-10", "0b+1"])
    def test_a_sign_is_not_part_of_a_radix_literal(self, token: str) -> None:
        assert math.isnan(js_number(token))


class TestTheOrdinaryCases:
    @pytest.mark.parametrize(
        ("token", "expected"),
        [
            ("0", 0.0),
            ("12", 12.0),
            ("-3", -3.0),
            ("+5", 5.0),
            ("  7  ", 7.0),
            ("0000000010", 10.0),
            ("1e3", 1000.0),
            ("1E-2", 0.01),
            (".5", 0.5),
            ("5.", 5.0),
            ("-.5", -0.5),
        ],
    )
    def test_reads_a_number(self, token: str, expected: float) -> None:
        assert js_number(token) == expected

    @pytest.mark.parametrize("token", ["abc", "12px", "1.2.3", "--5", "1e", "0xg", "0x", "0b"])
    def test_rejects_everything_else(self, token: str) -> None:
        assert math.isnan(js_number(token))

    def test_an_overflowing_exponent_is_infinite_rather_than_an_error(self) -> None:
        # `/ByteRange [1e400 ...]` is rejected downstream by the finite check,
        # which only works if getting here produces infinity instead of raising.
        assert js_number("1e400") == math.inf

    def test_negative_zero_survives(self) -> None:
        assert math.copysign(1, js_number("-0")) == -1
