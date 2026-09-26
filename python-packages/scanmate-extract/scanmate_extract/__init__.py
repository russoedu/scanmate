"""``scanmate-extract`` - the decisions a PDF pipeline makes, ported exactly.

.. code-block:: python

    from scanmate_extract import pair_dpi, resolve_fields, select_pages

    select_pages("1-3,5", 8)          # [1, 2, 3, 5]
    pair_dpi(original, scanned, "match")
    resolve_fields(pages, specs)      # field regions, from the labels a form prints

**This package deliberately does not render PDFs or read their text layers.**
Those are the two things pdf.js does that no Python engine does the same way,
and a port of them would be a different tool wearing the same name. See the
README for exactly what is absent and why - the same position
``scanmate-ink`` takes on ``resampleRaster`` and ``blurRaster``.

Everything here is pure, and every value is held to the TypeScript's own
output.
"""

from .field_location import (
    MAX_WORD_GAP,
    AnchorCorner,
    AnchorMatch,
    FieldOffset,
    FieldSpec,
    LocatablePage,
    LocatedAnchor,
    LocatedFields,
    LocateOptions,
    LocationProblem,
    locate_anchor,
    place_field,
    resolve_fields,
)
from .page_extraction import (
    PagePairing,
    PageSelection,
    PairingPlan,
    Unpaired,
    plan_pairs,
    select_pages,
)
from .page_inspection import (
    SCAN_COVERAGE,
    ColorKind,
    EmbeddedImage,
    PageEvidence,
    PageKind,
    PageMetadata,
    classify_page,
)
from .page_rendering import (
    DEFAULT_DPI_LIMITS,
    DpiChoice,
    DpiLimits,
    PairDpi,
    native_dpi,
    page_dpi,
    pair_dpi,
)

__all__ = [
    "DEFAULT_DPI_LIMITS",
    "MAX_WORD_GAP",
    "SCAN_COVERAGE",
    "AnchorCorner",
    "AnchorMatch",
    "ColorKind",
    "DpiChoice",
    "DpiLimits",
    "EmbeddedImage",
    "FieldOffset",
    "FieldSpec",
    "LocatablePage",
    "LocateOptions",
    "LocatedAnchor",
    "LocatedFields",
    "LocationProblem",
    "PageEvidence",
    "PageKind",
    "PageMetadata",
    "PagePairing",
    "PageSelection",
    "PairDpi",
    "PairingPlan",
    "Unpaired",
    "classify_page",
    "locate_anchor",
    "native_dpi",
    "page_dpi",
    "pair_dpi",
    "place_field",
    "plan_pairs",
    "resolve_fields",
    "select_pages",
]
