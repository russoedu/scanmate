"""The guard against numerical debris.

RANSAC on a minimal sample of near-collinear points loves to return a matrix
that folds the page in half, and every rejection below is one of the shapes it
actually produces.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from .geometry_model import Matrix3
from .is_plausible_policy import is_plausible

_GOLDEN = json.loads(
    (Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "plane-geometry.json").read_text(
        encoding="utf-8",
    ),
)


def test_agrees_with_the_typescript_on_the_golden_matrices() -> None:
    """Two plausible transforms, a mirror, and an absurd scale."""
    candidates: list[Matrix3] = [
        tuple(_GOLDEN["inputs"]["A"]),
        tuple(_GOLDEN["inputs"]["B"]),
        (1, 0, 0, 0, -1, 0, 0, 0, 1),
        (1e9, 0, 0, 0, 1e9, 0, 0, 0, 1),
    ]

    assert [is_plausible(m) for m in candidates] == _GOLDEN["withinOneUlp"]["isPlausible"]


def test_accepts_the_identity() -> None:
    assert is_plausible((1, 0, 0, 0, 1, 0, 0, 0, 1))


@pytest.mark.parametrize(
    ("label", "matrix"),
    [
        ("a mirrored page", (1, 0, 0, 0, -1, 0, 0, 0, 1)),
        ("a page folded flat", (1, 2, 0, 2, 4, 0, 0, 0, 1)),
        ("a NaN anywhere", (math.nan, 0, 0, 0, 1, 0, 0, 0, 1)),
        ("an infinity anywhere", (1, 0, math.inf, 0, 1, 0, 0, 0, 1)),
        ("scaled up absurdly", (1e9, 0, 0, 0, 1e9, 0, 0, 0, 1)),
        ("scaled down absurdly", (1e-9, 0, 0, 0, 1e-9, 0, 0, 0, 1)),
    ],
)
def test_rejects(label: str, matrix: Matrix3) -> None:
    """A mirrored page is never a scan of the same page; the rest are debris."""
    assert not is_plausible(matrix)


def test_the_scale_bound_is_a_parameter_rather_than_a_constant() -> None:
    """9x is out of bounds at the default 8 and inside it at 10."""
    stretched: Matrix3 = (9, 0, 0, 0, 9, 0, 0, 0, 1)

    assert not is_plausible(stretched)
    assert is_plausible(stretched, max_scale_ratio=10)
