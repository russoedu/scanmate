"""``scanmate-scan`` - the parts of the pipeline that are pure computation.

.. code-block:: python

    from scanmate_scan import approximate_search, best_match

    best_match("Initial Subscription Term", "The lnitial Subscription Terrn begins")

**The session that ties the pipeline together is not here.** It orchestrates
PDF rendering and OCR, neither of which is ported - see the README, and
``scanmate-extract`` and ``scanmate-ocr`` for why. What is here is the
computation underneath, held to the TypeScript exactly.
"""

from .approximate_search import (
    ApproximateMatch,
    SearchOptions,
    Span,
    approximate_search,
    best_match,
    word_span,
)
from .noise_reduction import despeckle, estimate_noise_sigma
from .stage_caching import fingerprint

__all__ = [
    "ApproximateMatch",
    "SearchOptions",
    "Span",
    "approximate_search",
    "best_match",
    "despeckle",
    "estimate_noise_sigma",
    "fingerprint",
    "word_span",
]
