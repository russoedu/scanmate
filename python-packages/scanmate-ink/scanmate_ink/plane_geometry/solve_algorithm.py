"""The two dense solvers the estimators need, and nothing more.

Both work on plain Python lists of a fixed, tiny size (n <= 9), so there is no
pivoting strategy worth agonising over and no allocation pressure worth caring
about.

WHY THESE ARE NOT ``numpy.linalg``
----------------------------------

``np.linalg.solve`` and ``np.linalg.eigh`` would be one line each, and both are
the wrong tool here. They call LAPACK, which uses blocked algorithms with a
different operation order and different pivoting - so they would return an
answer that is just as correct and NOT the same answer, in the last few bits,
as the TypeScript. This slice exists to agree with the TypeScript, and a
literal transcription of the same elimination is the only way to do that.

The arithmetic below is additions, multiplications and divisions only, so the
transcription really is bit-exact and the tests assert it with ``==``.
:func:`jacobi_eigen` is the exception, because it reaches for ``math.sqrt`` -
which Python and V8 happen to agree on exactly, measured, so it too is
asserted exactly rather than approximately.
"""

from __future__ import annotations

import math

_PIVOT_FLOOR = 1e-12
_OFF_DIAGONAL_FLOOR = 1e-24
_ROTATION_FLOOR = 1e-18
_DEFAULT_SWEEPS = 60


def solve(a: list[float], b: list[float], n: int) -> list[float] | None:
    """Solve ``A x = b`` by Gaussian elimination with partial pivoting.

    :param a: Row-major ``n * n``. Copied, so the caller's list is untouched -
        the TypeScript documents ``a`` as destroyed and then copies it too.
    :param b: The right-hand side, length ``n``.
    :param n: The system size.
    :returns: The solution, or ``None`` when the system is singular.

    Singularity is a RETURN VALUE rather than an exception on purpose: for the
    affine fit it means the sample points were collinear, which is a real and
    common case rather than an exceptional one. (:func:`~.matrix3_algorithm.invert`
    does the opposite, because a singular matrix there is a broken answer, not
    an expected outcome.)
    """
    m = list(a)
    x = list(b)

    for col in range(n):
        pivot = col
        best = abs(m[col * n + col])
        for row in range(col + 1, n):
            v = abs(m[row * n + col])
            if v > best:
                best = v
                pivot = row
        if best < _PIVOT_FLOOR:
            return None

        if pivot != col:
            for k in range(n):
                m[col * n + k], m[pivot * n + k] = m[pivot * n + k], m[col * n + k]
            x[col], x[pivot] = x[pivot], x[col]

        diag = m[col * n + col]
        for row in range(col + 1, n):
            factor = m[row * n + col] / diag
            if factor == 0:
                continue
            for k in range(col, n):
                m[row * n + k] -= factor * m[col * n + k]
            x[row] -= factor * x[col]

    for row in range(n - 1, -1, -1):
        total = x[row]
        for k in range(row + 1, n):
            total -= m[row * n + k] * x[k]
        x[row] = total / m[row * n + row]

    return x


def jacobi_eigen(
    values_in: list[float],
    n: int,
    max_sweeps: int = _DEFAULT_SWEEPS,
) -> tuple[list[float], list[float]]:
    """Eigen-decompose a symmetric matrix with the cyclic Jacobi method.

    Jacobi is the right tool at this size: it is a dozen lines, it is
    unconditionally stable for symmetric input, and it gives eigenvectors for
    free. The homography fit needs the eigenvector of ``A^T A`` belonging to
    the smallest eigenvalue - the direction the data constrains least, which is
    the null-space direction we are after.

    :param values_in: Row-major, ``n * n``, symmetric. Not modified.
    :param n: The matrix size.
    :param max_sweeps: Cap on cyclic sweeps.
    :returns: ``(values, vectors)``, where ``values[i]`` pairs with column
        ``i`` of ``vectors`` (``vectors[row * n + i]``).
    """
    a = list(values_in)
    v = [0.0] * (n * n)
    for i in range(n):
        v[i * n + i] = 1.0

    for _sweep in range(max_sweeps):
        off = 0.0
        for p in range(n):
            for q in range(p + 1, n):
                off += a[p * n + q] * a[p * n + q]

        if off < _OFF_DIAGONAL_FLOOR:
            break

        for p in range(n):
            for q in range(p + 1, n):
                apq = a[p * n + q]
                if abs(apq) < _ROTATION_FLOOR:
                    continue

                theta = (a[q * n + q] - a[p * n + p]) / (2 * apq)
                # `Math.sign(theta || 1)` in the TypeScript: a zero (or NaN)
                # theta falls back to 1, so the sign is never 0 and the
                # rotation is always well defined.
                signed = theta if theta else 1.0
                t = math.copysign(1.0, signed) / (abs(theta) + math.sqrt(theta * theta + 1))
                c = 1 / math.sqrt(t * t + 1)
                s = t * c

                for k in range(n):
                    akp = a[k * n + p]
                    akq = a[k * n + q]
                    a[k * n + p] = c * akp - s * akq
                    a[k * n + q] = s * akp + c * akq
                for k in range(n):
                    apk = a[p * n + k]
                    aqk = a[q * n + k]
                    a[p * n + k] = c * apk - s * aqk
                    a[q * n + k] = s * apk + c * aqk
                for k in range(n):
                    vkp = v[k * n + p]
                    vkq = v[k * n + q]
                    v[k * n + p] = c * vkp - s * vkq
                    v[k * n + q] = s * vkp + c * vkq

    return [a[i * n + i] for i in range(n)], v


def smallest_eigenvector(values_in: list[float], n: int) -> list[float]:
    """:param values_in: Row-major, ``n * n``, symmetric.
    :param n: The matrix size.
    :returns: The unit eigenvector belonging to the smallest eigenvalue.
    """
    values, vectors = jacobi_eigen(values_in, n)

    best = 0
    for i in range(1, n):
        if values[i] < values[best]:
            best = i

    out = [0.0] * n
    norm = 0.0
    for row in range(n):
        out[row] = vectors[row * n + best]
        norm += out[row] * out[row]
    norm = math.sqrt(norm)
    if norm > 0:
        for row in range(n):
            out[row] /= norm

    return out
