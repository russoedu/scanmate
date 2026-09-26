"""Every place a label is printed among one page's text runs."""

from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from scanmate_ink import NormaliseOptions, ScanmateRect, TextRun, normalise_text

from .field_location_contract import AnchorMatch, LocateOptions

#: Most two runs on one line may be apart, in line heights, and still spell one
#: anchor. Further than that they are two columns - a label and the next one
#: across - not two halves of one label.
MAX_WORD_GAP = 4

#: Runs turned further apart than this, in degrees, are never read as one.
_SAME_ANGLE = 1

#: JavaScript's ``\S``, which is the complement of ITS whitespace set. Python's
#: ``\s`` also matches ``\x1c``-``\x1f`` and ``\x85``, which JavaScript does
#: not, and would therefore split a run into different words.
_JS_SPACE = "\t\n\v\f\r       　﻿" + "".join(
    chr(c) for c in range(0x2000, 0x200B)
)
_WORD = re.compile(f"[^{re.escape(_JS_SPACE)}]+")


@dataclass(frozen=True, slots=True)
class _Vector:
    x: float
    y: float


@dataclass(frozen=True, slots=True)
class _Token:
    """One word, as the anchor is matched: normalised, edge punctuation set aside."""

    key: str
    #: Its characters in the run's text.
    start: int
    end: int


@dataclass(frozen=True, slots=True)
class _ReadRun:
    """A run in its own reading frame.

    ``along`` runs down its baseline in reading order and ``down`` goes down the
    page as the text reads. A quarter-turned run reads down or up the page, and
    its next line is beside it rather than below it; in this frame both look as
    they do for upright text.
    """

    run: TextRun
    angle: float
    along: _Vector
    down: _Vector
    u0: float
    u1: float
    v0: float
    v1: float
    tokens: list[_Token]
    #: Where the run's printed characters start and end, past any padding spaces.
    first: int
    last: int


@dataclass(frozen=True, slots=True)
class _Span:
    run: int
    start: int
    end: int


def locate_anchor(
    runs: Sequence[TextRun], anchor: str, options: LocateOptions | None = None
) -> list[AnchorMatch]:
    """Find every place ``anchor`` is printed, top to bottom.

    Runs are joined as they are read: a run may continue into the next run on
    its line, or - for a label that wraps - into the first run of the next line
    that sits under it. Matching is by whole words, compared after the suite's
    normalisation with the punctuation at their edges set aside, so
    ``"Signature"`` finds ``Signature:`` and ``"Date"`` never finds ``Update``.

    :param runs: The page's text runs.
    :param anchor: The label to find, as the document prints it.
    :param options: Normalisation and line tolerances.
    :returns: Every match, in reading order.
    """
    settings = options if options is not None else LocateOptions()
    target = _keys(anchor, settings.normalise)
    if len(target) == 0:
        return []

    read = [_read_run(run, settings.normalise) for run in runs]
    successors: dict[int, list[int]] = {}

    def following(index: int) -> list[int]:
        found = successors.get(index)
        if found is None:
            found = _followers(read, index, settings.line_tolerance, settings.line_spacing)
            successors[index] = found

        return found

    matches: list[AnchorMatch] = []
    for index, run in enumerate(read):
        for start, token in enumerate(run.tokens):
            if token.key != target[0]:
                continue
            spans = _spell(read, following, target, index, start, 0)
            if spans is not None:
                matches.append(_box_of(read, spans))

    return sorted(matches, key=lambda m: (m.box.y, m.box.x))


def _strip_edge_punctuation(word: str) -> str:
    """Drop the Unicode punctuation at both ends, as ``\\p{P}`` does.

    Python's ``re`` has no Unicode property escapes, so the category is asked
    for directly: ``\\p{P}`` is exactly General_Category ``P*``.
    """
    start = 0
    end = len(word)
    while start < end and unicodedata.category(word[start]).startswith("P"):
        start += 1
    while end > start and unicodedata.category(word[end - 1]).startswith("P"):
        end -= 1

    return word[start:end]


def _keys(text: str, normalise: NormaliseOptions | None) -> list[str]:
    """The normalised words of ``text``, as they are compared."""
    words = normalise_text(text, normalise).split(" ")

    return [stripped for word in words if (stripped := _strip_edge_punctuation(word)) != ""]


def _read_run(run: TextRun, normalise: NormaliseOptions | None) -> _ReadRun:
    """Put a run into its own reading frame and tokenise it."""
    angle = run.angle if run.angle is not None else 0
    radians = angle * math.pi / 180
    along = _Vector(x=math.cos(radians), y=math.sin(radians))
    down = _Vector(x=-along.y, y=along.x)
    corners = [
        _Vector(run.x, run.y),
        _Vector(run.x + run.width, run.y),
        _Vector(run.x, run.y + run.height),
        _Vector(run.x + run.width, run.y + run.height),
    ]
    us = [_dot(c, along) for c in corners]
    vs = [_dot(c, down) for c in corners]

    tokens: list[_Token] = []
    for word in _WORD.finditer(run.text):
        end = word.start() + len(word.group(0))
        for key in _keys(word.group(0), normalise):
            tokens.append(_Token(key=key, start=word.start(), end=end))

    return _ReadRun(
        run=run,
        angle=angle,
        along=along,
        down=down,
        u0=min(us),
        u1=max(us),
        v0=min(vs),
        v1=max(vs),
        tokens=tokens,
        first=len(run.text) - len(_js_trim_start(run.text)),
        last=len(_js_trim_end(run.text)),
    )


def _js_trim_start(text: str) -> str:
    """``String.prototype.trimStart``, over JavaScript's whitespace set."""
    return text.lstrip(_JS_SPACE)


def _js_trim_end(text: str) -> str:
    """``String.prototype.trimEnd``, over JavaScript's whitespace set."""
    return text.rstrip(_JS_SPACE)


def _followers(
    read: Sequence[_ReadRun], index: int, tolerance: float, spacing: float
) -> list[int]:
    """The runs an anchor may continue into from the end of run ``index``.

    The nearest run after it on its line, and the first run of the next line
    that sits under it. At most one of each, so no run is ever skipped over.
    """
    source = read[index]
    height = source.v1 - source.v0
    same_line: int | None = None
    below: list[int] = []

    for other, to in enumerate(read):
        if other == index or len(to.tokens) == 0 or not _parallel(source.angle, to.angle):
            continue
        drop = to.v0 - source.v0
        gap = to.u0 - source.u1
        if abs(drop) <= tolerance:
            if (
                gap >= -tolerance
                and gap <= MAX_WORD_GAP * height
                and (same_line is None or to.u0 < read[same_line].u0)
            ):
                same_line = other
        elif (
            drop > tolerance
            and drop <= spacing * height
            and to.u0 <= source.u1
            and to.u1 >= source.u0
        ):
            below.append(other)

    found = [] if same_line is None else [same_line]
    if len(below) > 0:
        # The next line is the nearest one down; on it, the run that starts first.
        line = min(read[b].v0 for b in below)
        on_line = [b for b in below if read[b].v0 - line <= tolerance]
        first = on_line[0]
        for candidate in on_line[1:]:
            if read[candidate].u0 < read[first].u0:
                first = candidate
        found.append(first)

    return found


def _spell(
    read: Sequence[_ReadRun],
    following: Callable[[int], list[int]],
    target: Sequence[str],
    index: int,
    start: int,
    matched: int,
) -> list[_Span] | None:
    """The runs and words spelling ``target``, or ``None`` if they do not."""
    tokens = read[index].tokens
    at = start
    count = matched
    while at < len(tokens) and count < len(target):
        if tokens[at].key != target[count]:
            return None
        at += 1
        count += 1

    span = _Span(run=index, start=start, end=at - 1)
    if count == len(target):
        return [span]

    # The run ran out first: the anchor carries on into whatever follows it.
    for follower in following(index):
        rest = _spell(read, following, target, follower, 0, count)
        if rest is not None:
            return [span, *rest]

    return None


def _box_of(read: Sequence[_ReadRun], spans: Sequence[_Span]) -> AnchorMatch:
    """The box around the words spelt, and whether any edge of it was estimated."""
    estimated = False
    boxes: list[ScanmateRect] = []
    for span in spans:
        r = read[span.run]
        start = r.tokens[span.start].start
        end = r.tokens[span.end].end
        if start <= r.first and end >= r.last:
            boxes.append(
                ScanmateRect(x=r.run.x, y=r.run.y, width=r.run.width, height=r.run.height)
            )
            continue
        estimated = True
        boxes.append(_part(r, start, end))

    return AnchorMatch(box=_union(boxes), estimated=estimated)


def _part(r: _ReadRun, start: int, end: int) -> ScanmateRect:
    """Characters ``start..end`` of a run, placed in proportion to their count.

    A run's words are not measured one by one, so where an anchor starts or
    ends inside a run, that edge is placed in proportion to its characters -
    close, but only exact where the anchor starts and ends with the runs.
    """
    length = len(r.run.text)
    u0 = r.u0 + (r.u1 - r.u0) * start / length
    u1 = r.u0 + (r.u1 - r.u0) * end / length
    corners = [
        _Vector(x=r.along.x * u + r.down.x * v, y=r.along.y * u + r.down.y * v)
        for u, v in ((u0, r.v0), (u1, r.v0), (u0, r.v1), (u1, r.v1))
    ]

    return _bounds(corners)


def _bounds(points: Sequence[_Vector]) -> ScanmateRect:
    """The smallest upright box holding every point."""
    xs = [p.x for p in points]
    ys = [p.y for p in points]
    left = min(xs)
    top = min(ys)

    return ScanmateRect(x=left, y=top, width=max(xs) - left, height=max(ys) - top)


def _union(boxes: Sequence[ScanmateRect]) -> ScanmateRect:
    """The smallest box holding every box."""
    points: list[_Vector] = []
    for b in boxes:
        points.append(_Vector(x=b.x, y=b.y))
        points.append(_Vector(x=b.x + b.width, y=b.y + b.height))

    return _bounds(points)


def _parallel(a: float, b: float) -> bool:
    """Whether two runs are turned closely enough to be read as one.

    The ``+ 540`` is what makes this agree across the two languages:
    JavaScript's ``%`` keeps the sign of its left operand and Python's does
    not, but the shift pushes both onto the same positive value before the
    second modulo, so every input lands identically.
    """
    return abs((((a - b) % 360) + 540) % 360 - 180) <= _SAME_ANGLE


def _dot(p: _Vector, axis: _Vector) -> float:
    """The component of ``p`` along ``axis``."""
    return p.x * axis.x + p.y * axis.y
