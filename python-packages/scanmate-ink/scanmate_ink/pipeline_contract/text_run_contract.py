"""A run of text somewhere on a page.

Three shapes used to say this - one from the PDF text layer, two inside the
reader - and they differed only in which fields they made optional. That cost
more than tidiness: the reader's shape had no ``angle``, so a third shape had
to be invented the moment printed runs turned sideways needed checking.

One shape now, with everything past the box optional, because a PDF's text
layer knows more about a run than OCR ever will. A producer that knows a field
fills it; a consumer that needs one says so.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..plane_geometry import Point, ScanmateOrientedRect


@dataclass(frozen=True, slots=True, kw_only=True)
class TextRun(ScanmateOrientedRect):
    """What a run says, where it sits, and whatever else the producer knew."""

    #: What the run says.
    text: str
    #: Where the run's baseline starts, when the producer knows it.
    baseline: Point | None = None
    #: Size of the font as placed, in points.
    font_size: float | None = None
    #: Stable within a document: runs that share it share a face.
    font_name: str | None = None
    #: The run ends a line.
    ends_line: bool | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class PdfTextRun(TextRun):
    """A run read off a PDF's own text layer: exact, and everything is known.

    This is what the extractor reports and what the glyph checks rely on - a
    face, a size and an angle are what let a printed figure be matched against
    the other glyphs the page prints in the same face.

    Positions are PDF points (1/72 inch) from the top-left corner of the page
    as displayed - after its rotation - which is the frame a rendered page is
    in, and the one the pixel comparison takes regions in. Multiply by
    ``dpi / 72`` for pixels of a page rendered at ``dpi``.

    The TypeScript spells this ``Required<TextRun>``, which Python has no
    equivalent of. Redeclaring the optional fields as required is the faithful
    translation, and it is checked: the parity test asserts that this class and
    :class:`TextRun` carry exactly the same field NAMES, so a field added to
    one and forgotten on the other fails rather than drifting.
    """

    # `angle` too: `Required<T>` in TypeScript reaches every property of the
    # resolved type, inherited ones included, so a PDF run always states its
    # orientation rather than relying on the zero default.
    angle: float
    baseline: Point
    font_size: float
    font_name: str
    ends_line: bool
