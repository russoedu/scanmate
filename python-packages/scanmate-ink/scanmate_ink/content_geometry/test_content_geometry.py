"""Content geometry, measured against the TypeScript.

Exact, and that is a measured result rather than a safe assumption. This is the
one slice where a one-ULP disagreement would NOT stay small: both functions
project ink with ``floor(x * cos + y * sin)``, so a last-bit difference in
``cos`` moves a whole pixel's ink into the next bucket, and
:func:`estimate_skew` then takes an argmax over the scores that produces.
Nothing about that failure would be gradual.

``cos`` and ``sin`` are not correctly rounded, and this package has already
found one angle where V8 and Python disagree - ``sin(pi / 4)``, in
``frequency_analysis``. So the agreement here is checked angle by angle rather
than inferred from the answers:
:func:`test_every_angle_the_search_visits_agrees_with_v8` walks all 47 angles
the two-stage search reaches. If a future platform's libm differs, that test
names the angle instead of leaving a skew estimate looking inexplicably wrong.

The input is a page with a REAL skew - stripes of ink at a known slope - rather
than the noise page the other goldens use. An argmax over near-ties would
measure luck; a clear peak measures the port.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from ..deterministic_sampling import create_random
from ..ink_separation import ink_map, to_grayscale
from ..raster_codec import GrayImage, Raster, create_gray, create_raster
from .content_extent_algorithm import ContentExtent, content_extent
from .estimate_skew_algorithm import SkewOptions, estimate_skew, profile_sharpness

_PARITY = Path(__file__).parents[4] / "tools" / "parity"
_GOLDEN = json.loads((_PARITY / "goldens" / "content-geometry.json").read_text(encoding="utf-8"))
_INK = json.loads((_PARITY / "goldens" / "ink-separation.json").read_text(encoding="utf-8"))

_WIDTH = _INK["width"]
_HEIGHT = _INK["height"]
_RGBA = 4
_BYTE_STATES = 256
_TO_RAD = math.pi / 180


def build_page() -> Raster:
    """Rebuild the page ``tools/parity`` fed to the TypeScript.

    :returns: The raster, byte for byte.
    """
    page = create_raster(_WIDTH, _HEIGHT)
    random = create_random(_INK["seed"])
    every = _INK["alphaEvery"]

    flat = page.pixels.reshape(-1)
    for offset in range(0, flat.size, _RGBA):
        flat[offset] = math.floor(random() * _BYTE_STATES)
        flat[offset + 1] = math.floor(random() * _BYTE_STATES)
        flat[offset + 2] = math.floor(random() * _BYTE_STATES)
        flat[offset + 3] = 128 if offset % every == 0 else 255

    return page


def build_striped() -> GrayImage:
    """Rebuild the skewed stripe page from its slope and period.

    Built from the rule rather than read from the golden's pixel dump, so a
    port that got the rule wrong is caught here and not by every later
    assertion at once. The dump is then checked against it.

    :returns: The striped ink map.
    """
    slope = _GOLDEN["stripe"]["slope"]
    period = _GOLDEN["stripe"]["period"]
    image = create_gray(_WIDTH, _HEIGHT)
    for y in range(_HEIGHT):
        for x in range(_WIDTH):
            band = math.floor((y - slope * x) / period)
            image.pixels[y, x] = 0.85 if band % 3 == 0 else 0

    return image


_INK_MAP = ink_map(to_grayscale(build_page()))
_STRIPED = build_striped()
_ANGLES = _GOLDEN["angles"]
_BLANK = create_gray(_WIDTH, _HEIGHT)
_IMAGES = {"skewed": _STRIPED, "ink": _INK_MAP, "blank": _BLANK}


def test_the_striped_page_matches_the_one_the_typescript_measured() -> None:
    """Rebuilt from the rule, checked against the golden's own pixels."""
    expected = np.asarray(_GOLDEN["stripe"]["data"], dtype=np.float64).astype(np.float32)

    assert np.array_equal(_STRIPED.pixels.reshape(-1), expected)


def test_every_angle_the_search_visits_agrees_with_v8() -> None:
    """The diagnostic behind every exact assertion in this file.

    ``cos`` and ``sin`` call the platform's libm and are not correctly rounded.
    All 47 angles agree here. If one ever stops agreeing, this fails and names
    the angle - which is the difference between a five-minute fix and a day
    spent doubting the projection code.

    The angles themselves are checked too: ``deg * (pi / 180)`` has to produce
    the same double, or the cosine of it was never the right question.
    """
    for degrees, radians, cosine, sine in _ANGLES:
        assert degrees * _TO_RAD == radians
        assert math.cos(radians) == cosine, degrees
        assert math.sin(radians) == sine, degrees


@pytest.mark.parametrize("which", ["skewed", "ink"])
def test_profile_sharpness_is_bit_exact_at_every_visited_angle(which: str) -> None:
    """All 47 angles, on both images - 94 scores, every one exact.

    Scored at every angle rather than only at the winner, because the argmax
    hides everything it does not pick: a port that scored 46 of the 47 wrongly
    and still happened to rank the same one first would pass a test on
    :func:`estimate_skew` alone.

    :param which: The image the golden keys its scores under.
    """
    image = _IMAGES[which]
    expected = _GOLDEN["sharpness"][which]
    scored = [profile_sharpness(image, radians) for _, radians, _, _ in _ANGLES]

    assert scored == expected


@pytest.mark.parametrize(
    ("key", "which", "options"),
    [
        ("skewed", "skewed", None),
        ("ink", "ink", None),
        ("narrowRange", "skewed", SkewOptions(max_angle_deg=2)),
        ("blank", "blank", None),
    ],
)
def test_estimate_skew_is_bit_exact(key: str, which: str, options: SkewOptions | None) -> None:
    """The full two-stage search, including a range too narrow to hold the answer.

    ``narrowRange`` caps the search at 2 degrees on a page skewed by about 6,
    so the answer is the edge of the range rather than the true skew. A port
    that clamped, or that searched wider than it was told to, differs there and
    nowhere else.

    :param key: The angle the golden holds.
    :param which: The image to search.
    :param options: The options that search was given.
    """
    assert estimate_skew(_IMAGES[which], options) == _GOLDEN["estimateSkew"][key]


def test_the_search_finds_the_stripes_it_was_given() -> None:
    """Sanity, separate from parity: the answer is near the real slope.

    The goldens would match just as happily if both implementations were
    wrong in the same way. The stripes are laid at ``atan(0.1)``, 5.71 degrees,
    and the search reports 6.04 - within the 0.04-degree resolution of its
    final sweep of a banded pattern whose edges are not a single clean line.
    """
    degrees = _GOLDEN["estimateSkew"]["skewedDeg"]

    assert degrees == pytest.approx(math.degrees(math.atan(0.1)), abs=0.4)
    assert estimate_skew(_STRIPED) == pytest.approx(degrees * _TO_RAD)


def test_a_tie_keeps_the_first_angle_tried() -> None:
    """The only input that can see the argmax's comparison at all.

    A blank page scores exactly zero at every angle, so every angle ties.
    ``score > best_score`` keeps the first and returns -12 degrees; ``>=``
    keeps the last and returns +12. On any page with real ink no two angles
    tie, both rules agree, and the comparison could be flipped unnoticed -
    which is exactly what happened until this case was added.

    -12 is a nonsense skew, and that is fine: a blank page has none, and
    :func:`content_extent` reports density 0 so the caller never uses it.
    """
    scores = {profile_sharpness(_BLANK, degrees * _TO_RAD) for degrees in range(-12, 13)}

    assert scores == {0}
    assert estimate_skew(_BLANK) == _GOLDEN["estimateSkew"]["blank"]
    assert _GOLDEN["estimateSkew"]["blankDeg"] == -12


def test_the_refinement_sweep_visits_the_angles_floating_point_addition_produces() -> None:
    """``deg += 0.2`` from 5.0 reaches 6.000000000000001, not 6.

    ``np.arange`` or ``np.linspace`` would visit 6 exactly, score a different
    angle, and could return it. The goldens carry the accumulated values, so
    this states the property they are pinning.
    """
    walked: list[float] = []
    deg = 6.0 - 1
    while deg <= 6 + 1 + 1e-9:
        walked.append(deg)
        deg += 0.2

    assert 6.000000000000001 in walked
    assert 6 not in walked
    assert [angle for angle, _, _, _ in _ANGLES if angle == 6.000000000000001]


def as_extent(golden: dict[str, Any]) -> tuple[float, ...]:
    """Flatten a golden extent for comparison.

    :param golden: The golden object.
    :returns: Its fields in a fixed order.
    """
    return (
        golden["width"],
        golden["height"],
        golden["center"]["x"],
        golden["center"]["y"],
        golden["angle"],
        golden["density"],
    )


def flatten(extent: ContentExtent) -> tuple[float, ...]:
    """Flatten a measured extent the same way.

    :param extent: The measured extent.
    :returns: Its fields in a fixed order.
    """
    return (
        extent.width,
        extent.height,
        extent.center.x,
        extent.center.y,
        extent.angle,
        extent.density,
    )


@pytest.mark.parametrize(
    ("key", "which", "angle", "trim"),
    [
        ("inkUnrotated", "ink", 0, None),
        ("inkAtSkew", "ink", "estimated", None),
        ("skewedAtSkew", "skewed", "estimated", None),
        ("skewedNoTrim", "skewed", 0, 0),
        ("skewedBigTrim", "skewed", 0, 0.2),
    ],
)
def test_content_extent_is_bit_exact(
    key: str,
    which: str,
    angle: float | str,
    trim: float | None,
) -> None:
    """Unrotated, at the measured skew, and with the trim turned off and up.

    ``skewedNoTrim`` and ``skewedBigTrim`` are the same image at the same
    angle, and they differ only by the trim - 64x48 against 40x35. Without the
    pair, a port that ignored ``trim`` entirely would match every other case
    here, since the default 0.004 barely moves a full-bleed page.

    :param key: The extent the golden holds.
    :param which: The image to measure.
    :param angle: The angle, or ``"estimated"`` to search for it first.
    :param trim: The trim, or ``None`` for the default.
    """
    image = _IMAGES[which]
    radians = estimate_skew(image) if angle == "estimated" else float(angle)
    measured = (
        content_extent(image, radians) if trim is None else content_extent(image, radians, trim)
    )

    assert flatten(measured) == as_extent(_GOLDEN["contentExtent"][key])


def test_a_blank_page_reports_the_whole_frame() -> None:
    """Nothing printed means no box to measure, and no denominator either.

    Returning an empty extent would hand the caller a zero width to divide the
    scale estimate by. The whole frame is the honest fallback, and a density of
    exactly 0 is how the caller knows to treat it as one.
    """
    measured = content_extent(create_gray(_WIDTH, _HEIGHT))

    assert flatten(measured) == as_extent(_GOLDEN["contentExtent"]["blank"])
    assert measured.density == 0
    assert (measured.width, measured.height) == (_WIDTH, _HEIGHT)


def test_the_trim_is_measured_against_ink_mass_not_pixel_count() -> None:
    """Two pages with the SAME inked pixels trim to different widths.

    Both have 21 inked pixels - one at column 0 and twenty at columns 40 to 59.
    They differ only in how much ink the lone one carries. The cutoff is
    ``total * trim`` over summed ink, so when that pixel holds 1.0 against the
    others' 0.01 it alone exceeds a 20% cutoff and the extent collapses onto it
    (width 1); when every pixel holds 0.01 the same cutoff eats thirteen
    columns' worth from each end instead (width 13).

    A port that counted inked PIXELS rather than summing ink would return the
    same width for both, and would agree with every other golden in this file,
    because the stripe page's ink is uniform.
    """
    heavy = create_gray(_WIDTH, _HEIGHT)
    heavy.pixels[24, 0] = 1.0
    heavy.pixels[24, 40:60] = 0.01

    even = create_gray(_WIDTH, _HEIGHT)
    even.pixels[24, 0] = 0.01
    even.pixels[24, 40:60] = 0.01

    assert int(np.count_nonzero(heavy.pixels)) == int(np.count_nonzero(even.pixels))
    assert content_extent(heavy, 0, 0).width == content_extent(even, 0, 0).width == 60
    assert content_extent(heavy, 0, 0.2).width == 1
    assert content_extent(even, 0, 0.2).width == 13


def test_both_trim_bounds_walk_past_empty_bins() -> None:
    """``accumulated > cutoff``, not ``>=``, on BOTH ends.

    With a trim of zero the cutoff is zero, and ``accumulated >= 0`` is true
    before a single bin has been read - so a ``>=`` on the low end pins it at
    bin 0 however far in the ink actually starts, and a ``>=`` on the high end
    pins it at the last bin. The page below puts every inked pixel between
    columns 40 and 59, so the untrimmed span must be exactly those twenty
    columns rather than the whole 66-bin axis.
    """
    offset = create_gray(_WIDTH, _HEIGHT)
    offset.pixels[24, 40:60] = 0.5
    measured = content_extent(offset, 0, 0)

    assert measured.width == 20
    assert measured.center.x == 50
