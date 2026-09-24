"""Making OCR text and a document's own text comparable: the noise OCR adds, removed."""

from .confusables_mapper import fold_confusables
from .diacritics_mapper import diacritics_map, fold_diacritics
from .normalise_text_algorithm import (
    DEFAULT_NORMALISE,
    NormaliseOptions,
    normalise_text,
    tokenise,
    with_options,
)

__all__ = [
    "DEFAULT_NORMALISE",
    "NormaliseOptions",
    "diacritics_map",
    "fold_confusables",
    "fold_diacritics",
    "normalise_text",
    "tokenise",
    "with_options",
]
