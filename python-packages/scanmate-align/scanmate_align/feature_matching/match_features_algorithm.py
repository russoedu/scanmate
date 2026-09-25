"""Brute-force descriptor matching.

Brute force is the right algorithm here, not a concession. A page yields around
a thousand keypoints per side; a million 256-bit comparisons is eight million
XOR-and-popcount operations, which is milliseconds. Building an index to avoid
that would cost more than it saves and would only return approximate
neighbours.

The filters matter more than the search does:

- **Ratio test.** Keep a match only when the best candidate is clearly better
  than the runner-up. On a page of repeated letterforms the nearest neighbour
  is often meaningless, and the giveaway is that the second nearest is just as
  close.
- **Cross-check.** Both sides must name each other. One-directional bests are
  not symmetric, and the asymmetric ones are usually wrong.
- **Displacement gate.** The images are already roughly aligned when this runs,
  so a correspondence that jumps half the page is not a correspondence.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from scanmate_ink import Point, PointMatch, imul, to_int32

from .detect_features_algorithm import DESCRIPTOR_WORDS, FeatureSet

#: "No candidate yet", as a value an ``Int32Array`` can actually hold.
#:
#: The TypeScript spells out why it is not ``Number.MAX_SAFE_INTEGER``: writing
#: that to an ``Int32Array`` truncates it to -1, and every subsequent "is this
#: closer?" comparison then answers no. Python has no such limit, but the value
#: is kept because it is compared against directly - ``secondDistance[i] !==
#: UNSET`` is a real branch, and a different sentinel would take it at different
#: times.
UNSET = 0x7FFFFFFF


@dataclass(frozen=True, slots=True)
class MatchOptions:
    """What counts as a match."""

    #: Lowe's ratio. Lower is stricter.
    ratio: float = 0.8
    #: Reject matches further apart than this many bits out of 256.
    max_distance: int = 96
    #: Require both descriptors to pick each other.
    cross_check: bool = True
    #: Reject correspondences that move further than this, in pixels.
    #: ``inf`` disables the gate.
    max_displacement: float = math.inf


def match_features(
    source: FeatureSet,
    target: FeatureSet,
    options: MatchOptions | None = None,
) -> list[PointMatch]:
    """Pair each source descriptor with its best target, then filter hard.

    :param source: Features from the original page.
    :param target: Features from the scan.
    :param options: Thresholds; the defaults are the TypeScript's.
    :returns: The surviving correspondences, in source-keypoint order.
    """
    opts = MatchOptions() if options is None else options

    n = len(source.keypoints)
    m = len(target.keypoints)
    if n == 0 or m == 0:
        return []

    best_for_source = [-1] * n
    best_distance = [UNSET] * n
    second_distance = [UNSET] * n
    best_for_target = [-1] * m
    best_target_distance = [UNSET] * m

    gated = math.isfinite(opts.max_displacement)
    gate = opts.max_displacement * opts.max_displacement

    for i in range(n):
        a = source.keypoints[i]
        offset_a = i * DESCRIPTOR_WORDS
        first = UNSET
        second = UNSET
        first_index = -1

        for j in range(m):
            b = target.keypoints[j]
            if gated:
                dx = a.x - b.x
                dy = a.y - b.y
                if dx * dx + dy * dy > gate:
                    continue

            distance = hamming(
                source.descriptors, offset_a, target.descriptors, j * DESCRIPTOR_WORDS
            )

            if distance < first:
                second = first
                first = distance
                first_index = j
            elif distance < second:
                second = distance

            if distance < best_target_distance[j]:
                best_target_distance[j] = distance
                best_for_target[j] = i

        best_for_source[i] = first_index
        best_distance[i] = first
        second_distance[i] = second

    matches: list[PointMatch] = []
    for i in range(n):
        j = best_for_source[i]
        if j < 0:
            continue
        if best_distance[i] > opts.max_distance:
            continue
        if second_distance[i] != UNSET and best_distance[i] > opts.ratio * second_distance[i]:
            continue
        if opts.cross_check and best_for_target[j] != i:
            continue

        a = source.keypoints[i]
        b = target.keypoints[j]
        matches.append(
            PointMatch(
                source=Point(a.x, a.y),
                target=Point(b.x, b.y),
                distance=best_distance[i],
            )
        )

    return matches


def hamming(
    a: NDArray[np.uint32],
    offset_a: int,
    b: NDArray[np.uint32],
    offset_b: int,
) -> int:
    """Hamming distance between two 256-bit descriptors.

    :param a: The first descriptor array.
    :param offset_a: Where the first descriptor starts in it.
    :param b: The second descriptor array.
    :param offset_b: Where the second descriptor starts in it.
    :returns: The number of differing bits, 0 to 256.
    """
    total = 0
    for k in range(DESCRIPTOR_WORDS):
        total += popcount(int(a[offset_a + k]) ^ int(b[offset_b + k]))

    return total


def popcount(value: int) -> int:
    """SWAR bit count: pair off, then nibble off, then one multiply to sum the bytes.

    Transcribed rather than replaced by ``int.bit_count()``, and the reason is
    not style. JavaScript's ``^`` and ``>>`` both coerce to **signed** 32-bit,
    so the value this runs on is an int32 and the shifts are arithmetic - a
    descriptor word with its top bit set arrives here negative. Doing the
    arithmetic in Python's unbounded integers instead would sign-extend
    forever, so :func:`~scanmate_ink.to_int32` is applied at each step exactly
    where JavaScript applies it implicitly.

    :param value: A 32-bit pattern, signed or unsigned; it is coerced the way
        JavaScript would coerce it.
    :returns: The number of set bits in its low 32.
    """
    value = to_int32(value)
    v = to_int32(value - ((value >> 1) & 0x55555555))
    v = to_int32((v & 0x33333333) + ((v >> 2) & 0x33333333))
    v = to_int32((v + (v >> 4)) & 0x0F0F0F0F)

    return int((imul(v, 0x01010101) >> 24) & 0xFF)
