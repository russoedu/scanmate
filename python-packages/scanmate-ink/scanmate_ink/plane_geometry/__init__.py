"""The transform itself: matrix algebra, linear solves, plausibility."""

from .geometry_model import (
    Matrix3,
    Point,
    PointMatch,
    ScanmateOrientedRect,
    ScanmateRect,
    TransformModel,
    TransformSummary,
)
from .is_plausible_policy import is_plausible
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
from .solve_algorithm import jacobi_eigen, smallest_eigenvector, solve

__all__ = [
    "IDENTITY",
    "Matrix3",
    "Point",
    "PointMatch",
    "ScanmateOrientedRect",
    "ScanmateRect",
    "TransformModel",
    "TransformSummary",
    "apply_point",
    "conjugate_scale",
    "decompose",
    "determinant",
    "invert",
    "is_plausible",
    "jacobi_eigen",
    "map_rect_corners",
    "multiply",
    "normalize",
    "rebase",
    "reprojection_error",
    "scaling",
    "similarity",
    "smallest_eigenvector",
    "solve",
    "translation",
]
