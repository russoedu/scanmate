"""How a page is cleaned, and what was actually done to it."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypeAlias

#: A clamp point read from the page, or given as a share of the background.
ContrastPoint: TypeAlias = "float | Literal['auto']"

#: Whether to median-filter before normalising.
DespeckleChoice: TypeAlias = "bool | Literal['auto']"


@dataclass(frozen=True, slots=True)
class SharpenOptions:
    """How hard to put back the edges a scanner softened."""

    #: Radius, in pixels of the enhanced page - so fitted after any enlargement.
    sigma: float
    #: How much of what the blur removed is added back.
    amount: float = 1.5


@dataclass(frozen=True, slots=True)
class EnhanceOptions:
    """Every option has a default; see :data:`DEFAULT_ENHANCE_OPTIONS`."""

    #: Sharpen the levelled page. ``False`` by default: it helps a soft scan a
    #: great deal and costs a good one a little, so it is chosen per document
    #: rather than applied to every one.
    sharpen: SharpenOptions | Literal[False] = False
    #: Background window as a share of the page's shorter side. Wide enough
    #: that no stroke fills it - or a bold heading becomes its own background
    #: and fades - narrow enough to follow a shadow across the page.
    background_fraction: float = 1 / 16
    #: Share of the local background above which a pixel becomes pure white.
    #: ``"auto"`` reads it from the page's own histogram, and on real scans
    #: settles at 1.1, which leaves paper light grey rather than white.
    white_point: ContrastPoint = "auto"
    #: Share of the local background below which a pixel becomes pure black.
    black_point: ContrastPoint = "auto"
    #: ``"color"`` normalises R, G and B each against its own background, which
    #: removes a colour cast and keeps a blue signature blue. ``"grayscale"``
    #: converts first and returns a clean monochrome page.
    mode: Literal["color", "grayscale"] = "color"
    #: Median-filter before normalising. Speckle left in place fuses into thin
    #: strokes once contrast is stretched; a median can equally erase a stroke
    #: only a pixel or two wide. ``"auto"`` measures the page's noise first.
    despeckle: DespeckleChoice = "auto"
    #: Noise level, on the ``[0, 1]`` grey scale, above which ``"auto"``
    #: despeckles.
    despeckle_threshold: float = 0.01
    #: Median window half-size in pixels: ``1`` is a 3x3 window.
    despeckle_radius: float = 1


#: Chosen by OCR word recall on three real scans (93, 120 and 144 dpi, 21
#: pages) enlarged to 300 dpi: automatic clamp points gave the best mean, 0.738
#: against 0.728 unenhanced, and gained most where reading is hardest - 0.448
#: against 0.397 at 93 dpi.
#:
#: Forcing a despeckle cost recall at every resolution tried, and badly at the
#: scans' own (0.141 against 0.392 at 93 dpi): a 3x3 median erases a stroke one
#: or two pixels wide. So despeckling is ``"auto"``, which only fires on a page
#: that measures noisy.
DEFAULT_ENHANCE_OPTIONS = EnhanceOptions()


@dataclass(frozen=True, slots=True)
class AppliedEnhancement:
    """What was actually done - the values ``"auto"`` settled on, among them."""

    white_point: float
    black_point: float
    mode: Literal["color", "grayscale"]
    despeckled: bool
    #: The page's measured noise level; ``None`` when it was not measured
    #: because nothing depended on it.
    noise_sigma: float | None
    #: The sharpening applied afterwards, or ``False`` when none was.
    sharpened: SharpenOptions | Literal[False]


@dataclass(frozen=True, slots=True)
class ContrastPoints:
    """Where to clamp to black and to white."""

    white_point: float
    black_point: float
