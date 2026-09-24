"""JavaScript's numeric semantics, for a port that has to agree bit for bit."""

from .js_numeric_algorithm import imul, js_round, to_int32, to_uint32, ushr

__all__ = ["imul", "js_round", "to_int32", "to_uint32", "ushr"]
