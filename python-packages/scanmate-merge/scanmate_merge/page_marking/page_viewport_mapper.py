"""The page as a reader sees it, and the way back to the PDF's own coordinates.

A mark is measured the way ``scanmate-extract`` reports text: from the top-left
of the page as displayed, in points, with the page's ``/Rotate`` and crop box
already applied. A PDF is drawn in its own user space instead: from the
bottom-left of the media box, before any rotation.

Getting from one to the other is the whole difficulty of drawing a mark in the
right place, and doing it approximately would defeat the purpose - a helper for
checking positions that is wrong on rotated or cropped pages gives false
confidence on exactly the pages that most need checking.

So this is pdf.js's own ``PageViewport`` transform at scale 1, ported line for
line rather than re-derived, and inverted. The text a mark was measured from and
the box drawn for it then go through the same arithmetic in opposite directions.
"""

from __future__ import annotations

from dataclasses import dataclass

#: A two-dimensional affine transform, ``(a, b, c, d, e, f)`` as PDF writes them.
Affine = tuple[float, float, float, float, float, float]

#: pdf.js's ``rotateA`` to ``rotateD``, by quarter turn.
_ROTATIONS: dict[int, tuple[int, int, int, int]] = {
    0: (1, 0, 0, -1),
    90: (0, 1, 1, 0),
    180: (-1, 0, 0, 1),
    270: (0, -1, -1, 0),
}


@dataclass(frozen=True, slots=True)
class PageGeometry:
    """The page's visible box, ``(x0, y0, x1, y1)`` in user space, and its rotation."""

    view: tuple[float, float, float, float]
    rotation: float


@dataclass(frozen=True, slots=True)
class Size:
    """How large the page is, in points."""

    width: float
    height: float


@dataclass(frozen=True, slots=True)
class Point:
    """A point, in whichever frame produced it."""

    x: float
    y: float


def _rotation_of(rotation: float) -> tuple[int, int, int, int]:
    """pdf.js's rotation matrix for a page turned by ``rotation`` degrees.

    Only quarter turns are legal in a PDF; anything else is refused exactly as
    pdf.js refuses it, rather than drawn somewhere plausible.

    :param rotation: Degrees, which may be negative or over a full turn.
    :returns: The four matrix entries.
    :raises ValueError: The rotation is not a multiple of 90.
    """
    # The double modulo is the TypeScript's, and it is not redundant there:
    # JavaScript's % keeps the sign of the left operand, so -90 % 360 is -90 and
    # needs the +360 to land on 270. Python's % already returns 270, and the
    # expression is kept anyway so the two read alike and agree on every input.
    normalised = ((rotation % 360) + 360) % 360
    whole = int(normalised)
    matrix = _ROTATIONS.get(whole) if normalised == whole else None
    if matrix is None:
        raise ValueError(
            "a page may only be rotated by a multiple of 90 degrees, "
            f"and is rotated by {_as_js_number(rotation)}"
        )

    return matrix


def viewport_transform(geometry: PageGeometry) -> Affine:
    """User space to what a reader sees - pdf.js's ``PageViewport`` at scale 1.

    :param geometry: The page's visible box and rotation.
    :returns: The transform.
    :raises ValueError: The page is not on a quarter turn.
    """
    view = geometry.view
    center_x = (view[2] + view[0]) / 2
    center_y = (view[3] + view[1]) / 2
    a, b, c, d = _rotation_of(geometry.rotation)

    quarter = a == 0
    offset_x = abs(center_y - view[1]) if quarter else abs(center_x - view[0])
    offset_y = abs(center_x - view[0]) if quarter else abs(center_y - view[1])

    return (
        a,
        b,
        c,
        d,
        offset_x - a * center_x - c * center_y,
        offset_y - b * center_x - d * center_y,
    )


def viewport_size(geometry: PageGeometry) -> Size:
    """How large the page is as a reader sees it: a quarter turn swaps the sides.

    :param geometry: The page's visible box and rotation.
    :returns: The displayed size.
    :raises ValueError: The page is not on a quarter turn.
    """
    a = _rotation_of(geometry.rotation)[0]
    view = geometry.view
    across = view[2] - view[0]
    down = view[3] - view[1]

    return Size(width=down, height=across) if a == 0 else Size(width=across, height=down)


def to_user_space(transform: Affine, x: float, y: float) -> Point:
    """A point a reader sees, back in the PDF's own coordinates.

    :param transform: The transform from :func:`viewport_transform`.
    :param x: Points from the left of the page as displayed.
    :param y: Points from the top of the page as displayed.
    :returns: The point in user space.
    """
    a, b, c, d, e, f = transform
    det = a * d - b * c
    dx = x - e
    dy = y - f

    # `+ 0` turns a negative zero positive: harmless to draw at, noisy to read
    # back - and it is what the TypeScript does, so a golden carrying 0 would
    # not match a port carrying -0.
    return Point(x=(d * dx - c * dy) / det + 0, y=(-b * dx + a * dy) / det + 0)


def _as_js_number(value: float) -> str:
    """Format a number the way JavaScript puts one in a message.

    Only for the rotation error, and only so the two ports produce the same
    sentence: ``45`` rather than ``45.0``.
    """
    return str(int(value)) if value == int(value) else str(value)
