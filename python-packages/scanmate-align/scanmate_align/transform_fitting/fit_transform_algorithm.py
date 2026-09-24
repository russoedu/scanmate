"""Fitting a transform to a set of correspondences.

Three models, and the choice between them is a bet about what the scan went
through. A flatbed scanner moves the page in one plane, so a **similarity**
(turn it, resize it, slide it) is the whole story and its four parameters are
pinned down by very few points - which is exactly what you want when most of
your matches are wrong. A sheet-fed scanner can stretch one axis; that needs
**affine**. A photograph taken at an angle needs the full **homography**, and
pays for those eight parameters by being far easier to fit to nonsense.

Prefer the simplest model the physical situation allows.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import NamedTuple

from scanmate_ink import (
    Matrix3,
    Point,
    TransformModel,
    hypot,
    invert,
    multiply,
    smallest_eigenvector,
    solve,
)


class Correspondence(NamedTuple):
    """One source point and where it went.

    The TypeScript is ``Pick<PointMatch, 'source' | 'target'>`` - a
    ``PointMatch`` with its ``distance`` ignored. A named tuple of the two
    points says the same thing and, unlike a structural pick, cannot silently
    acquire a third field.
    """

    source: Point
    target: Point


def minimum_samples(model: TransformModel) -> int:
    """How many correspondences the model needs before it is determined at all."""
    if model == "similarity":
        return 2
    if model == "affine":
        return 3

    return 4


def fit_model(
    model: TransformModel,
    matches: Sequence[Correspondence],
    indices: Sequence[int] | None = None,
) -> Matrix3 | None:
    """Fit ``model`` to ``matches``, optionally restricted to ``indices``."""
    if model == "similarity":
        return fit_similarity(matches, indices)
    if model == "affine":
        return fit_affine(matches, indices)

    return fit_homography(matches, indices)


def fit_similarity(
    matches: Sequence[Correspondence],
    indices: Sequence[int] | None = None,
) -> Matrix3 | None:
    """Least-squares similarity, in closed form.

    No iteration and no matrix inverse: centre both point sets, and the
    rotation and scale fall out of two dot products. That closed form is why
    similarity survives a RANSAC sample that affine would choke on.
    """
    picked = _select(matches, indices)
    if len(picked) < 2:
        return None

    sx = 0.0
    sy = 0.0
    tx = 0.0
    ty = 0.0
    for m in picked:
        sx += m.source.x
        sy += m.source.y
        tx += m.target.x
        ty += m.target.y
    n = len(picked)
    sx /= n
    sy /= n
    tx /= n
    ty /= n

    dot = 0.0
    cross = 0.0
    norm = 0.0
    for m in picked:
        px = m.source.x - sx
        py = m.source.y - sy
        qx = m.target.x - tx
        qy = m.target.y - ty
        dot += px * qx + py * qy
        cross += px * qy - py * qx
        norm += px * px + py * py

    if norm < 1e-12:
        return None

    a = dot / norm
    b = cross / norm
    if hypot(a, b) < 1e-9:
        return None

    return (
        a, -b, tx - a * sx + b * sy,
        b, a, ty - b * sx - a * sy,
        0.0, 0.0, 1.0,
    )


def fit_affine(
    matches: Sequence[Correspondence],
    indices: Sequence[int] | None = None,
) -> Matrix3 | None:
    """Least-squares affine: two independent 3x3 normal systems sharing one matrix."""
    picked = _select(matches, indices)
    if len(picked) < 3:
        return None

    m = [0.0] * 9
    bx = [0.0] * 3
    by = [0.0] * 3

    for match in picked:
        x = match.source.x
        y = match.source.y
        u = match.target.x
        v = match.target.y

        m[0] += x * x
        m[1] += x * y
        m[2] += x
        m[4] += y * y
        m[5] += y
        m[8] += 1

        bx[0] += x * u
        bx[1] += y * u
        bx[2] += u
        by[0] += x * v
        by[1] += y * v
        by[2] += v

    m[3] = m[1]
    m[6] = m[2]
    m[7] = m[5]

    row0 = solve(m, bx, 3)
    row1 = solve(m, by, 3)
    if row0 is None or row1 is None:
        return None

    return (row0[0], row0[1], row0[2], row1[0], row1[1], row1[2], 0.0, 0.0, 1.0)


def fit_homography(
    matches: Sequence[Correspondence],
    indices: Sequence[int] | None = None,
) -> Matrix3 | None:
    """Direct Linear Transform with Hartley normalisation.

    The normalisation is not optional polish. Raw pixel coordinates put entries
    like ``x * u`` (order 10^6) next to a constant 1 in the same row, and the
    eigen solve then answers a question dominated by the big column. Centring
    each point set and scaling it to a mean radius of ``sqrt(2)`` puts every
    column on the same footing; the result is mapped back afterwards.
    """
    picked = _select(matches, indices)
    if len(picked) < 4:
        return None

    source_norm = _normalizer([m.source for m in picked])
    target_norm = _normalizer([m.target for m in picked])
    if source_norm is None or target_norm is None:
        return None

    # Accumulate A^T A directly: 9x9 regardless of how many points there are.
    ata = [0.0] * 81

    for match in picked:
        p = _apply(source_norm, match.source.x, match.source.y)
        q = _apply(target_norm, match.target.x, match.target.y)

        _accumulate(ata, [-p.x, -p.y, -1.0, 0.0, 0.0, 0.0, q.x * p.x, q.x * p.y, q.x])
        _accumulate(ata, [0.0, 0.0, 0.0, -p.x, -p.y, -1.0, q.y * p.x, q.y * p.y, q.y])

    h = smallest_eigenvector(ata, 9)
    normalized: Matrix3 = (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8])

    try:
        denormalized = multiply(invert(target_norm), multiply(normalized, source_norm))
    except ValueError:
        return None

    scale = denormalized[8]
    if not math.isfinite(scale) or abs(scale) < 1e-12:
        return None

    return (
        denormalized[0] / scale, denormalized[1] / scale, denormalized[2] / scale,
        denormalized[3] / scale, denormalized[4] / scale, denormalized[5] / scale,
        denormalized[6] / scale, denormalized[7] / scale, denormalized[8] / scale,
    )


def _accumulate(ata: list[float], row: Sequence[float]) -> None:
    for i in range(9):
        vi = row[i]
        if vi == 0:
            continue
        for j in range(9):
            ata[i * 9 + j] += vi * row[j]


def _normalizer(points: Sequence[Point]) -> Matrix3 | None:
    """Translate to the centroid and scale so the mean distance from it is ``sqrt(2)``."""
    cx = 0.0
    cy = 0.0
    for p in points:
        cx += p.x
        cy += p.y
    cx /= len(points)
    cy /= len(points)

    distance = 0.0
    for p in points:
        distance += hypot(p.x - cx, p.y - cy)
    distance /= len(points)

    # Explicit about NaN: a degenerate point set must fail, not divide.
    if math.isnan(distance) or distance <= 1e-9:
        return None

    s = math.sqrt(2) / distance

    return (s, 0.0, -s * cx, 0.0, s, -s * cy, 0.0, 0.0, 1.0)


def _apply(m: Matrix3, x: float, y: float) -> Point:
    return Point(m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5])


def _select(
    matches: Sequence[Correspondence],
    indices: Sequence[int] | None,
) -> Sequence[Correspondence]:
    return matches if indices is None else [matches[i] for i in indices]
