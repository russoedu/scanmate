"""Synthetic pages and simulated scans, measured against the TypeScript.

Exact: every pixel of a small page, and a SHA-256 of the full-sized one. A
default page is 850x1100, which is 3.7 MB of pixels - too much to commit and
far too much to read in a diff - so the hash pins the whole path while the
small page is what a failure can actually be debugged against.

THE TWO THINGS MOST LIKELY TO GO WRONG
---------------------------------------

``draw_line`` stamps ``ceil(hypot(dx, dy)) + 1`` squares, and ``hypot`` is not
correctly rounded in either runtime. A last-bit difference on an exact integer
distance changes the step count by one and shifts every square after it, so the
goldens include a 3/4/5 and a 5/12/13 triangle - lengths of exactly 5 and
exactly 13 - where a value a hair either side of the integer parts company
immediately. :func:`test_line_step_counts_land_on_the_integers_they_should`
checks those distances come out exact before anything is drawn.

The photometric effects read a byte, work in double precision and write back
through a ``Uint8ClampedArray``, which CLAMPS and rounds half to even. Getting
that wrong wraps a dark pixel round to white under the illumination ramp, or a
bright one round to black under the noise - a bug that looks like a completely
different image rather than a slightly wrong one, which is why both effects
have their own case.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pytest

from ..deterministic_sampling import create_random, random_stream
from ..plane_geometry import Point, ScanmateRect
from ..raster_codec import Raster
from .draw_label_algorithm import LabelOptions, draw_label, label_size
from .synthetic_document_algorithm import (
    DocumentOptions,
    ScanOptions,
    create_synthetic_document,
    draw_line,
    draw_signature,
    draw_tick,
    fill_rect,
    simulate_scan,
    stroke_rect,
)

_GOLDEN = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "synthetic-document.json"
    ).read_text(encoding="utf-8"),
)

#: The TypeScript's option names against this port's.
_SCAN_OPTIONS = {
    "rotationDeg": "rotation_deg",
    "scale": "scale",
    "translateX": "translate_x",
    "translateY": "translate_y",
    "noise": "noise",
    "blur": "blur",
    "illumination": "illumination",
    "seed": "seed",
}


def sha(raster: Raster) -> str:
    """The hash the golden pins a large raster by.

    :param raster: The image.
    :returns: Its SHA-256, hex.
    """
    return hashlib.sha256(raster.pixels.tobytes()).hexdigest()


def blank() -> Raster:
    """A small white canvas, the one the drawing goldens were made on.

    :returns: A 40x30 opaque white raster.
    """
    return Raster(np.full((30, 40, 4), 255, dtype=np.uint8))


def as_rect(golden: dict[str, float]) -> tuple[float, float, float, float]:
    """Flatten a golden rectangle.

    :param golden: The golden's rectangle literal.
    :returns: ``(x, y, width, height)``.
    """
    return (golden["x"], golden["y"], golden["width"], golden["height"])


_SMALL = create_synthetic_document(
    DocumentOptions(width=_GOLDEN["small"]["width"], height=_GOLDEN["small"]["height"]),
)


def test_the_small_page_is_bit_exact() -> None:
    """Every pixel, so a failure can be looked at rather than only detected."""
    assert list(_SMALL.raster.pixels.reshape(-1)) == _GOLDEN["small"]["data"]


@pytest.mark.parametrize("name", list(_GOLDEN["small"]["regions"]))
def test_the_regions_are_where_the_typescript_put_them(name: str) -> None:
    """Including the insertion ORDER, which a caller iterating them relies on.

    :param name: The region the golden holds.
    """
    assert as_rect(_GOLDEN["small"]["regions"][name]) == (
        _SMALL.regions[name].x,
        _SMALL.regions[name].y,
        _SMALL.regions[name].width,
        _SMALL.regions[name].height,
    )
    assert list(_SMALL.regions) == list(_GOLDEN["small"]["regions"])


def test_the_full_sized_page_is_bit_exact() -> None:
    """850x1100, pinned by hash rather than by 3.7 MB of pixels.

    The small page exercises the same code with a different layout scale; this
    is what proves the default - the size every caller actually gets - has not
    moved.
    """
    page = create_synthetic_document()

    assert (page.raster.width, page.raster.height) == (
        _GOLDEN["defaultSize"]["width"],
        _GOLDEN["defaultSize"]["height"],
    )
    assert sha(page.raster) == _GOLDEN["defaultSize"]["sha"]

    for name, golden in _GOLDEN["defaultSize"]["regions"].items():
        region = page.regions[name]

        assert (region.x, region.y, region.width, region.height) == as_rect(golden), name


def test_a_different_seed_gives_a_different_page_with_the_same_regions() -> None:
    """The seed drives the text blocks and nothing about the layout.

    Both halves matter: a port that ignored the seed would draw the same page,
    and one that let the seed reach the layout would move the signature box
    between runs of the same form.
    """
    seeded = create_synthetic_document(DocumentOptions(width=170, height=220, seed=99))

    assert sha(seeded.raster) == _GOLDEN["seeded"]["sha"]
    assert sha(seeded.raster) != sha(_SMALL.raster)

    for name, region in seeded.regions.items():
        assert as_rect(_GOLDEN["seeded"]["regions"][name]) == (
            region.x,
            region.y,
            region.width,
            region.height,
        )


def test_a_signature_and_a_tick_draw_where_they_are_told() -> None:
    """Both take a region straight from the page, which is the point of regions."""
    page = create_synthetic_document(DocumentOptions(width=170, height=220))
    draw_signature(page.raster, page.regions["signature"])
    draw_tick(page.raster, page.regions["tick-2"])

    assert sha(page.raster) == _GOLDEN["signed"]["sha"]


def test_fill_rect_is_bit_exact_including_off_page_rectangles() -> None:
    """Three rectangles: one interior, one off the top-left, one off the bottom-right.

    The clipping is ``max(0, ...)`` and ``min(size, ...)`` on already-rounded
    bounds, so a rectangle that starts at -5 paints from 0 and one that runs
    past the edge stops at it. A port that clamped before rounding, or that
    let a negative index wrap, matches on the interior case alone.
    """
    canvas = blank()
    fill_rect(canvas, ScanmateRect(x=3.4, y=2.6, width=10.2, height=8.9), 33)
    fill_rect(canvas, ScanmateRect(x=-5, y=-5, width=12, height=12), 77)
    fill_rect(canvas, ScanmateRect(x=34, y=24, width=20, height=20), 11)

    assert list(canvas.pixels.reshape(-1)) == _GOLDEN["fillRect"]


def test_fill_rect_makes_a_transparent_canvas_opaque() -> None:
    """The alpha channel is WRITTEN, not left alone.

    Every other canvas in these goldens starts fully opaque, so a port that
    filled only the three colour channels matched all of them. This one starts
    fully transparent: after a fill the painted region must be opaque and the
    rest must not be.
    """
    canvas = Raster(np.zeros((30, 40, 4), dtype=np.uint8))
    fill_rect(canvas, ScanmateRect(x=4, y=4, width=10, height=8), 90)

    assert list(canvas.pixels.reshape(-1)) == _GOLDEN["fillRectOverTransparent"]
    assert canvas.pixels[5, 5, 3] == 255
    assert canvas.pixels[0, 0, 3] == 0


def test_the_layout_scale_takes_the_smaller_of_the_two_ratios() -> None:
    """A page that is not the nominal shape, so ``min`` and ``max`` differ.

    Every other page here is proportional to 850x1100, which makes
    ``min(width / 850, height / 1100)`` and ``max`` of the same two the same
    number. On a 300x220 page they are 0.2 and 0.353, and taking the larger
    would run the signature box off the bottom of the page - the exact failure
    the comment in the TypeScript warns about.
    """
    wide = create_synthetic_document(DocumentOptions(width=300, height=220))

    assert sha(wide.raster) == _GOLDEN["wide"]["sha"]

    for name, golden in _GOLDEN["wide"]["regions"].items():
        region = wide.regions[name]

        assert (region.x, region.y, region.width, region.height) == as_rect(golden), name

    signature = wide.regions["signature"]

    assert signature.y + signature.height <= 220


def test_stroke_rect_is_bit_exact() -> None:
    """Four bars, so the corners are painted twice - the TypeScript's own shape."""
    canvas = blank()
    stroke_rect(canvas, ScanmateRect(x=2, y=2, width=20, height=14), 3, 44)

    assert list(canvas.pixels.reshape(-1)) == _GOLDEN["strokeRect"]


@pytest.mark.parametrize("index", range(len(_GOLDEN["drawLine"])))
def test_draw_line_is_bit_exact(index: int) -> None:
    """Five lines, including two of exactly integer length and one of zero.

    :param index: Which golden line.
    """
    case = _GOLDEN["drawLine"][index]
    x0, y0, x1, y1, thickness, value = case["line"]
    canvas = blank()
    draw_line(canvas, x0, y0, x1, y1, thickness, value)

    assert list(canvas.pixels.reshape(-1)) == case["data"]


def test_line_step_counts_land_on_the_integers_they_should() -> None:
    """``hypot`` of a 3/4/5 and a 5/12/13 triangle, to the bit.

    This is upstream of every ``draw_line`` golden: if ``hypot`` returned
    4.999999999999999 for the first, ``ceil`` would give 5 rather than 5 and
    the step count would be right by luck - but 5.000000000000001 gives 6, and
    every square after the first would move. Checked here so a failure names
    the cause rather than showing a shifted image.
    """
    assert math.hypot(3, 4) == 5.0
    assert math.hypot(5, 12) == 13.0

    for case in _GOLDEN["drawLine"]:
        x0, y0, x1, y1 = case["line"][:4]

        assert math.ceil(math.hypot(x1 - x0, y1 - y0)) + 1 == case["steps"]


def test_a_zero_length_line_still_stamps_one_square() -> None:
    """``steps`` is 1, so the loop runs twice over the same point.

    Pinned because ``0 / steps`` would be a division by zero if the ``+ 1``
    were dropped, and the failure would be an exception rather than a wrong
    pixel - easy to "fix" by special-casing and thereby changing the output.
    """
    case = next(c for c in _GOLDEN["drawLine"] if c["line"][:2] == c["line"][2:4])

    assert case["steps"] == 1


@pytest.mark.parametrize("name", list(_GOLDEN["simulateScan"]))
def test_simulate_scan_is_bit_exact(name: str) -> None:
    """Each distortion on its own, then all of them together.

    Separately because they compose in a fixed order - geometry, then blur,
    then illumination, then noise - and a port that reordered them would match
    every single-effect case and fail only ``everything``.

    :param name: The scan the golden holds.
    """
    case = _GOLDEN["simulateScan"][name]
    given = dict(case["options"])
    canvas = given.pop("canvas", None)
    options = ScanOptions(
        **{_SCAN_OPTIONS[key]: value for key, value in given.items()},
        canvas=None if canvas is None else (canvas["width"], canvas["height"]),
    )
    result = simulate_scan(_SMALL.raster, options)

    assert (result.raster.width, result.raster.height) == (case["width"], case["height"])
    assert list(result.matrix) == case["matrix"]
    assert sha(result.raster) == case["sha"]


def test_the_scan_matrix_is_ground_truth_and_not_an_identity() -> None:
    """The whole reason this slice exists.

    A simulated scan is only useful as a test fixture if the matrix it reports
    is the one it actually applied. This does not re-derive it - it asserts the
    reported matrix is the golden's, and that a rotation really does produce a
    non-identity one, so a port returning the identity for everything would
    fail here rather than quietly making every alignment test pass.
    """
    rotated = simulate_scan(_SMALL.raster, ScanOptions(rotation_deg=4.5))
    identity = (1, 0, 0, 0, 1, 0, 0, 0, 1)

    assert rotated.matrix != identity
    assert list(rotated.matrix) == _GOLDEN["simulateScan"]["rotated"]["matrix"]
    assert list(simulate_scan(_SMALL.raster, ScanOptions()).matrix) == list(
        _GOLDEN["simulateScan"]["identity"]["matrix"],
    )


def test_the_noise_stream_is_the_scalar_generator_vectorised() -> None:
    """``simulate_scan`` draws its noise in bulk, and must not diverge for it.

    Three draws per pixel through a Python closure is thirty-six million calls
    on a twelve-megapixel scan, so the stream is generated with numpy. That is
    an optimisation with no licence to differ: mulberry32 advances its state by
    a constant, so the k-th state is computable directly, and every value must
    match the one the scalar generator would have yielded.
    """
    scalar_random = create_random(2024)
    scalar = [scalar_random() for _ in range(5000)]

    assert list(random_stream(2024, 5000)) == scalar


@pytest.mark.parametrize("index", range(len(_GOLDEN["drawLabel"])))
def test_draw_label_is_bit_exact(index: int) -> None:
    """Letters, digits, punctuation, an empty string and characters the font lacks.

    Anything not in the 5x7 table is drawn as a space, deliberately: a caption
    is not worth failing a render over, and a missing-glyph box would be
    noisier than a gap.

    :param index: Which golden label.
    """
    case = _GOLDEN["drawLabel"][index]
    canvas = blank()
    box = draw_label(canvas, case["text"], Point(2, 3))

    assert (box.x, box.y, box.width, box.height) == as_rect(case["box"])
    assert label_size(case["text"]) == (case["size"]["width"], case["size"]["height"])
    assert label_size(case["text"], LabelOptions(scale=4)) == (
        case["sizeAtFour"]["width"],
        case["sizeAtFour"]["height"],
    )
    assert sha(canvas) == case["sha"]


@pytest.mark.parametrize("index", range(len(_GOLDEN["labelScales"])))
def test_the_label_scale_is_rounded_the_way_javascript_rounds(index: int) -> None:
    """2.5 becomes 3, not 2 - and 0 and 0.4 both become 1.

    ``max(1, round(scale))``. Python's built-in ``round`` gives 2 for 2.5,
    which would draw a label two thirds the size the TypeScript draws, at every
    call site that passed a fractional scale.

    :param index: Which golden scale.
    """
    case = _GOLDEN["labelScales"][index]
    canvas = blank()
    box = draw_label(canvas, "AB", Point(1.6, 2.4), LabelOptions(scale=case["scale"]))

    assert (box.x, box.y, box.width, box.height) == as_rect(case["box"])
    assert sha(canvas) == case["sha"]


def test_an_unknown_glyph_is_drawn_as_a_space() -> None:
    """And is drawn at all, rather than clipped off the canvas.

    The long accented label in the goldens above never exercised this: at
    twelve pixels a character it runs past the 40-pixel canvas long before its
    accented characters are reached. These two are short enough to fit, and
    ``~=+`` carries three characters the font has none of.
    """
    for text in ("éx", "~=+"):
        case = next(c for c in _GOLDEN["drawLabel"] if c["text"] == text)
        canvas = blank()
        draw_label(canvas, text, Point(2, 3))

        assert sha(canvas) == case["sha"], text


def test_the_reported_width_measures_the_text_as_given() -> None:
    """Not the uppercased text, which can be longer.

    The sharp s uppercases to two characters in both runtimes, so ``label_size``
    reports one cell while ``draw_label`` draws two. That is the TypeScript's
    behaviour - it measures the original and iterates the uppercased - and it
    is pinned rather than quietly corrected, because a port that "fixed" it
    would disagree with every caller that laid a legend out from the size.
    """
    case = next(c for c in _GOLDEN["drawLabel"] if c["text"] == "ßa")

    assert len("ßa") == 2
    assert len("ßa".upper()) == 3
    assert label_size("ßa") == (case["size"]["width"], case["size"]["height"])
    assert label_size("ßa")[0] == 22


def test_a_coloured_label_writes_all_four_channels() -> None:
    """Including alpha, which a port writing only RGB would leave opaque."""
    canvas = blank()
    draw_label(canvas, "OK", Point(1, 1), LabelOptions(scale=2, color=(10, 200, 30, 128)))

    assert sha(canvas) == _GOLDEN["colouredLabel"]["sha"]
    assert list(canvas.pixels.reshape(-1)) == _GOLDEN["colouredLabel"]["data"]
    assert 128 in set(canvas.pixels[:, :, 3].reshape(-1).tolist())
