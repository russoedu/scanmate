"""Matrix algebra, measured against the TypeScript.

TWO BARS, AND THE SPLIT IS DELIBERATE
-------------------------------------

Everything built from additions, multiplications and divisions alone is
asserted with ``==``. A literal transcription of the same expressions on IEEE
doubles is genuinely bit-exact, and anything weaker would hide a reassociation
bug - which is exactly what using ``numpy`` here would have introduced.

The functions that reach for ``math.hypot``, ``math.atan2``, ``math.cos`` or
``math.log`` are asserted to within ONE unit in the last place. That bound is
measured, not guessed: across 169 argument pairs, Python and V8 disagree by at
most 1 ULP on each of those primitives, with a worst relative difference of
2.212e-16 against a machine epsilon of 2.220e-16.

On the current goldens those functions happen to agree EXACTLY - 0 ULP. The
tolerance is still the right contract rather than luck worth pinning: a
different golden input, or a different build of either runtime, can legitimately
land on the other side of that last bit, and a test that failed for it would be
reporting the C library rather than a port bug.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import pytest

from .geometry_model import Matrix3, Point, ScanmateRect
from .matrix3_algorithm import (
    IDENTITY,
    apply_point,
    conjugate_scale,
    decompose,
    determinant,
    invert,
    map_rect_corners,
    multiply,
    normalize,
    rebase,
    reprojection_error,
    scaling,
    similarity,
    translation,
)

_GOLDEN = json.loads(
    (Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "plane-geometry.json").read_text(
        encoding="utf-8",
    ),
)
_EXACT = _GOLDEN["exact"]
_ULP = _GOLDEN["withinOneUlp"]


def as_matrix(values: list[float]) -> Matrix3:
    """Read nine JSON numbers as a matrix of DOUBLES.

    The ``float`` is not decoration. JSON's ``1`` decodes to a Python ``int``,
    and Python integers are arbitrary precision - so a matrix carrying ints
    does exact integer arithmetic where JavaScript, which has only doubles,
    rounds. Caught here by a golden whose first term is ``1 + 1e16 + -1e16``:
    as doubles that is 0, and as Python ints it is exactly 1.

    That makes it a real hazard for any caller of this package, not just for
    these tests - which is why :func:`test_integer_inputs_still_do_double_arithmetic`
    pins the behaviour rather than leaving it to this loader.

    :param values: Nine numbers from a golden file.
    :returns: The matrix, as doubles.
    """
    return tuple(float(value) for value in values)  # type: ignore[return-value]


_A: Matrix3 = as_matrix(_GOLDEN["inputs"]["A"])
_B: Matrix3 = as_matrix(_GOLDEN["inputs"]["B"])

#: The measured bound between Python's and V8's libm on these primitives.
MAX_ULP = 1


def ulps_apart(a: float, b: float) -> int:
    """How many representable doubles lie between two floats.

    A far better tool than a relative tolerance for this job: it says "these
    are adjacent doubles" rather than "these are close enough", which is the
    actual claim being made.

    :param a: One value.
    :param b: The other.
    :returns: The distance in units in the last place.
    """
    if a == b:
        return 0
    ia, ib = (struct.unpack("<q", struct.pack("<d", value))[0] for value in (a, b))
    if ia < 0:
        ia = -(ia & 0x7FFF_FFFF_FFFF_FFFF)
    if ib < 0:
        ib = -(ib & 0x7FFF_FFFF_FFFF_FFFF)

    return int(abs(ia - ib))


class TestExactlyEqualToTheTypeScript:
    """Additions, multiplications and divisions only - so ``==`` is the right bar."""

    def test_multiply(self) -> None:
        assert list(multiply(_A, _B)) == _EXACT["multiply"]

    def test_invert(self) -> None:
        assert list(invert(_A)) == _EXACT["invert"]

    def test_normalize(self) -> None:
        assert list(normalize((2, 4, 6, 8, 10, 12, 14, 16, 2))) == _EXACT["normalize"]

    def test_rebase(self) -> None:
        """The two frames shrink by different factors, which is the common case:
        the original and the scan rarely have the same pixel count.
        """
        assert list(rebase(_A, 0.25, 0.5)) == _EXACT["rebase"]

    def test_map_rect_corners(self) -> None:
        corners = map_rect_corners(_A, ScanmateRect(3, 5, 40, 25))

        assert [list(point) for point in corners] == _EXACT["mapRectCorners"]

    def test_multiply_sums_its_terms_in_the_declared_order(self) -> None:
        """The test that makes ``==`` mean something here.

        Floating-point addition is not associative, but on ordinary matrices
        the difference never shows: reversing the first term's sum left all 84
        other tests green, measured. These inputs are chosen so it does show -
        the first term is ``1 + 1e16 + -1e16``, which is 0 summed left to right
        and 1 summed right to left.

        So this is the assertion that would catch a port reaching for numpy,
        which reassociates and vectorises, or a hand transcription that tidied
        the term order.
        """
        left, right = (as_matrix(m) for m in _GOLDEN["associativity"]["inputs"])

        assert list(multiply(left, right)) == _GOLDEN["associativity"]["product"]

    def test_integer_inputs_still_do_double_arithmetic(self) -> None:
        """The hazard the golden above exposed, pinned as behaviour.

        Python integers are arbitrary precision, so a caller handing this
        function ints gets EXACT arithmetic where JavaScript would have
        rounded - a silent disagreement with the TypeScript that no amount of
        careful transcription would catch. Passing the same values as doubles
        is what agrees.
        """
        left_ints = (1, 10**16, -(10**16), 0, 1, 0, 0, 0, 1)
        right_ints = (1, 0, 0, 1, 0, 0, 1, 0, 1)

        # BOTH sides must be ints for the hazard to appear: a single float on
        # either side promotes the whole expression, which is why the first
        # version of this test passed for the wrong reason.
        assert multiply(left_ints, right_ints)[0] == 1
        assert multiply(as_matrix(list(left_ints)), as_matrix(list(right_ints)))[0] == 0


class TestWithinOneUlpOfTheTypeScript:
    """Everything here goes through hypot, atan2 or cos - see the module docstring."""

    def test_similarity(self) -> None:
        got = similarity(1.25, 0.31, Point(100, 200), Point(310, 90))
        worst = max(ulps_apart(a, b) for a, b in zip(got, _ULP["similarity"], strict=True))

        assert worst <= MAX_ULP

    def test_decompose(self) -> None:
        got = decompose(_A, "homography")
        want = _ULP["decompose"]
        pairs = [
            (got.scale_x, want["scaleX"]),
            (got.scale_y, want["scaleY"]),
            (got.rotation_deg, want["rotationDeg"]),
            (got.shear_deg, want["shearDeg"]),
            (got.translation.x, want["translation"]["x"]),
            (got.translation.y, want["translation"]["y"]),
            (got.perspective.x, want["perspective"]["x"]),
            (got.perspective.y, want["perspective"]["y"]),
        ]

        assert got.model == want["model"]
        assert max(ulps_apart(a, b) for a, b in pairs) <= MAX_ULP

    def test_reprojection_error(self) -> None:
        got = reprojection_error(_A, Point(11, 13), Point(17, 19))

        assert ulps_apart(got, _ULP["reprojectionError"]) <= MAX_ULP


class TestTheConventionsThatMatter:
    """Properties, rather than pinned numbers - these say what the code MEANS."""

    def test_identity_is_the_multiplicative_identity(self) -> None:
        assert multiply(IDENTITY, _A) == _A
        assert multiply(_A, IDENTITY) == _A

    def test_invert_undoes_multiply(self) -> None:
        """Round-tripping is a ULP-level claim, not an exact one: the inverse is
        computed, not recovered.
        """
        round_tripped = multiply(invert(_A), _A)

        assert all(
            abs(got - want) < 1e-12
            for got, want in zip(round_tripped, IDENTITY, strict=True)
        )

    def test_invert_refuses_a_singular_matrix(self) -> None:
        """A transform that collapses the page to a line is never a usable answer,
        so this throws where ``solve`` returns ``None`` - see that function.
        """
        with pytest.raises(ValueError, match="singular"):
            invert((1, 2, 3, 2, 4, 6, 0, 0, 1))

    def test_determinant_of_a_scaling_is_the_area_factor(self) -> None:
        assert determinant(scaling(3, 5)) == 15

    def test_translation_moves_a_point_by_exactly_that_much(self) -> None:
        assert apply_point(translation(7, -4), 10, 10) == Point(17, 6)

    def test_apply_point_survives_a_zero_w(self) -> None:
        """A point on the horizon has no image. The TypeScript returns 0 rather
        than infinity, and so does this - a silent infinity would poison every
        downstream average.
        """
        horizon: Matrix3 = (1, 0, 0, 0, 1, 0, 0, 0, 0)

        assert apply_point(horizon, 5, 5) == Point(0, 0)

    def test_normalize_leaves_an_already_normal_matrix_untouched(self) -> None:
        assert normalize(_A) is _A

    def test_conjugate_scale_is_the_identity_at_scale_one(self) -> None:
        assert conjugate_scale(_A, 1) == _A

    def test_scaling_defaults_to_uniform(self) -> None:
        assert scaling(3) == scaling(3, 3)
