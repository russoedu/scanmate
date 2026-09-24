"""3x3 homogeneous matrix helpers.

THE ONE CONVENTION THAT MATTERS
-------------------------------

Every matrix in this library maps **original coordinates to scanned
coordinates**, never the other way round. That reads backwards the first time:
we are producing an image on the original's canvas, so we walk the output pixel
by pixel and ask "where in the scan does this come from?". Inverse mapping is
what stops the output having holes - forward-splatting a rotated source leaves
gaps between the splats, like spray-painting through a rotated stencil.

Coordinates are continuous, with the centre of pixel ``(i, j)`` at
``(i + 0.5, j + 0.5)``. Sticking to that is what makes :func:`conjugate_scale`
a plain scale conjugation instead of a scale plus a half-pixel fudge.

WHY THERE IS NO NUMPY IN THIS FILE
----------------------------------

Every expression below is written out in the same order as the TypeScript, on
plain Python floats. ``numpy`` would be the obvious tool and is deliberately
not used: it reassociates and vectorises, and floating-point addition is not
associative, so ``a @ b`` and the nine written-out dot products do not have to
agree in the last bit. For the arithmetic here - additions and multiplications
only - a literal transcription IS bit-exact with the TypeScript, and the tests
assert that with ``==``.

The functions that reach for ``math.hypot``, ``math.atan2`` or ``math.cos``
cannot make that claim: measured across 169 argument pairs, Python and V8
disagree by at most ONE unit in the last place on each of those. So
:func:`decompose`, :func:`similarity` and :func:`reprojection_error` are
asserted to within 1 ULP rather than exactly, and the tests say so.
"""

from __future__ import annotations

import math

from .geometry_model import Matrix3, Point, ScanmateRect, TransformModel, TransformSummary

IDENTITY: Matrix3 = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)

_SINGULAR_DETERMINANT = 1e-12


def multiply(a: Matrix3, b: Matrix3) -> Matrix3:
    """``a * b`` - the transform that applies ``b`` first, then ``a``.

    :param a: The second transform to apply.
    :param b: The first transform to apply.
    :returns: Their product.
    """
    return (
        a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
        a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
        a[0] * b[2] + a[1] * b[5] + a[2] * b[8],

        a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
        a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
        a[3] * b[2] + a[4] * b[5] + a[5] * b[8],

        a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
        a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
        a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
    )


def determinant(m: Matrix3) -> float:
    """:param m: The matrix.
    :returns: Its determinant.
    """
    return (
        m[0] * (m[4] * m[8] - m[5] * m[7])
        - m[1] * (m[3] * m[8] - m[5] * m[6])
        + m[2] * (m[3] * m[7] - m[4] * m[6])
    )


def invert(m: Matrix3) -> Matrix3:
    """Invert a matrix.

    :param m: The matrix to invert.
    :returns: Its inverse.
    :raises ValueError: When ``m`` is singular - a transform that collapses the
        page to a line is never a usable answer, so this throws rather than
        returning a sentinel. (:func:`~.solve_algorithm.solve` does the
        opposite, and its docstring says why.)
    """
    det = determinant(m)
    if not math.isfinite(det) or abs(det) < _SINGULAR_DETERMINANT:
        message = "matrix is singular and cannot be inverted"
        raise ValueError(message)

    inv = 1 / det

    return (
        (m[4] * m[8] - m[5] * m[7]) * inv,
        (m[2] * m[7] - m[1] * m[8]) * inv,
        (m[1] * m[5] - m[2] * m[4]) * inv,

        (m[5] * m[6] - m[3] * m[8]) * inv,
        (m[0] * m[8] - m[2] * m[6]) * inv,
        (m[2] * m[3] - m[0] * m[5]) * inv,

        (m[3] * m[7] - m[4] * m[6]) * inv,
        (m[1] * m[6] - m[0] * m[7]) * inv,
        (m[0] * m[4] - m[1] * m[3]) * inv,
    )


def normalize(m: Matrix3) -> Matrix3:
    """Divide through by ``m8`` so two matrices describing the same transform
    compare equal.

    :param m: The matrix.
    :returns: The normalised matrix, or ``m`` unchanged when there is nothing
        to do.
    """
    s = m[8]
    if s in {0, 1}:
        return m

    return (m[0] / s, m[1] / s, m[2] / s, m[3] / s, m[4] / s, m[5] / s, m[6] / s, m[7] / s, 1.0)


def apply_point(m: Matrix3, x: float, y: float) -> Point:
    """Map one point through a matrix.

    :param m: The transform.
    :param x: The point's x coordinate.
    :param y: The point's y coordinate.
    :returns: The mapped point.
    """
    w = m[6] * x + m[7] * y + m[8]
    iw = 0.0 if w == 0 else 1 / w

    return Point((m[0] * x + m[1] * y + m[2]) * iw, (m[3] * x + m[4] * y + m[5]) * iw)


def translation(tx: float, ty: float) -> Matrix3:
    """:param tx: Shift along x.
    :param ty: Shift along y.
    :returns: The translation matrix.
    """
    return (1.0, 0.0, tx, 0.0, 1.0, ty, 0.0, 0.0, 1.0)


def scaling(sx: float, sy: float | None = None) -> Matrix3:
    """:param sx: Scale along x.
    :param sy: Scale along y; defaults to ``sx``.
    :returns: The scaling matrix.
    """
    if sy is None:
        sy = sx

    return (sx, 0.0, 0.0, 0.0, sy, 0.0, 0.0, 0.0, 1.0)


def similarity(s: float, angle_rad: float, pivot: Point, target: Point) -> Matrix3:
    """Scale ``s`` and rotation ``angle_rad`` about ``pivot``, then land that
    pivot on ``target``.

    This is the shape the coarse stage produces: "the middle of the original's
    printed content is the middle of the scan's printed content, turned by this
    much and this many times bigger".

    :param s: Uniform scale.
    :param angle_rad: Rotation in radians.
    :param pivot: The point rotated about.
    :param target: Where the pivot must land.
    :returns: The similarity matrix.
    """
    c = math.cos(angle_rad) * s
    k = math.sin(angle_rad) * s

    return (
        c, -k, target.x - c * pivot.x + k * pivot.y,
        k, c, target.y - k * pivot.x - c * pivot.y,
        0.0, 0.0, 1.0,
    )


def conjugate_scale(m: Matrix3, k: float) -> Matrix3:
    """Re-express ``m`` in a coordinate frame scaled by ``k``.

    Fitting runs on downscaled copies because matching 3000x4000 images is a
    waste; the matrix that comes back speaks in those small pixels. ``k`` is
    ``working / full``, and the result speaks in full-resolution pixels.

    :param m: The matrix measured in the working frame.
    :param k: ``working / full``.
    :returns: The same transform, in full-resolution pixels.
    """
    return multiply(scaling(1 / k), multiply(m, scaling(k)))


def rebase(m: Matrix3, source_scale: float, target_scale: float) -> Matrix3:
    """Re-express a matrix whose two frames were scaled by different factors.

    The coarse stage measures on two independently shrunk copies - the original
    and the scan rarely have the same pixel count, so they rarely shrink by the
    same factor. Each argument is ``working / full`` for its own side, and the
    result speaks full-resolution pixels on both.

    :param m: The matrix measured in the working frames.
    :param source_scale: ``working / full`` for the source.
    :param target_scale: ``working / full`` for the target.
    :returns: The same transform, in full-resolution pixels.
    """
    return multiply(scaling(1 / target_scale), multiply(m, scaling(source_scale)))


def map_rect_corners(m: Matrix3, rect: ScanmateRect) -> list[Point]:
    """:param m: The transform.
    :param rect: The rectangle.
    :returns: Its four corners mapped through ``m``, clockwise from top-left.
    """
    return [
        apply_point(m, rect.x, rect.y),
        apply_point(m, rect.x + rect.width, rect.y),
        apply_point(m, rect.x + rect.width, rect.y + rect.height),
        apply_point(m, rect.x, rect.y + rect.height),
    ]


def decompose(m: Matrix3, model: TransformModel) -> TransformSummary:
    """Pull a matrix apart into scale, rotation and shear.

    The 2x2 linear part is factored as ``R(theta) * [[sx, k], [0, sy]]``, which
    is the order a scanner actually applies them: the page is stretched on the
    glass, then the whole thing sits at an angle.

    :param m: The matrix.
    :param model: Which family it was fitted as; carried through for reporting.
    :returns: The summary.
    """
    a, b, _, d, e = m[0], m[1], m[2], m[3], m[4]
    scale_x = math.hypot(a, d)
    det = a * e - b * d
    scale_y = 0.0 if scale_x == 0 else det / scale_x
    shear = 0.0 if scale_x == 0 else (a * b + d * e) / scale_x
    origin = apply_point(m, 0, 0)

    return TransformSummary(
        model=model,
        scale_x=scale_x,
        scale_y=scale_y,
        rotation_deg=(math.atan2(d, a) * 180) / math.pi,
        shear_deg=(math.atan2(shear, scale_y or 1) * 180) / math.pi,
        translation=origin,
        perspective=Point(m[6], m[7]),
    )


def reprojection_error(m: Matrix3, source: Point, target: Point) -> float:
    """:param m: The transform.
    :param source: A point in source coordinates.
    :param target: Where it is observed in target coordinates.
    :returns: Euclidean distance between ``m * source`` and ``target``, in
        target pixels.
    """
    p = apply_point(m, source.x, source.y)

    return math.hypot(p.x - target.x, p.y - target.y)
