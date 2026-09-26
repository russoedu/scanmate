"""What a mark is, how they are drawn, and what came of drawing them."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class PageMark:
    """One region to draw, where the document's own fields are expected to be.

    In points, from the top-left of the page as displayed - the same coordinates
    ``scanmate-extract`` reports text in. So the list about to be handed to an
    audit can be drawn as it is, and what is checked visually is exactly what
    will be measured.

    A mark's own bleed, when it has one, is drawn instead of the options' - the
    same rule the comparison claims by, so a signature box given more room below
    is shown with that room.
    """

    #: One-based page number.
    page: int
    x: float
    y: float
    width: float
    height: float
    #: Written beside the box, so a reviewer can tell which field is which.
    id: str | None = None
    bleed: float | None = None
    bleed_top: float | None = None
    bleed_right: float | None = None
    bleed_bottom: float | None = None
    bleed_left: float | None = None


@dataclass(frozen=True, slots=True)
class MarkOptions:
    """How the marks are drawn.

    The bleed is drawn as a dashed band around each mark, and is the same rule
    the pixel comparison measures with. A mark checked here with a given bleed
    is checked against the region an audit with that bleed will actually claim.
    """

    #: Write each mark's ``id`` beside it.
    labels: bool = True
    #: Opens a PDF encrypted with a password it needs to be read. A signed or
    #: permission-restricted document, locked with an owner password alone,
    #: needs none: it is decrypted as it is read, and the marks are drawn on it.
    password: str | None = None
    bleed: float | None = None
    bleed_top: float | None = None
    bleed_right: float | None = None
    bleed_bottom: float | None = None
    bleed_left: float | None = None


@dataclass(frozen=True, slots=True)
class MarkResult:
    """The marked document, and what could not be marked."""

    #: The original, with the marks drawn on it. Nothing else about it changes.
    pdf: bytes
    #: How many marks were drawn.
    drawn: int
    #: What could not be drawn, or was drawn somewhere it cannot be right: a
    #: mark on a page the document does not have, or one that reaches past the
    #: edge of its page. The second is itself a positioning error, and exactly
    #: the kind this exists to catch.
    warnings: list[str] = field(default_factory=list)
