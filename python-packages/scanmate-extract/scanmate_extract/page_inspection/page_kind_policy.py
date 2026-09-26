"""Is this page a scan, a born-digital page, a scan with a text layer, or blank?"""

from __future__ import annotations

from dataclasses import dataclass

from .page_metadata_contract import PageKind

#: Coverage above which a page counts as a scan: one bitmap over the page.
#:
#: Scans sit at or near 100%; scanners that crop to the paper edge or leave a
#: margin still clear this easily, and no letterhead gets anywhere near it.
SCAN_COVERAGE = 0.8


@dataclass(frozen=True, slots=True)
class PageEvidence:
    """What a page shows, before anything is rendered."""

    #: Fraction of the page covered by painted bitmaps, in ``[0, 1]``.
    image_coverage: float
    character_count: int
    #: The page draws vector paths - rules, boxes, a signature line.
    draws_paths: bool


def classify_page(evidence: PageEvidence) -> PageKind:
    """Decide what kind of page this is.

    :param evidence: Coverage, character count and whether paths are drawn.
    :returns: The page kind.
    """
    has_text = evidence.character_count > 0

    if evidence.image_coverage >= SCAN_COVERAGE:
        return "scanned-with-text-layer" if has_text else "scanned"
    if has_text or evidence.draws_paths or evidence.image_coverage > 0:
        return "vector"

    return "empty"
