"""Where each printed character sits inside a run.

Found in the original's own rendering rather than guessed from font metrics.

A generated PDF renders its glyphs cleanly: between two characters there is a
column of paper - whatever the page puts behind the run, white or the colour of
a total bar - and the only thing that varies is how wide. So the run's box is
read as a column profile - how much ink stands in each column - and the groups
of inked columns are the characters, in order. Nothing here needs to know the
font, its advance widths, or its kerning, all of which a text layer leaves out
and every face does differently.

When the groups do not come to the number of characters expected - glyphs that
touch, a comma that merges with the digit beside it - the run is left alone
rather than guessed at: the caller can only verify what it can place. That is
all-or-nothing over a whole run, which costs more the longer the run is: one
pair of touching letters in a 52-character sentence loses the other fifty.
:func:`glyph_words` splits a run at its spaces first - the widest gaps in the
same profile - so a sentence is verified word by word and only the word that
will not segment is given up.

**Direction.** A run's characters advance along the run, which is not always
left to right: a form's margin instruction is often printed at a right angle to
the page. The profile is taken along whichever axis the run's ``angle`` says,
and quarter turns are the only ones handled - anything between would need the
crop resampled, and is left unverifiable instead of guessed at.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass

from scanmate_ink import GrayImage, ScanmateOrientedRect

#: The least a pixel may stand out from the paper around it and still count as
#: print, 0 to 1. The run's own contrast decides above this.
#:
#: Measured against the run's own background rather than against white, because
#: the paper under a run is whatever the page puts there: white, the grey of a
#: shaded row, or the colour of a total bar.
CONTRAST = 0.19

#: Columns are grown by this, in pixels, before grouping, so a dotted stem
#: stays one glyph.
JOIN = 0

#: JavaScript's whitespace set, which is not Python's - see
#: ``scanmate_ocr.text_similarity`` for the same note. Used for ``trim`` and for
#: splitting a run into words.
_JS_SPACE = "\t\n\v\f\r       　﻿" + "".join(
    chr(c) for c in range(0x2000, 0x200B)
)
_JS_SPACE_RUN = re.compile(f"[{re.escape(_JS_SPACE)}]+")


@dataclass(frozen=True, slots=True)
class CellOptions:
    """How ink is told from paper."""

    #: The least a pixel may stand out from the run's own paper and count as print.
    contrast: float = CONTRAST
    #: Empty columns that still join two groups into one character.
    join: int = JOIN
    #: The run is printed light on a dark bar, so its paper is the dark part.
    light_on_dark: bool = False


@dataclass(frozen=True, slots=True)
class _Group:
    start: int
    end: int


@dataclass(frozen=True, slots=True)
class _Profile:
    inked: list[bool]
    along: str
    reverse: bool
    left: int
    top: int
    right: int
    bottom: int
    s: float


def printed_characters(text: str) -> list[str]:
    """The run's characters with its spaces dropped, by code point."""
    return [c for c in text if c.strip(_JS_SPACE) != ""]


def glyph_cells(
    page: GrayImage,
    dpi: float,
    run: ScanmateOrientedRect,
    count: int,
    options: CellOptions | None = None,
) -> list[ScanmateOrientedRect] | None:
    """The box of each printed character of a run, in reading order.

    :param page: The original page, greyscale, 0 black to 1 white.
    :param dpi: What that page was rendered at.
    :param run: The run's box, in points.
    :param count: How many characters the run prints, spaces excluded.
    :param options: Contrast against the run's paper, column joining, polarity.
    :returns: One box per character, or ``None`` when they cannot be told apart.
    """
    settings = options if options is not None else CellOptions()
    profile = _profile_of(page, dpi, run, count, settings)
    if profile is None:
        return None

    groups = _fit_groups(profile.inked, settings.join, count)

    return None if groups is None else [_box_of(run, profile, g) for g in groups]


def glyph_words(
    page: GrayImage,
    dpi: float,
    run: ScanmateOrientedRect,
    counts: Sequence[int],
    options: CellOptions | None = None,
) -> list[ScanmateOrientedRect] | None:
    """The box of each word of a run, in order, split at the run's own spaces.

    :param page: The original page, greyscale.
    :param dpi: What that page was rendered at.
    :param run: The run's box, in points, with its angle.
    :param counts: Characters in each word, in order, spaces excluded.
    :param options: Contrast against the run's paper, column joining, polarity.
    :returns: One box per word, or ``None`` when the words cannot be told apart.
    """
    settings = options if options is not None else CellOptions()
    total = sum(counts)
    profile = _profile_of(page, dpi, run, total, settings)
    if profile is None:
        return None
    if len(counts) == 1:
        return [
            ScanmateOrientedRect(
                x=run.x, y=run.y, width=run.width, height=run.height, angle=run.angle
            )
        ]

    # The widest gaps are the spaces: as many cuts as the run has spaces.
    groups = _groups_of(profile.inked, settings.join)
    if len(groups) < len(counts):
        return None
    gaps = [
        {"at": index + 1, "gap": group.start - groups[index].end}
        for index, group in enumerate(groups[1:])
    ]
    # Sorted by width, widest first - a stable sort, as `toSorted` is, so ties
    # keep the order the gaps appear in.
    widest = sorted(gaps, key=lambda g: -g["gap"])[: len(counts) - 1]
    cuts = sorted(g["at"] for g in widest)

    words: list[ScanmateOrientedRect] = []
    start = 0
    for cut in [*cuts, len(groups)]:
        if start >= len(groups) or cut - 1 < 0 or cut - 1 >= len(groups):
            return None
        first = groups[start]
        last = groups[cut - 1]
        # A word holding fewer groups than it has characters has glyphs that
        # run together, and nothing inside it can be placed - but that is that
        # word's problem. Its box is still returned, and it is the caller who
        # finds the letters unplaceable, one word at a time.
        words.append(_box_of(run, profile, _Group(start=first.start, end=last.end)))
        start = cut

    return words


def place_glyphs(
    page: GrayImage,
    dpi: float,
    run: ScanmateOrientedRect,
    text: str,
    options: CellOptions | None = None,
) -> list[ScanmateOrientedRect | None] | None:
    """Where every character of a run sits, or ``None`` where it could not be placed.

    The whole run is tried first, which is what a figure wants: short, its
    glyphs separate, and nothing gained by taking it apart. When that fails the
    run is split at its spaces and each word placed on its own, so one pair of
    touching letters costs its own word rather than the sentence around it - on
    the W-9's certification line, two characters rather than fifty-two.

    :param page: The original page, greyscale.
    :param dpi: What that page was rendered at.
    :param run: The run's box, in points, with its angle.
    :param text: What the run prints; spaces divide the words.
    :param options: Contrast against the run's paper, column joining, polarity.
    :returns: One entry per printed character, spaces excluded, or ``None`` when
        not even the words could be told apart.
    """
    settings = options if options is not None else CellOptions()
    characters = printed_characters(text)
    whole = glyph_cells(page, dpi, run, len(characters), settings)
    if whole is not None:
        return list(whole)

    words = [w for w in _JS_SPACE_RUN.split(text) if w != ""]
    if len(words) < 2:
        return None
    boxes = glyph_words(page, dpi, run, [len(list(w)) for w in words], settings)
    if boxes is None:
        return None

    cells: list[ScanmateOrientedRect | None] = []
    for index, word in enumerate(words):
        letters = len(list(word))
        box = boxes[index]
        placed = glyph_cells(
            page,
            dpi,
            ScanmateOrientedRect(
                x=box.x, y=box.y, width=box.width, height=box.height, angle=run.angle
            ),
            letters,
            settings,
        )
        for letter in range(letters):
            cells.append(None if placed is None else placed[letter])

    return cells if len(cells) == len(characters) else None


def _profile_of(
    page: GrayImage,
    dpi: float,
    run: ScanmateOrientedRect,
    count: int,
    options: CellOptions,
) -> _Profile | None:
    """How much ink stands in each step along the run, in the run's own direction."""
    if count <= 0:
        return None

    angle = run.angle if run.angle is not None else 0
    normalised = ((angle % 360) + 360) % 360
    turn = round(normalised / 90) % 4
    if abs(normalised - turn * 90) > 1:
        return None
    along = "x" if turn % 2 == 0 else "y"
    # A quarter turn one way advances up the page, the other way down.
    reverse = turn in (2, 3)

    s = dpi / 72
    left = max(0, math.floor(run.x * s))
    right = min(page.width, math.ceil((run.x + run.width) * s))
    top = max(0, math.floor(run.y * s))
    bottom = min(page.height, math.ceil((run.y + run.height) * s))
    steps = (right - left) if along == "x" else (bottom - top)
    across = (bottom - top) if along == "x" else (right - left)
    if steps < count or across < 2:
        return None

    # The paper this run is printed on: most of its box is background. How far
    # the glyphs stand from it is the run's own contrast, and half of that
    # separates ink from paper - on white or on a total bar alike.
    window = page.pixels[top:bottom, left:right]
    values = sorted(window.reshape(-1).tolist())
    paper = values[len(values) // 2]
    darkest = values[math.floor(len(values) * (0.98 if options.light_on_dark else 0.02))]
    threshold = max(options.contrast, abs(darkest - paper) / 2)

    inked: list[bool] = []
    for step in range(steps):
        dark = 0
        for other in range(across):
            x = left + (step if along == "x" else other)
            y = top + (other if along == "x" else step)
            value = float(page.pixels[y, x])
            difference = (value - paper) if options.light_on_dark else (paper - value)
            if difference > threshold:
                dark += 1
        inked.append(dark > 0)

    return _Profile(
        inked=inked[::-1] if reverse else inked,
        along=along,
        reverse=reverse,
        left=left,
        top=top,
        right=right,
        bottom=bottom,
        s=s,
    )


def _box_of(
    run: ScanmateOrientedRect, profile: _Profile, group: _Group
) -> ScanmateOrientedRect:
    """A span of the profile, back in page points."""
    steps = (
        profile.right - profile.left
        if profile.along == "x"
        else profile.bottom - profile.top
    )
    start = steps - 1 - group.end if profile.reverse else group.start
    end = steps - 1 - group.start if profile.reverse else group.end

    if profile.along == "x":
        return ScanmateOrientedRect(
            x=(profile.left + start) / profile.s,
            y=run.y,
            width=(end - start + 1) / profile.s,
            height=run.height,
            angle=run.angle,
        )

    return ScanmateOrientedRect(
        x=run.x,
        y=(profile.top + start) / profile.s,
        width=run.width,
        height=(end - start + 1) / profile.s,
        angle=run.angle,
    )


def _fit_groups(inked: Sequence[bool], join: int, count: int) -> list[_Group] | None:
    """The groups of inked steps, closed up until there are exactly ``count``."""
    groups = _groups_of(inked, join)
    # Characters printed in two parts - an i, a colon, a percent sign - read as
    # more groups than there are characters; the narrowest gaps close first.
    while len(groups) > count:
        gaps = [
            {"at": i + 1, "gap": group.start - groups[i].end}
            for i, group in enumerate(groups[1:])
        ]
        if len(gaps) == 0:
            break
        narrowest = sorted(gaps, key=lambda g: g["gap"])[0]
        at = int(narrowest["at"])
        groups = [
            *groups[: at - 1],
            _Group(start=groups[at - 1].start, end=groups[at].end),
            *groups[at + 1 :],
        ]

    return groups if len(groups) == count else None


def _groups_of(inked: Sequence[bool], join: int) -> list[_Group]:
    """Runs of inked columns, separated by more than ``join`` empty ones."""
    groups: list[_Group] = []
    start = -1
    last = -1

    for x, dark in enumerate(inked):
        if not dark:
            continue
        if start == -1:
            start = x
        elif x - last - 1 > join:
            groups.append(_Group(start=start, end=last))
            start = x
        last = x
    if start != -1:
        groups.append(_Group(start=start, end=last))

    return groups
