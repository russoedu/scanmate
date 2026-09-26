"""Where a document's fields are, expressed as offsets from the labels it prints."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, TypeAlias

from scanmate_ink import NormaliseOptions, PageRegion, ScanmateRect, TextRun

#: Which corner of the anchor the offsets are measured from.
#:
#: A field to the right of its label is best measured from the label's right
#: edge: measured from the left, its position would move whenever the label's
#: wording or type did.
AnchorCorner: TypeAlias = Literal["top-left", "top-right", "bottom-left", "bottom-right"]


@dataclass(frozen=True, slots=True)
class FieldOffset:
    """Where a field sits relative to a corner of its anchor, in points.

    Positive is right and down.
    """

    dx: float
    dy: float
    width: float
    height: float


@dataclass(frozen=True, slots=True)
class FieldSpec:
    """One anchor, and the fields placed from it."""

    #: The label to find, as the document prints it. It may wrap onto a
    #: following line, and may be part of a longer run of text - it is matched
    #: word for word, never inside a word, so ``"Date"`` does not find
    #: ``"Update"``.
    anchor: str
    #: The fields, by id. Each id must be unique across every spec.
    fields: dict[str, FieldOffset]
    #: ``"unique"`` (the default): the anchor must occur exactly once in the
    #: pages searched, or nothing is placed. A number picks that occurrence,
    #: one-based, counted through the document in page order.
    occurrence: str | int = "unique"
    #: Only search this page. By default the whole document is searched.
    page: int | None = None
    #: The corner the offsets are measured from.
    from_corner: AnchorCorner = "top-left"


@dataclass(frozen=True, slots=True)
class LocateOptions:
    """How the text is compared, and what counts as one line."""

    #: How text is made comparable before matching. The suite's default is used
    #: when unset.
    normalise: NormaliseOptions | None = None
    #: Runs whose tops differ by at most this many points are on one line.
    line_tolerance: float = 2
    #: How far below a line the next may start and still continue an anchor, as
    #: a share of that line's height. ``1.8``: a label wrapped onto the next
    #: line qualifies, a paragraph further down does not.
    line_spacing: float = 1.8


@dataclass(frozen=True, slots=True)
class LocatablePage:
    """A page's text, and how large the page is as displayed."""

    page: int
    width: float
    height: float
    text_items: list[TextRun] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class AnchorMatch:
    """One place an anchor was found."""

    #: The box around the words that spell it, joined across runs and lines.
    box: ScanmateRect
    #: Whether an edge of the box was placed by estimate. A run's words are not
    #: measured one by one, so where an anchor starts or ends inside a run,
    #: that edge is placed in proportion to its characters.
    estimated: bool


@dataclass(frozen=True, slots=True)
class LocatedAnchor:
    """The anchor a spec settled on."""

    box: ScanmateRect
    estimated: bool
    anchor: str
    page: int


@dataclass(frozen=True, slots=True)
class LocationProblem:
    """One thing wrong with a location.

    A single class with an optional payload rather than the TypeScript's
    discriminated union, for the same reason ``scanmate-seal`` does it:
    ``kind`` is the discriminant and carries the same seven spellings.
    """

    #: One of ``anchor-missing``, ``anchor-ambiguous``, ``occurrence-missing``,
    #: ``duplicate-id``, ``not-finite``, ``off-page``, ``overlap``.
    kind: str
    anchor: str | None = None
    occurrences: int | None = None
    occurrence: int | None = None
    id: str | None = None
    page: int | None = None
    ids: tuple[str, str] | None = None


@dataclass(frozen=True, slots=True)
class LocatedFields:
    """Every field placed, every anchor found, and everything wrong."""

    #: Ready to mark, and as an audit's ``expected`` regions.
    regions: list[PageRegion]
    #: Where each anchor was found.
    anchors: list[LocatedAnchor]
    #: Everything wrong. An empty list means the regions can be trusted.
    problems: list[LocationProblem]
