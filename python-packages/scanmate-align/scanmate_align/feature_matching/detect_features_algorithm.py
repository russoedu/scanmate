"""FAST corners with steered BRIEF descriptors - an ORB, written out.

This is the piece OpenCV would normally hand you, and it is here because the
deployment target rules out a native binding. The three parts each answer a
separate question:

- **FAST** answers *where*. A pixel is a corner when a contiguous arc of the 16
  pixels on a circle around it is all clearly brighter, or all clearly darker,
  than it is. On a page that fires on stroke ends, serifs, and the corners of
  rules and boxes - landmarks that survive being rescanned.
- **The intensity centroid** answers *which way up*. The vector from the
  patch's centre to its centre of mass is a direction the ink itself defines,
  so it turns with the page.
- **BRIEF** answers *what it looks like*, as 256 yes/no questions of the form
  "is this pixel darker than that one?", asked at positions rotated by that
  angle. Comparing two of those is one XOR and a bit count, which is why
  brute-force matching thousands of them is affordable.

The descriptor is not scale invariant on its own, hence the pyramid: the same
corner is described at several sizes so a scan at a different dpi still
matches.

WHAT A PORT OF THIS HAS TO GET RIGHT
-------------------------------------

Four things here are JavaScript semantics rather than arithmetic, and each one
changes the answer rather than the last bit of it:

- ``Math.round`` rounds a half **up**; Python's :func:`round` rounds it to
  even. It decides pyramid level sizes, the sampling pattern's integer offsets
  and the rotated pattern, so :func:`~scanmate_ink.js_round` is used at every
  one.
- The FAST score array is a ``Float32Array``. Scores are narrowed to float32
  before the non-maximum suppression compares them, and two scores that differ
  in float64 can tie in float32 - which changes which corner survives.
- ``1 << 31`` is negative in JavaScript, and writing it into a ``Uint32Array``
  reinterprets it. The descriptor's top bit of every word goes through that.
- Ties in the score sort are broken by original order, on both sides. Python's
  ``sorted`` and JavaScript's ``Array.prototype.sort`` are both stable, so this
  holds - but only because the corners are appended in the same order to begin
  with.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from scanmate_ink import (
    GrayImage,
    box_blur,
    create_random,
    gaussian,
    js_round,
    resize_gray,
)

#: 32-bit words per descriptor: 8 words, 256 bits.
DESCRIPTOR_WORDS = 8
_DESCRIPTOR_BITS = DESCRIPTOR_WORDS * 32
#: Rotation bins for the steered pattern. 32 bins is 11.25 degrees, finer than
#: ORB's own 12.
_ANGLE_BINS = 32

#: The Bresenham circle of radius 3, clockwise from the top.
_CIRCLE: tuple[tuple[int, int], ...] = (
    (0, -3), (1, -3), (2, -2), (3, -1), (3, 0), (3, 1), (2, 2), (1, 3),
    (0, 3), (-1, 3), (-2, 2), (-3, 1), (-3, 0), (-3, -1), (-2, -2), (-1, -3),
)
_ARC = 9
_COMPASS_MINIMUM = (_ARC - 1) // 4


@dataclass(frozen=True, slots=True)
class Keypoint:
    """One detected corner, in input-image coordinates."""

    #: Coordinates in the *input* image, pixel centres, regardless of the level
    #: found at.
    x: float
    y: float
    score: float
    #: Dominant ink direction in radians.
    angle: float
    level: int
    #: Pixel size of the patch described, in input pixels.
    size: float


@dataclass(frozen=True, slots=True)
class FeatureSet:
    """Everything one page contributes to matching."""

    keypoints: list[Keypoint]
    #: 8 x 32 bits per keypoint, laid out contiguously.
    descriptors: NDArray[np.uint32]


@dataclass(frozen=True, slots=True)
class FeatureOptions:
    """How hard to look, and at what scales."""

    max_features: int = 1200
    #: Contrast a circle pixel must clear to count, in ``[0, 1]`` ink units.
    fast_threshold: float = 0.08
    #: Pyramid levels, including the original.
    levels: int = 3
    #: Ratio between consecutive levels.
    scale_factor: float = 1.3
    #: Side of the described patch, in pixels of its own level.
    patch_size: int = 31
    #: Cells per axis used to spread keypoints over the page instead of over
    #: its densest paragraph.
    grid_size: int = 8
    seed: int = 0xB81EF


@dataclass(frozen=True, slots=True)
class Corner:
    """A FAST detection at one pyramid level, in that level's pixels."""

    x: int
    y: int
    score: float


def detect_and_describe(
    image: GrayImage,
    options: FeatureOptions | None = None,
) -> FeatureSet:
    """Find corners across a pyramid and describe each one.

    :param image: The page, as ink in ``[0, 1]``.
    :param options: Detector settings; the defaults are the TypeScript's.
    :returns: The keypoints and their descriptors, laid out contiguously.
    """
    opts = FeatureOptions() if options is None else options

    patterns = _steered_patterns(opts.patch_size, opts.seed)
    half_patch = (opts.patch_size - 1) / 2
    border = math.ceil(half_patch * math.sqrt(2)) + 2

    keypoints: list[Keypoint] = []
    descriptor_chunks: list[NDArray[np.uint32]] = []
    per_level = -(-opts.max_features // opts.levels)

    for level in range(opts.levels):
        level_scale = opts.scale_factor**level
        width = js_round(image.width / level_scale)
        height = js_round(image.height / level_scale)
        if width < border * 2 + 8 or height < border * 2 + 8:
            break

        level_image = image if level == 0 else resize_gray(image, width, height)
        # BRIEF compares single pixels, so it is exquisitely sensitive to
        # noise; the smoothing is part of the descriptor, not a preprocessing
        # nicety.
        smoothed = box_blur(level_image, 2)

        found = detect_fast(level_image, opts.fast_threshold, border)
        kept = _distribute(found, width, height, opts.grid_size, per_level)

        for corner in kept:
            angle = orientation(level_image, corner.x, corner.y, half_patch)
            bin_index = _angle_bin(angle)
            descriptor = _describe(smoothed, corner.x, corner.y, patterns[bin_index])
            if descriptor is None:
                continue

            descriptor_chunks.append(descriptor)
            keypoints.append(
                Keypoint(
                    x=(corner.x + 0.5) * level_scale,
                    y=(corner.y + 0.5) * level_scale,
                    score=corner.score,
                    angle=angle,
                    level=level,
                    size=opts.patch_size * level_scale,
                )
            )

    descriptors = (
        np.concatenate(descriptor_chunks)
        if descriptor_chunks
        else np.zeros(0, dtype=np.uint32)
    )

    return FeatureSet(keypoints=keypoints, descriptors=descriptors)


def detect_fast(image: GrayImage, threshold: float, border: int) -> list[Corner]:
    """FAST-9 with a 3x3 non-maximum suppression pass over the corner scores.

    :param image: One pyramid level.
    :param threshold: Contrast a ring pixel must clear.
    :param border: Margin to leave, so the ring and the patch both fit.
    :returns: The surviving corners, in raster order.
    """
    width = image.width
    height = image.height
    data = image.pixels
    # float32, not float64, and that is load-bearing: the suppression below
    # compares these, and two scores that differ in float64 can tie once
    # narrowed - which changes which corner survives.
    scores = np.zeros((height, width), dtype=np.float32)
    ring = [0.0] * 16

    for y in range(border, height - border):
        for x in range(border, width - border):
            center = float(data[y, x])
            high = center + threshold
            low = center - threshold

            # Cheap rejection on the four compass points, which sit 4 apart on
            # the ring. Any run of ARC consecutive pixels must contain at least
            # floor((ARC - 1) / 4) of them, so fewer than that cannot be a
            # corner. For ARC = 9 that bound is 2, not the 3 that the widely
            # quoted FAST-12 version of this test uses - requiring 3 here
            # silently discards real corners, among them the corner of a plain
            # filled rectangle.
            bright = 0
            dark = 0
            for k in (0, 4, 8, 12):
                value = float(data[y + _CIRCLE[k][1], x + _CIRCLE[k][0]])
                if value > high:
                    bright += 1
                elif value < low:
                    dark += 1
            if bright < _COMPASS_MINIMUM and dark < _COMPASS_MINIMUM:
                continue

            for k in range(16):
                ring[k] = float(data[y + _CIRCLE[k][1], x + _CIRCLE[k][0]])
            if not _has_arc(ring, high, low):
                continue

            bright_sum = 0.0
            dark_sum = 0.0
            for k in range(16):
                if ring[k] > high:
                    bright_sum += ring[k] - high
                elif ring[k] < low:
                    dark_sum += low - ring[k]
            scores[y, x] = max(bright_sum, dark_sum)

    corners: list[Corner] = []
    for y in range(border, height - border):
        for x in range(border, width - border):
            score = scores[y, x]
            if score <= 0:
                continue

            is_peak = True
            for dy in (-1, 0, 1):
                if not is_peak:
                    break
                for dx in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    if scores[y + dy, x + dx] > score:
                        is_peak = False
                        break

            if is_peak:
                corners.append(Corner(x=x, y=y, score=float(score)))

    return corners


def _has_arc(ring: list[float], high: float, low: float) -> bool:
    """Nine consecutive ring pixels, wrapping, all above ``high`` or all below ``low``."""
    run_bright = 0
    run_dark = 0

    for k in range(16 + _ARC - 1):
        value = ring[k % 16]
        run_bright = run_bright + 1 if value > high else 0
        run_dark = run_dark + 1 if value < low else 0
        if run_bright >= _ARC or run_dark >= _ARC:
            return True

    return False


def _distribute(
    corners: list[Corner],
    width: int,
    height: int,
    grid_size: int,
    budget: int,
) -> list[Corner]:
    """Keep the strongest corners, but spread over the page.

    Score alone concentrates every keypoint in the densest block of text, and a
    transform fitted to correspondences from one corner of the page
    extrapolates badly to the other three. Filling a grid first, then topping
    up from what is left, buys coverage without throwing away the best corners.
    """
    if len(corners) <= budget:
        return corners

    # Insertion-ordered, matching the JavaScript `Map` this mirrors: the cells
    # are walked in the order their first corner arrived, and that order
    # decides who gets trimmed when the budget is tight.
    cells: dict[int, list[Corner]] = {}
    cell_width = width / grid_size
    cell_height = height / grid_size

    for corner in corners:
        cx = min(grid_size - 1, math.floor(corner.x / cell_width))
        cy = min(grid_size - 1, math.floor(corner.y / cell_height))
        key = cy * grid_size + cx
        cells.setdefault(key, []).append(corner)

    per_cell = max(1, budget // max(1, len(cells)))
    kept: list[Corner] = []
    leftovers: list[Corner] = []

    for bucket in cells.values():
        # Stable, descending. Equal scores keep the order they were detected
        # in, which is raster order - the same tie-break the TypeScript gets
        # from `Array.prototype.sort` being stable since ES2019.
        bucket.sort(key=lambda c: c.score, reverse=True)
        kept.extend(bucket[:per_cell])
        leftovers.extend(bucket[per_cell:])

    if len(kept) < budget:
        leftovers.sort(key=lambda c: c.score, reverse=True)
        kept.extend(leftovers[: budget - len(kept)])

    # With more cells than budget the floor above rounds to one per cell, which
    # can overshoot; the budget is a promise, so trim by score.
    if len(kept) > budget:
        kept.sort(key=lambda c: c.score, reverse=True)

        return kept[:budget]

    return kept


def orientation(image: GrayImage, cx: int, cy: int, radius: float) -> float:
    """Angle from the patch centre to its centre of intensity mass.

    On an ink image the mass is the writing, so the angle turns with the page -
    which is the entire trick that makes a binary descriptor rotation
    invariant.

    :param image: The level the corner was found in.
    :param cx: Corner column.
    :param cy: Corner row.
    :param radius: Half the patch side.
    :returns: The angle in radians, from :func:`math.atan2`.
    """
    width = image.width
    height = image.height
    data = image.pixels
    r = math.floor(radius)
    m10 = 0.0
    m01 = 0.0

    for dy in range(-r, r + 1):
        y = cy + dy
        if y < 0 or y >= height:
            continue
        span = int(np.sqrt(r * r - dy * dy))
        for dx in range(-span, span + 1):
            x = cx + dx
            if x < 0 or x >= width:
                continue
            value = float(data[y, x])
            m10 += dx * value
            m01 += dy * value

    return math.atan2(m01, m10)


def _angle_bin(angle: float) -> int:
    """Which of the 32 rotation bins an angle falls in."""
    # `math.fmod`, not `%`. JavaScript's `%` keeps the sign of the dividend and
    # so does `fmod`; Python's `%` does not, so the `+ two_pi` dance the
    # TypeScript needs would be applied to an already-positive number here and
    # take a different rounding path through the second modulo.
    two_pi = math.pi * 2
    normalized = math.fmod(math.fmod(angle, two_pi) + two_pi, two_pi)

    return int(normalized / two_pi * _ANGLE_BINS) % _ANGLE_BINS


def _describe(
    image: GrayImage,
    cx: int,
    cy: int,
    pattern: NDArray[np.int32],
) -> NDArray[np.uint32] | None:
    """The 256 brightness comparisons, packed into 8 words.

    :returns: The descriptor, or ``None`` when any sampled point falls outside
        the image - a partly described corner is worse than none.
    """
    width = image.width
    height = image.height
    data = image.pixels
    out = np.zeros(DESCRIPTOR_WORDS, dtype=np.uint32)

    for bit in range(_DESCRIPTOR_BITS):
        base = bit * 4
        x1 = cx + int(pattern[base])
        y1 = cy + int(pattern[base + 1])
        x2 = cx + int(pattern[base + 2])
        y2 = cy + int(pattern[base + 3])

        if x1 < 0 or y1 < 0 or x2 < 0 or y2 < 0 or x1 >= width or y1 >= height:
            return None
        if x2 >= width or y2 >= height:
            return None

        if data[y1, x1] < data[y2, x2]:
            # `1 << 31` is NEGATIVE in JavaScript, and writing it into a
            # Uint32Array reinterprets the bits. Masking to 32 bits here is
            # what reproduces that; numpy would raise on the overflow instead.
            out[bit >> 5] |= np.uint32((1 << (bit & 31)) & 0xFFFFFFFF)

    return out


#: One pattern set per ``(patch_size, seed)``, built once.
#:
#: Module-level, exactly as the TypeScript's is - and it has to be, because
#: building it consumes the PRNG. A cache miss where the TypeScript hits would
#: not change the pattern (the generator is re-seeded each time), but it would
#: change how long it takes, and a shared cache is the behaviour being ported.
_PATTERN_CACHE: dict[str, list[NDArray[np.int32]]] = {}


def _steered_patterns(patch_size: int, seed: int) -> list[NDArray[np.int32]]:
    """One integer sampling pattern per rotation bin, built once and cached.

    Rotating 256 point pairs per keypoint would mean a thousand trig calls
    each; quantising the angle instead turns the whole thing into a table
    lookup, at a cost of at most half a bin of angular error.
    """
    key = f"{patch_size}:{seed}"
    cached = _PATTERN_CACHE.get(key)
    if cached is not None:
        return cached

    half = (patch_size - 1) / 2
    sigma = patch_size / 5
    random = create_random(seed)
    base = np.zeros(_DESCRIPTOR_BITS * 4, dtype=np.float64)

    for i in range(_DESCRIPTOR_BITS * 4):
        base[i] = _clamp(js_round(gaussian(random) * sigma), -half, half)

    patterns: list[NDArray[np.int32]] = []
    for bin_index in range(_ANGLE_BINS):
        angle = (bin_index / _ANGLE_BINS) * math.pi * 2
        cos = math.cos(angle)
        sin = math.sin(angle)
        rotated = np.zeros(_DESCRIPTOR_BITS * 4, dtype=np.int32)

        for i in range(0, _DESCRIPTOR_BITS * 4, 2):
            x = base[i]
            y = base[i + 1]
            rotated[i] = js_round(cos * x - sin * y)
            rotated[i + 1] = js_round(sin * x + cos * y)
        patterns.append(rotated)

    _PATTERN_CACHE[key] = patterns

    return patterns


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return minimum if value < minimum else min(value, maximum)
