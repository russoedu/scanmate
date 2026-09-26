"""Whether a printed figure is still the figure that was printed.

Decided by matching its ink rather than by reading it.

OCR asks an open question - what does this say? - and at the resolution of a
returned scan it answers badly: a 0 on a shaded bar at 120 dpi comes back as a
9, and a digit written over another comes back as whatever the language model
prefers. The closed question is far easier: **is this still the glyph the
original printed here, or does it look more like a different one?**

The print is crisp and the scan is not, so each glyph is compared at a
sharpness chosen on the run itself. Each character is matched twice over: once
against the original's own ink at that very place - same face, same size, same
position - and once against every other character the page prints in that face
and size. The printed glyph has to win by a margin to pass, and a rival has to
win by a margin to count as a change; anything in between is left undecided
rather than guessed at.

**Two scopes.** ``"figures"`` checks the digits of a figure against the ten
digits and nothing else. ``"text"`` checks every character against letters and
digits alike, and its two answers are not worth the same: swept over 327 runs of
four real documents, ``"text"`` called four unchanged runs changed where
``"figures"`` has never made a false call. So ``agrees is True`` is good
evidence a run is untouched, and ``agrees is False`` is a reason to look closer
rather than a verdict.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal, TypeAlias

import numpy
from scanmate_ink import GrayImage, ScanmateOrientedRect, TextRun, resize_gray

from .glyph_cells_algorithm import CellOptions, place_glyphs, printed_characters
from .glyph_templates_algorithm import Templates, cut, template_key
from .print_polarity_policy import print_polarity

#: What a figure's characters are checked against: the ten digits, and only those.
FIGURE_CHARACTERS = "0123456789"

#: What a run of text is checked against under ``scope="text"``: letters and
#: digits. Punctuation is left out deliberately - a comma and a full stop differ
#: by a few pixels at these sizes.
TEXT_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

#: How much better the winner must correlate than the runner-up for a cell to be
#: decided either way. Measured on real returned scans: the printed glyph wins
#: by 0.13 or more at 125 dpi, a badly scanned digit loses by 0.03 or less at
#: 90 dpi, and a digit replaced by another was won by its rival by 0.17.
MIN_MARGIN = 0.12
#: A rival has to match this well before it can overturn what the original prints.
MIN_SCORE = 0.5
#: ...and the printed glyph has to match at least this well before the ink can
#: be called unchanged.
MIN_PRINTED_SCORE = 0.7
#: Distinct characters the page must print in this face and size before a run is
#: checked at all.
MIN_RIVALS = 8
MIN_TEXT_RIVALS = 24
#: ...and the printed glyph has to match no better than this: a near-perfect
#: match is not a forgery.
MAX_PRINTED_SCORE = 0.85
#: Each cell is matched at this height, in pixels.
MATCH_HEIGHT = 16
#: The template is slid this far, in match pixels.
SHIFT = 1
#: How far the scan is sharpened, in match pixels.
RECOVERY = (0, 0.5, 1, 1.5, 2)
#: How hard. A verdict has to hold at every one of these, or the cell is left
#: undecided - a reading that moves as the sharpening moves is an artefact.
SHARPENING = (1, 1.5, 2)

#: Why a run was not checked.
PrintAbstention: TypeAlias = Literal[
    "no-figure", "unplaceable", "few-rivals", "too-coarse", "undecided", "no-claim"
]

_DIGIT = re.compile(r"\d")
_SEPARATOR = re.compile(r"[.,\-/\s]")


@dataclass(frozen=True, slots=True)
class VerifyOptions:
    """Margins, scope and the characters a run is matched against."""

    #: How far the winner must correlate ahead of the loser, 0 to 1.
    min_margin: float = MIN_MARGIN
    #: How well a rival must match before a character counts as changed.
    min_score: float = MIN_SCORE
    #: How well the printed glyph must match before the ink counts as unchanged.
    min_printed: float = MIN_PRINTED_SCORE
    #: Characters the page must print in this face and size for the run to be
    #: checked. Defaults to 8, or 24 for ``"text"``.
    min_rivals: int | None = None
    #: ``"figures"``, ``"text"``, or ``"confirm"`` - the one question a
    #: settlement actually asks, which needs :attr:`claimed`.
    scope: Literal["figures", "text", "confirm"] = "figures"
    #: What the reading claims the run says, for ``scope="confirm"``.
    claimed: str | None = None
    #: How badly the printed glyph must match for a character to count as changed.
    max_printed: float = MAX_PRINTED_SCORE
    #: Digits in a row before a group is treated as a figure.
    min_digits: int = 2
    #: The characters a figure's glyphs are matched against.
    characters: str | None = None


@dataclass(frozen=True, slots=True)
class CellVerification:
    """One character of a figure, and how its ink matched."""

    #: Position in the run's printed characters.
    at: int
    #: What the original prints there.
    printed: str
    #: How well the scan's ink matches the original's own ink there.
    printed_score: float
    #: The best any other character managed.
    rival: str
    rival_score: float
    #: What this cell was taken to be, or ``None`` when it was too close to call.
    read: str | None


@dataclass(frozen=True, slots=True)
class PrintCheck:
    """What the ink said, or why it would not say.

    One class rather than the TypeScript's tagged union, for the same reason
    ``scanmate-seal``'s problem is one class: :attr:`verified` is the
    discriminant.
    """

    verified: bool
    #: Set when :attr:`verified` is false.
    because: PrintAbstention | None = None
    #: The run as its ink reads, printed characters kept where nothing was checked.
    reading: str = ""
    #: The ink says what the original printed.
    agrees: bool = False
    #: Cells decided, one way or the other.
    checked: int = 0
    #: The smallest margin any decided cell was decided by.
    confidence: float = 0.0
    #: Every character checked, with the scores behind the verdict.
    cells: list[CellVerification] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class _Recovery:
    """How far and how hard the scan's glyph is sharpened before comparison."""

    sigma: float
    amount: float


@dataclass(frozen=True, slots=True)
class _Judgement:
    read: str | None
    printed_score: float
    rival: str
    rival_score: float


def verify_printed_run(
    original: GrayImage,
    scan: GrayImage,
    dpi: float,
    run: TextRun,
    templates: Templates,
    options: VerifyOptions | None = None,
) -> PrintCheck:
    """Check the figures of one run against the original's print.

    :param original: The original page, greyscale.
    :param scan: The scan, aligned onto the original's canvas, greyscale.
    :param dpi: What the original was rendered at.
    :param run: The run to check, from the original's text layer.
    :param templates: Glyphs collected from the original.
    :param options: Margin, figure length and the characters figures use.
    :returns: What the ink says, or why it would not say.
    """
    settings = options if options is not None else VerifyOptions()
    scope = settings.scope
    min_rivals = (
        settings.min_rivals
        if settings.min_rivals is not None
        else (MIN_TEXT_RIVALS if scope == "text" else MIN_RIVALS)
    )
    characters = (
        settings.characters
        if settings.characters is not None
        else (FIGURE_CHARACTERS if scope == "figures" else TEXT_CHARACTERS)
    )
    printed = printed_characters(run.text)

    # What the reading says it is, lined up with what the original printed. The
    # two must correspond character for character or the comparison is
    # meaningless.
    proposed = (
        printed_characters(settings.claimed or "") if scope == "confirm" else None
    )
    if proposed is not None and (len(proposed) == 0 or len(proposed) != len(printed)):
        return PrintCheck(verified=False, because="no-claim")

    if proposed is None:
        wanted = (
            _text_cells(printed, characters)
            if scope == "text"
            else _figure_cells(printed, settings.min_digits)
        )
    else:
        wanted = _disputed_cells(printed, proposed, characters)
    if len(wanted) == 0:
        return PrintCheck(
            verified=False, because="no-figure" if proposed is None else "no-claim"
        )

    box = ScanmateOrientedRect(
        x=run.x, y=run.y, width=run.width, height=run.height, angle=run.angle
    )
    # A total on a shaded bar is printed light on dark; turned round, it is a
    # figure like any other.
    light_on_dark = print_polarity(original, dpi, box) == "light-on-dark"
    cells = place_glyphs(original, dpi, box, run.text, CellOptions(light_on_dark=light_on_dark))
    if cells is None:
        return PrintCheck(verified=False, because="unplaceable")

    # Identifying an unknown glyph needs most of the alphabet. A settlement is
    # not asking that: the reading has already named its answer, so the question
    # is which of two named characters this ink is, and two templates answer it.
    rivals = [c for c in characters if template_key(run, c) in templates]

    def rivals_at(index: int) -> list[str]:
        if proposed is None:
            return rivals
        against = proposed[index] if index < len(proposed) else None

        return [against] if against is not None and template_key(run, against) in templates else []

    enough = (
        len(rivals) >= min_rivals
        if proposed is None
        else any(len(rivals_at(i)) > 0 for i in wanted)
    )
    if not enough:
        return PrintCheck(verified=False, because="few-rivals")

    # The cell exactly: a margin would bring in the neighbouring glyphs, which
    # both crops share, and shared ink correlates whatever the character is.
    crops: dict[int, tuple[GrayImage, GrayImage]] = {}
    coarse = False
    for index in sorted(wanted):
        cell = cells[index]
        if cell is None:
            continue
        glyph = cut(scan, dpi, cell, light_on_dark)
        as_printed = cut(original, dpi, cell, light_on_dark)
        if glyph is None or as_printed is None:
            continue
        # Never invent resolution. Matching happens at MATCH_HEIGHT, so a
        # shorter cell is scaled up and the detail that decides between two
        # digits is interpolated rather than scanned.
        if glyph.height < MATCH_HEIGHT:
            coarse = True
            continue
        crops[index] = (glyph, as_printed)
    if len(crops) == 0:
        return PrintCheck(
            verified=False, because="too-coarse" if coarse else "unplaceable"
        )

    # How far this scan's print has to be sharpened, measured where the answer
    # is known: each cell against the very glyph the original prints there.
    pairs = list(crops.values())
    recoveries = [_recovery_for(pairs, amount) for amount in SHARPENING]

    reading = list(printed)
    scored: list[CellVerification] = []
    confidence = 1.0
    checked = 0

    for index, crop in crops.items():
        passes = [
            _judge_cell(crop, printed[index], rivals_at(index), run, templates, recovery, settings)
            for recovery in recoveries
        ]
        first = passes[0]
        # Undecided unless every pass reads it the same way: a verdict that
        # changes as the sharpening changes is the sharpening talking.
        settled = first.read is not None and all(p.read == first.read for p in passes)
        scored.append(
            CellVerification(
                at=index,
                printed=printed[index],
                printed_score=first.printed_score,
                rival=first.rival,
                rival_score=first.rival_score,
                read=first.read if settled else None,
            )
        )
        if not settled or first.read is None:
            continue

        checked += 1
        reading[index] = first.read
        # The narrowest margin any pass decided by, so confidence is the
        # weakest link.
        confidence = min(confidence, *[abs(p.printed_score - p.rival_score) for p in passes])

    # Nothing decided is not an answer: say nothing rather than guess a digit.
    if checked == 0:
        return PrintCheck(verified=False, because="undecided")

    # Put the spaces back, so the reading reads like the run it is about.
    out: list[str] = []
    cell_index = 0
    for character in run.text:
        if character.strip() == "":
            out.append(character)
        else:
            out.append(reading[cell_index])
            cell_index += 1
    text = "".join(out)

    return PrintCheck(
        verified=True,
        reading=text,
        agrees=text == run.text,
        checked=checked,
        confidence=confidence,
        cells=scored,
    )


def _judge_cell(
    crop: tuple[GrayImage, GrayImage],
    printed: str,
    rivals: Sequence[str],
    run: TextRun,
    templates: Templates,
    recovery: _Recovery,
    limits: VerifyOptions,
) -> _Judgement:
    """What one pass of the sharpening sweep makes of a single cell."""
    glyph, as_printed = crop
    printed_score = _correlate(glyph, as_printed, recovery)
    others = [
        (character, _best_match(glyph, templates.get(template_key(run, character), []), recovery))
        for character in rivals
        if character != printed
    ]
    # Sorted by score, highest first - a stable sort, as `toSorted` is.
    others.sort(key=lambda entry: -entry[1])
    if len(others) == 0:
        return _Judgement(read=None, printed_score=printed_score, rival="", rival_score=-1)

    rival, rival_score = others[0]
    # A change has to look like the character it is being read as, not merely
    # less like the printed one.
    changed = (
        rival_score >= printed_score + limits.min_margin
        and rival_score >= limits.min_score
        and printed_score <= limits.max_printed
    )
    unchanged = (
        printed_score >= rival_score + limits.min_margin
        and printed_score >= limits.min_printed
    )

    return _Judgement(
        read=rival if changed else (printed if unchanged else None),
        printed_score=printed_score,
        rival=rival,
        rival_score=rival_score,
    )


def _text_cells(printed: Sequence[str], characters: str) -> set[int]:
    """Every cell the character set covers."""
    return {i for i, c in enumerate(printed) if c in characters}


def _disputed_cells(
    printed: Sequence[str], proposed: Sequence[str], characters: str
) -> set[int]:
    """Where the print and the reading disagree."""
    wanted: set[int] = set()
    for index, character in enumerate(printed):
        against = proposed[index] if index < len(proposed) else None
        if (
            against is not None
            and against != character
            and character in characters
            and against in characters
        ):
            wanted.add(index)

    return wanted


def _figure_cells(printed: Sequence[str], min_digits: int) -> set[int]:
    """The digits of every figure of at least ``min_digits`` digits."""
    wanted: set[int] = set()
    group: list[int] = []

    def close() -> None:
        nonlocal group
        if len(group) >= min_digits:
            wanted.update(group)
        group = []

    for index, character in enumerate(printed):
        if _DIGIT.search(character):
            group.append(index)
        # A separator inside a figure carries on the group; anything else ends it.
        elif not _SEPARATOR.search(character) or len(group) == 0:
            close()
    close()

    return wanted


def _recovery_for(
    pairs: Sequence[tuple[GrayImage, GrayImage]], amount: float
) -> _Recovery:
    """How soft the print has to be drawn to sit best on the scan's own glyphs."""
    best = _Recovery(sigma=0, amount=amount)
    best_score = -math.inf
    for sigma in RECOVERY:
        recovery = _Recovery(sigma=sigma, amount=amount)
        score = 0.0
        for glyph, as_printed in pairs:
            score += _correlate(glyph, as_printed, recovery)
        if score > best_score:
            best = recovery
            best_score = score

    return best


def _best_match(
    glyph: GrayImage, templates: Sequence[GrayImage], recovery: _Recovery
) -> float:
    """The best correlation between one glyph and a character's templates."""
    best = -1.0
    for template in templates:
        best = max(best, _correlate(glyph, template, recovery))

    return best


def _sharpen(image: GrayImage, recovery: _Recovery) -> GrayImage:
    """An unsharp mask: what the scanner blurred away, added back."""
    if recovery.sigma <= 0 or recovery.amount <= 0:
        return image

    blurred = _soften(image, recovery.sigma)
    # float32 throughout, as the TypeScript's Float32Array is.
    data = (
        image.pixels + numpy.float32(recovery.amount) * (image.pixels - blurred.pixels)
    ).astype(numpy.float32)

    return GrayImage(pixels=numpy.ascontiguousarray(data))


def _soften(image: GrayImage, sigma: float) -> GrayImage:
    """A Gaussian blur of ``sigma`` match pixels."""
    if sigma <= 0:
        return image

    radius = max(1, math.ceil(sigma * 2))
    kernel = [math.exp(-(i * i) / (2 * sigma * sigma)) for i in range(-radius, radius + 1)]
    total = 0.0
    for value in kernel:
        total += value
    weights = [value / total for value in kernel]

    height, width = image.pixels.shape
    source = image.pixels
    horizontal = numpy.zeros((height, width), dtype=numpy.float32)
    for y in range(height):
        for x in range(width):
            total_row = 0.0
            for k, weight in enumerate(weights):
                sx = min(width - 1, max(0, x + k - radius))
                total_row += float(source[y, sx]) * weight
            horizontal[y, x] = numpy.float32(total_row)

    data = numpy.zeros((height, width), dtype=numpy.float32)
    for y in range(height):
        for x in range(width):
            total_column = 0.0
            for k, weight in enumerate(weights):
                sy = min(height - 1, max(0, y + k - radius))
                total_column += float(horizontal[sy, x]) * weight
            data[y, x] = numpy.float32(total_column)

    return GrayImage(pixels=data)


def _correlate(glyph: GrayImage, template: GrayImage, recovery: _Recovery) -> float:
    """How alike two glyphs are, each scaled to the same small box.

    The template is slid a pixel each way to allow for a cell that landed a
    fraction out. Correlation rather than a difference of pixels, because a scan
    is darker or lighter than the print it came from and that must not decide
    anything. The scan's glyph is sharpened; the template is left as printed.
    """
    height = MATCH_HEIGHT
    ratio = (glyph.width / glyph.height + template.width / template.height) / 2
    width = max(2, _js_round(height * ratio))
    a = _sharpen(resize_gray(glyph, width, height), recovery)
    b = resize_gray(template, width, height)

    best = -1.0
    for dy in range(-SHIFT, SHIFT + 1):
        for dx in range(-SHIFT, SHIFT + 1):
            best = max(best, _pearson(a, b, dx, dy))

    return best


def _pearson(a: GrayImage, b: GrayImage, dx: int, dy: int) -> float:
    """Pearson correlation of two images of one size, the second shifted."""
    y_from = max(0, -dy)
    y_to = min(a.height, a.height - dy)
    x_from = max(0, -dx)
    x_to = min(a.width, a.width - dx)
    if y_to <= y_from or x_to <= x_from:
        return 0.0

    count = 0
    sum_a = 0.0
    sum_b = 0.0
    # Summed in the TypeScript's own order rather than with numpy: `.sum()`
    # adds pairwise, which rounds differently from a left-to-right loop, and
    # these means feed a correlation the verdict is read off.
    for y in range(y_from, y_to):
        for x in range(x_from, x_to):
            sum_a += float(a.pixels[y, x])
            sum_b += float(b.pixels[y + dy, x + dx])
            count += 1
    if count == 0:
        return 0.0

    mean_a = sum_a / count
    mean_b = sum_b / count
    covariance = 0.0
    variance_a = 0.0
    variance_b = 0.0
    for y in range(y_from, y_to):
        for x in range(x_from, x_to):
            da = float(a.pixels[y, x]) - mean_a
            db = float(b.pixels[y + dy, x + dx]) - mean_b
            covariance += da * db
            variance_a += da * da
            variance_b += db * db
    spread = math.sqrt(variance_a * variance_b)

    return 0.0 if spread == 0 else covariance / spread


def _js_round(value: float) -> int:
    """``Math.round``: halves go up, not to even."""
    return math.floor(value + 0.5)


__all__ = [
    "FIGURE_CHARACTERS",
    "MATCH_HEIGHT",
    "MAX_PRINTED_SCORE",
    "MIN_MARGIN",
    "MIN_PRINTED_SCORE",
    "MIN_RIVALS",
    "MIN_SCORE",
    "MIN_TEXT_RIVALS",
    "TEXT_CHARACTERS",
    "CellVerification",
    "PrintAbstention",
    "PrintCheck",
    "VerifyOptions",
    "verify_printed_run",
]
