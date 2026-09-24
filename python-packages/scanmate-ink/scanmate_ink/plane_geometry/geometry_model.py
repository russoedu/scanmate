"""Geometry types: the transform itself, and the shapes it moves."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, NamedTuple

#: A row-major 3x3 matrix in homogeneous coordinates::
#:
#:     [ m0 m1 m2 ]
#:     [ m3 m4 m5 ]
#:     [ m6 m7 m8 ]
#:
#: A plain tuple of nine floats, exactly as the TypeScript's readonly tuple -
#: NOT a numpy array. numpy would reorder and vectorise the arithmetic, and the
#: whole point of this slice is that the operation order matches.
Matrix3 = tuple[float, float, float, float, float, float, float, float, float]


class Point(NamedTuple):
    """A point in continuous pixel coordinates."""

    x: float
    y: float


@dataclass(frozen=True, slots=True)
class ScanmateRect:
    """An axis-aligned rectangle in pixel coordinates.

    ``x`` and ``y`` are the top-left corner.
    """

    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True, slots=True)
class ScanmateOrientedRect(ScanmateRect):
    """A rectangle that may be turned.

    Only quarter turns mean anything downstream: a column profile can be read
    along either axis, but anything between would need the crop resampled, and
    the glyph checks leave those unverifiable rather than guess.
    """

    #: Degrees clockwise from left-to-right. ``0`` for ordinary text.
    angle: float = 0.0


#: Which family of transform to fit. Fewer degrees of freedom is more robust;
#: more is more expressive.
#:
#: - ``similarity``: 4 DOF - uniform scale, rotation, translation. A flatbed
#:   scan of a flat page.
#: - ``affine``: 6 DOF - adds non-uniform scale and shear. A scan whose feed
#:   stretched one axis.
#: - ``homography``: 8 DOF - full projective warp. A photograph taken off-axis.
TransformModel = Literal["similarity", "affine", "homography"]


@dataclass(frozen=True, slots=True)
class TransformSummary:
    """The geometric meaning of a fitted matrix, pulled apart into numbers a
    human can sanity-check.
    """

    model: TransformModel
    #: Scale along the scan's x axis. ``1`` means the scan matches the
    #: original's pixel scale.
    scale_x: float
    scale_y: float
    #: Rotation in degrees, counter-clockwise positive in image coordinates.
    rotation_deg: float
    #: Residual shear in degrees. Non-zero only for affine and homography.
    shear_deg: float
    #: Where the original's top-left corner lands in the scan.
    translation: Point
    #: Perspective terms (``m6``, ``m7``). Non-zero only for homography.
    perspective: Point


@dataclass(frozen=True, slots=True)
class PointMatch:
    """One ``(original, scanned)`` correspondence produced by feature matching."""

    source: Point
    target: Point
    #: Hamming distance between the two descriptors. Lower is a better match.
    distance: float
