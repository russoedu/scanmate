"""Whether a fitted matrix is a page-to-page transform or numerical debris."""

from __future__ import annotations

import math

from .geometry_model import Matrix3

_SINGULAR_DETERMINANT = 1e-9
_DEFAULT_MAX_SCALE_RATIO = 8


def is_plausible(m: Matrix3, max_scale_ratio: float = _DEFAULT_MAX_SCALE_RATIO) -> bool:
    """True when ``m`` is a plausible page-to-page transform.

    RANSAC on a minimal sample of near-collinear points loves to return a
    matrix that folds the page in half. Cheaper to reject it here than to
    discover it in the output.

    :param m: The candidate transform.
    :param max_scale_ratio: How far either axis may scale before the fit is
        rejected, in each direction.
    :returns: Whether the matrix is worth keeping.
    """
    if any(not math.isfinite(v) for v in m):
        return False

    a, b, d, e = m[0], m[1], m[3], m[4]
    det = a * e - b * d
    if abs(det) <= _SINGULAR_DETERMINANT:
        return False
    # A mirrored page is never a scan of the same page.
    if det < 0:
        return False

    sx = math.hypot(a, d)
    if sx < 1 / max_scale_ratio or sx > max_scale_ratio:
        return False

    sy = math.hypot(b, e)

    return not (sy < 1 / max_scale_ratio or sy > max_scale_ratio)
