"""What resolution to render a page at.

- A number renders every page at that dpi.
- ``"native"`` renders a scanned page at the resolution it was scanned at, and a
  born-digital page at ``fallback_dpi``. Rendering a 120 dpi scan at 300 adds no
  information; it only interpolates.
- ``"match"`` renders the original at the scan's resolution, **measured on the
  paper it shows**: the scan's pixels over the *original's* page size. A scan
  stored on a page of its own size is simply its native dpi, and both sides
  render alike. A photo stored at one pixel per point - a 3024-pixel-wide
  picture of an A4 sheet on a 42-inch page - says 72 dpi of itself but holds 345
  on the sheet, so the original renders at 345 and the photo at its own pixels,
  never resampled, leaving the scale to alignment.

``"match"`` is the default for pairs, and it is the answer to a measurement
rather than a guess: on real scans at 93, 120 and 144 dpi, rendering the
original at the scan's own dpi beat every fixed choice from 150 to 300 - on
alignment confidence, on overlap, on time, and on false "changes" at stroke
edges, which at 300 dpi reached 0.18% of the page on a 93 dpi scan and were zero
at matched dpi. Oversampling the original makes the two disagree at every edge,
and that disagreement is exactly what a diff reports as a change.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, TypeAlias

from ..page_inspection import PageMetadata

#: A number, ``"native"`` or ``"match"``.
DpiChoice: TypeAlias = "float | Literal['native', 'match']"


@dataclass(frozen=True, slots=True)
class DpiLimits:
    """Bounds on a rendering resolution."""

    #: Resolution for a page that is not a scan and so has no native dpi.
    fallback_dpi: float = 200
    #: Bounds on a *native* resolution, which comes from the file and may be absurd.
    min_dpi: float = 72
    max_dpi: float = 400


DEFAULT_DPI_LIMITS = DpiLimits(fallback_dpi=200, min_dpi=72, max_dpi=400)


@dataclass(frozen=True, slots=True)
class PairDpi:
    """A resolution for each side of a page pair."""

    original: float
    scanned: float


def native_dpi(metadata: PageMetadata, limits: DpiLimits = DEFAULT_DPI_LIMITS) -> float:
    """A page's own resolution: its scan's, clamped, or the fallback.

    :param metadata: The page.
    :param limits: The bounds and fallback.
    :returns: The resolution in dots per inch.
    """
    if metadata.effective_dpi is None:
        return limits.fallback_dpi

    return _clamp(metadata.effective_dpi, limits)


def page_dpi(
    metadata: PageMetadata, choice: DpiChoice, limits: DpiLimits = DEFAULT_DPI_LIMITS
) -> float:
    """Resolution for a page of a single document.

    ``"match"`` has nothing to match, so it means ``"native"``.

    :param metadata: The page.
    :param choice: A number, ``"native"`` or ``"match"``.
    :param limits: The bounds and fallback.
    :returns: The resolution in dots per inch.
    :raises ValueError: A given number is not a positive, finite dpi.
    """
    return _checked(choice) if not isinstance(choice, str) else native_dpi(metadata, limits)


def pair_dpi(
    original: PageMetadata,
    scanned: PageMetadata,
    choice: DpiChoice,
    limits: DpiLimits = DEFAULT_DPI_LIMITS,
) -> PairDpi:
    """Resolutions for both sides of a page pair.

    :param original: The page as issued.
    :param scanned: The page as returned.
    :param choice: A number, ``"native"`` or ``"match"``.
    :param limits: The bounds and fallback.
    :returns: A resolution for each side.
    :raises ValueError: A given number is not a positive, finite dpi.
    """
    if not isinstance(choice, str):
        checked = _checked(choice)

        return PairDpi(original=checked, scanned=checked)
    if choice == "native":
        return PairDpi(original=native_dpi(original, limits), scanned=native_dpi(scanned, limits))

    scan = native_dpi(scanned, limits)
    if scanned.effective_dpi is None:
        return PairDpi(original=scan, scanned=scan)

    return PairDpi(
        original=_clamp(scanned.effective_dpi * _on_paper(original, scanned), limits),
        scanned=scan,
    )


def _on_paper(original: PageMetadata, scanned: PageMetadata) -> float:
    """How many of the original's pages fit across the scanned page.

    Long side to long side and short to short, whichever fits first - ``1`` for
    a scan stored at its paper's size, whatever the orientation.
    """
    original_long, original_short = _sides(original)
    scanned_long, scanned_short = _sides(scanned)
    ratio = min(scanned_long / original_long, scanned_short / original_short)

    # Paper sizes differ by a few percent - A4 against Letter - and that is not
    # a different resolution.
    return 1 if abs(ratio - 1) < 0.1 else ratio


def _sides(page: PageMetadata) -> tuple[float, float]:
    """The page's long and short sides, in that order."""
    return (
        max(page.point_width, page.point_height),
        min(page.point_width, page.point_height),
    )


def _clamp(dpi: float, limits: DpiLimits) -> float:
    """A native resolution, held inside the limits."""
    return min(limits.max_dpi, max(limits.min_dpi, dpi))


def _checked(dpi: float) -> float:
    """A caller's own dpi, which must be a positive number.

    :param dpi: What was asked for.
    :returns: The same value.
    :raises ValueError: It is not finite, or not above zero.
    """
    if not math.isfinite(dpi) or dpi <= 0:
        raise ValueError(f"dpi must be a positive number, got {_as_js_number(dpi)}")

    return dpi


def _as_js_number(value: float) -> str:
    """Format a number the way JavaScript puts one in a message.

    So the two ports produce the same sentence: ``0`` rather than ``0.0``, and
    ``Infinity`` rather than ``inf``.
    """
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"

    return str(int(value)) if value == int(value) else str(value)
