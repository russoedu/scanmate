"""Synthetic pages, and synthetic scans of them.

Alignment is awkward to test honestly: with two real images you have no ground
truth, only an opinion about whether the output looks right. Generate the page
and then the distortion yourself and you know the exact matrix the estimator is
supposed to recover, so a test can assert a number of pixels instead of a
feeling.

It is exported rather than kept in a test folder because the same trick is how
you smoke-test a deployment: generate, distort, align, check the error is
small, all without shipping sample scans.

THE ONE PLACE A LAST BIT BECOMES A WHOLE SHAPE
-----------------------------------------------

:func:`draw_line` stamps ``ceil(hypot(dx, dy)) + 1`` squares along its length.
``hypot`` is not correctly rounded in either runtime, and ``ceil`` turns a
last-bit difference into a whole extra step - which shifts every square after
it. So the goldens deliberately include lines whose length is an exact integer
(3/4/5 and 5/12/13 triangles), where a value a hair over 5.0 in one runtime and
a hair under in the other would part company immediately.

WHAT A CLAMPED BYTE ARRAY DOES ON A READ-MODIFY-WRITE
-------------------------------------------------------

``data[i] *= factor`` on a ``Uint8ClampedArray`` reads the byte, multiplies in
double precision, then clamps to ``[0, 255]`` and rounds HALF TO EVEN on the
way back in. Both effects below rely on it: the illumination ramp would
otherwise wrap a dark pixel round to white, and the noise would wrap a bright
one round to black. ``np.rint`` after ``np.clip`` is the same operation;
``astype(np.uint8)`` on its own is neither.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from ..deterministic_sampling import create_random, random_stream
from ..geometric_transform import WarpOptions, box_blur_raster, warp_raster
from ..js_semantics import hypot, hypot2, js_round
from ..plane_geometry import Matrix3, ScanmateRect, invert, multiply, scaling, translation
from ..raster_codec import Raster

_NOMINAL_WIDTH = 850
_NOMINAL_HEIGHT = 1100
_BYTE_MAX = 255
_RGB = slice(0, 3)


@dataclass(frozen=True, slots=True)
class DocumentOptions:
    """What kind of page to generate."""

    width: int = _NOMINAL_WIDTH
    height: int = _NOMINAL_HEIGHT
    seed: int = 42
    #: Where a signature would go. Left empty by :func:`create_synthetic_document`.
    signature_box: ScanmateRect | None = None


@dataclass(frozen=True, slots=True)
class SyntheticDocument:
    """A generated page and the rectangles worth inspecting on it."""

    raster: Raster
    #: The signature box, the tick boxes, the stamp area.
    regions: dict[str, ScanmateRect]


@dataclass(frozen=True, slots=True)
class ScanOptions:
    """What the scanner does to the page."""

    rotation_deg: float = 0
    #: Size of the scan relative to the page. 1.5 is roughly 300 dpi against a
    #: 200 dpi render.
    scale: float = 1
    translate_x: float = 0
    translate_y: float = 0
    #: Standard deviation of additive sensor noise, in ``[0, 1]`` units.
    noise: float = 0
    #: Box blur radius, standing in for an out-of-focus or low-quality scan.
    blur: float = 0
    #: Strength of a diagonal lighting ramp, in ``[0, 1]``. 0.3 is a
    #: pronounced shadow.
    illumination: float = 0
    #: Scan canvas. Defaults to the page scaled by ``scale``, so the whole page fits.
    canvas: tuple[int, int] | None = None
    seed: int = 1234


@dataclass(frozen=True, slots=True)
class SimulatedScan:
    """A simulated scan and the transform that produced it."""

    raster: Raster
    #: Ground truth: maps original coordinates to scanned coordinates.
    matrix: Matrix3


def fill_rect(page: Raster, rect: ScanmateRect, value: int) -> None:
    """Paint a grey value over a rectangle, clipped to the page.

    :param page: The image to draw on, modified in place.
    :param rect: The rectangle, in continuous coordinates.
    :param value: The grey level to write to all three colour channels.
    """
    left = max(0, js_round(rect.x))
    top = max(0, js_round(rect.y))
    right = min(page.width, js_round(rect.x + rect.width))
    bottom = min(page.height, js_round(rect.y + rect.height))
    if bottom <= top or right <= left:
        return

    page.pixels[top:bottom, left:right, _RGB] = np.uint8(value)
    page.pixels[top:bottom, left:right, 3] = np.uint8(_BYTE_MAX)


def stroke_rect(page: Raster, rect: ScanmateRect, thickness: float, value: int) -> None:
    """Paint the four edges of a rectangle.

    Drawn as four filled bars rather than as an outline, which is why the
    corners are painted twice - harmless at one grey value, and the
    TypeScript's own shape.

    :param page: The image to draw on, modified in place.
    :param rect: The rectangle.
    :param thickness: Edge thickness in pixels.
    :param value: The grey level.
    """
    x, y, width, height = rect.x, rect.y, rect.width, rect.height
    fill_rect(page, ScanmateRect(x=x, y=y, width=width, height=thickness), value)
    bottom = ScanmateRect(x=x, y=y + height - thickness, width=width, height=thickness)
    fill_rect(page, bottom, value)
    fill_rect(page, ScanmateRect(x=x, y=y, width=thickness, height=height), value)
    far = ScanmateRect(x=x + width - thickness, y=y, width=thickness, height=height)
    fill_rect(page, far, value)


def draw_line(
    page: Raster,
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    thickness: float,
    value: int,
) -> None:
    """Stamp squares along a line.

    The step count is ``ceil(hypot) + 1``; see the module docstring for why
    that is the most fragile arithmetic in this slice.

    :param page: The image to draw on, modified in place.
    :param x0: Start x.
    :param y0: Start y.
    :param x1: End x.
    :param y1: End y.
    :param thickness: Square size.
    :param value: The grey level.
    """
    steps = math.ceil(hypot(x1 - x0, y1 - y0)) + 1
    half = thickness / 2

    for i in range(steps + 1):
        t = i / steps
        fill_rect(
            page,
            ScanmateRect(
                x=x0 + (x1 - x0) * t - half,
                y=y0 + (y1 - y0) * t - half,
                width=thickness,
                height=thickness,
            ),
            value,
        )


def _draw_text_line(
    page: Raster,
    x0: float,
    y: float,
    x1: float,
    height: float,
    random: Callable[[], float],
) -> None:
    """One line of "text": dark blocks of word-ish widths with gaps between them.

    :param page: The image to draw on, modified in place.
    :param x0: Left edge.
    :param y: Top of the line.
    :param x1: Right edge.
    :param height: Line height.
    :param random: The page's generator, drawn from in place.
    """
    unit = height / 9
    x = x0
    while x < x1 - 12 * unit:
        word = (14 + math.floor(random() * 46)) * unit
        end = min(x1, x + word)
        fill_rect(
            page,
            ScanmateRect(x=x, y=y, width=end - x, height=height),
            35 + math.floor(random() * 40),
        )
        x = end + (6 + math.floor(random() * 6)) * unit


def create_synthetic_document(options: DocumentOptions | None = None) -> SyntheticDocument:
    """A plausible printed form, deterministic for a given seed.

    Header rule, paragraphs, a table, tick boxes, a signature box.

    :param options: Size, seed and an optional signature box.
    :returns: The page and its regions.
    """
    settings = options or DocumentOptions()
    width, height = settings.width, settings.height
    random = create_random(settings.seed)
    page = Raster(np.full((height, width, 4), _BYTE_MAX, dtype=np.uint8))

    # The layout is written once against a nominal 850x1100 page and scaled to
    # whatever was asked for. Laying it out in absolute pixels instead means a
    # smaller page silently loses its last few elements off the bottom edge -
    # including, on a form, the signature box.
    scale = min(width / _NOMINAL_WIDTH, height / _NOMINAL_HEIGHT)

    def unit(value: float) -> float:
        return value * scale

    margin = js_round(unit(76))
    right = width - margin
    line_height = max(4, unit(21))
    text_height = max(2, js_round(unit(9)))
    y: float = margin

    heading = ScanmateRect(
        x=margin,
        y=y,
        width=js_round((right - margin) * 0.44),
        height=max(3, unit(26)),
    )
    fill_rect(page, heading, 20)
    y += unit(54)

    draw_line(page, margin, y, right, y, max(1, unit(3)), 40)
    y += unit(34)

    # Fixed line counts rather than random ones, so the page always fits.
    for lines in (3, 4, 5, 6):
        for _line in range(lines):
            _draw_text_line(page, margin, y, right, text_height, random)
            y += line_height
        y += unit(18)

    table_top = y
    rows = 5
    columns = 4
    row_height = max(6, unit(30))
    column_width = (right - margin) / columns
    rule_width = max(1, unit(2))
    for r in range(rows + 1):
        rule_y = table_top + r * row_height
        draw_line(page, margin, rule_y, right, rule_y, rule_width, 60)
    for c in range(columns + 1):
        draw_line(
            page,
            margin + c * column_width,
            table_top,
            margin + c * column_width,
            table_top + rows * row_height,
            rule_width,
            60,
        )

    for r in range(rows):
        for c in range(columns):
            _draw_text_line(
                page,
                margin + c * column_width + unit(8),
                table_top + r * row_height + row_height * 0.36,
                margin + (c + 1) * column_width - unit(8),
                text_height,
                random,
            )

    y = table_top + rows * row_height + unit(46)

    regions: dict[str, ScanmateRect] = {}
    box_size = max(6, js_round(unit(18)))
    for i in range(3):
        box = ScanmateRect(x=margin + i * unit(150), y=y, width=box_size, height=box_size)
        stroke_rect(page, box, max(1, unit(2)), 30)
        regions[f"tick-{i + 1}"] = box
    y += unit(70)

    signature = settings.signature_box or ScanmateRect(
        x=margin,
        y=y,
        width=js_round((right - margin) * 0.55),
        height=max(12, js_round(unit(78))),
    )
    stroke_rect(page, signature, max(1, unit(2)), 30)
    regions["signature"] = signature

    regions["stamp"] = ScanmateRect(
        x=right - js_round(unit(150)),
        y=y,
        width=js_round(unit(150)),
        height=signature.height,
    )

    return SyntheticDocument(raster=page, regions=regions)


def draw_signature(page: Raster, box: ScanmateRect, seed: int = 7) -> None:
    """Scribble inside a rectangle, the way a signature crosses a signature box.

    :param page: The image to draw on, modified in place.
    :param box: Where the signature goes.
    :param seed: Which scribble.
    """
    random = create_random(seed)
    points = 9
    baseline = box.y + box.height * 0.62
    previous_x = box.x + box.width * 0.06
    previous_y = baseline

    for i in range(1, points + 1):
        x = box.x + box.width * (0.06 + (0.86 * i) / points)
        y = baseline - box.height * (0.05 + random() * 0.42) * (1 if i % 2 == 0 else -0.45)
        draw_line(page, previous_x, previous_y, x, y, 3, 25)
        previous_x = x
        previous_y = y


def draw_tick(page: Raster, box: ScanmateRect) -> None:
    """Fill a tick box, the way a pen does.

    :param page: The image to draw on, modified in place.
    :param box: The tick box.
    """
    x, y, width, height = box.x, box.y, box.width, box.height
    draw_line(page, x + width * 0.15, y + height * 0.5, x + width * 0.42, y + height * 0.82, 3, 20)
    draw_line(page, x + width * 0.42, y + height * 0.82, x + width * 0.88, y + height * 0.12, 3, 20)


def _store_clamped(
    pixels: npt.NDArray[np.uint8],
    values: npt.NDArray[np.float64],
) -> npt.NDArray[np.uint8]:
    """Write doubles back into bytes the way a ``Uint8ClampedArray`` does.

    Clamp to ``[0, 255]``, then round HALF TO EVEN. See the module docstring.

    :param pixels: The destination, for its shape only.
    :param values: The computed values.
    :returns: The bytes to store.
    """
    del pixels

    return np.rint(np.clip(values, 0, _BYTE_MAX)).astype(np.uint8)


def _apply_illumination(raster: Raster, strength: float) -> None:
    """A diagonal ramp plus a soft corner shadow.

    The two things a phone camera always adds. Applied to the colour channels
    only - dimming the alpha would make the page translucent rather than dark.

    :param raster: The scan, modified in place.
    :param strength: How pronounced, in ``[0, 1]``.
    """
    height, width = raster.height, raster.width
    u = (np.arange(width, dtype=np.float64) / width)[None, :]
    v = (np.arange(height, dtype=np.float64) / height)[:, None]

    ramp = 1 - strength * (0.35 * u + 0.65 * v)
    corner = 1 - strength * 0.8 * np.maximum(0, 1 - hypot2(u, v) * 1.3)
    factor = (ramp * corner)[:, :, None]

    colours = raster.pixels[:, :, _RGB].astype(np.float64) * factor
    raster.pixels[:, :, _RGB] = _store_clamped(raster.pixels[:, :, _RGB], colours)


def _apply_noise(raster: Raster, sigma: float, seed: int) -> None:
    """Additive sensor noise, the same for all three colour channels of a pixel.

    Three uniform draws summed and recentred, which is a cheap triangular-ish
    approximation of a Gaussian - and, more to the point, is what the
    TypeScript does. The draws are consumed three per PIXEL in raster order, so
    the stream is generated in that order too.

    :param raster: The scan, modified in place.
    :param sigma: Standard deviation, in ``[0, 1]`` units.
    :param seed: Which noise.
    """
    height, width = raster.height, raster.width
    amplitude = sigma * _BYTE_MAX
    draws = random_stream(seed, height * width * 3).reshape(height, width, 3)
    noise = (draws[:, :, 0] + draws[:, :, 1] + draws[:, :, 2] - 1.5) * 2 * amplitude

    colours = raster.pixels[:, :, _RGB].astype(np.float64) + noise[:, :, None]
    raster.pixels[:, :, _RGB] = _store_clamped(raster.pixels[:, :, _RGB], colours)


def simulate_scan(page: Raster, options: ScanOptions | None = None) -> SimulatedScan:
    """Put a page through everything a scanner does to it, and report the matrix used.

    Order matters and mirrors the physical one: the page is placed on the glass
    somewhere, at some angle, and sampled at some resolution (the geometry);
    then the lamp falls off towards one corner, the optics blur, and the sensor
    adds noise (the photometry). Estimators that only ever see clean geometric
    distortion pass tests and fail on real scans.

    :param page: The page to scan.
    :param options: What the scanner does.
    :returns: The scan and the ground-truth transform.
    """
    settings = options or ScanOptions()
    scale = settings.scale

    canvas = settings.canvas or (
        max(8, js_round(page.width * scale)),
        max(8, js_round(page.height * scale)),
    )
    canvas_width, canvas_height = canvas

    angle = (settings.rotation_deg * math.pi) / 180
    cos = math.cos(angle)
    sin = math.sin(angle)
    cx = page.width / 2
    cy = page.height / 2

    # Rotate about the page centre, scale, then place that centre in the middle
    # of the scan canvas plus the requested offset.
    rotate_about_centre: Matrix3 = (
        cos, -sin, cx - cos * cx + sin * cy,
        sin, cos, cy - sin * cx - cos * cy,
        0, 0, 1,
    )
    place = translation(
        canvas_width / 2 - cx * scale + settings.translate_x,
        canvas_height / 2 - cy * scale + settings.translate_y,
    )
    forward = multiply(place, multiply(scaling(scale), rotate_about_centre))

    raster = warp_raster(
        page,
        invert(forward),
        canvas_width,
        canvas_height,
        WarpOptions(background=(255, 255, 255, 255), interpolation="bilinear", prefilter=True),
    )

    if settings.blur > 0:
        raster = box_blur_raster(raster, settings.blur)
    if settings.illumination > 0:
        _apply_illumination(raster, settings.illumination)
    if settings.noise > 0:
        _apply_noise(raster, settings.noise, settings.seed)

    return SimulatedScan(raster=raster, matrix=forward)

