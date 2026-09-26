"""A stable key for an option bag, so a stage knows whether it has already run.

Not a plain ``json.dumps``: key order would make two identical bags disagree, an
absent setting would differ from one passed explicitly, an OCR engine or a
predicate cannot be serialised at all, and a raster would stringify megabytes of
pixels to decide a cache hit.

So keys are sorted, ``None`` is elided, and anything that cannot be compared by
value - a function, an engine, an array of pixels - is compared by **identity**,
through a counter keyed on ``id()``. Two calls passing the same engine agree;
two calls passing equivalent-looking engines do not, which is the safe
direction: a false miss costs time, a false hit returns the wrong answer.

.. note::
   **The string itself is not held to the TypeScript's**, and it is the one
   thing in this port that could not be even in principle. It carries identity
   counters, which are per-process by definition; the TypeScript sorts keys
   with ``localeCompare``, which is locale-aware rather than by code point; and
   a cache key is never handed between the two languages, so an identical
   spelling would buy nothing. What *is* held is the contract the key exists
   for: **equal settings give equal keys, and different settings give different
   ones.** That is what the tests check.
"""

from __future__ import annotations

import json
from typing import Any

#: Identity numbers handed out to values that cannot be compared by value.
#: Keyed on ``id()``, with the value kept alive alongside so the id cannot be
#: recycled onto a different object while the cache still holds the key -
#: which would be a false HIT, the one direction that must never happen.
_identities: dict[int, tuple[int, Any]] = {}


def _identity(value: object) -> int:
    """A stable number for one object, for as long as this process runs."""
    key = id(value)
    known = _identities.get(key)
    if known is not None:
        return known[0]
    number = len(_identities)
    _identities[key] = (number, value)

    return number


def _stable(value: object) -> object:
    """The value as something comparable, or a token standing for it."""
    if value is None or isinstance(value, (str, int, float)) and not isinstance(value, bool):
        return value
    if isinstance(value, bool):
        return value
    if callable(value):
        return f"fn#{_identity(value)}"
    if isinstance(value, (bytes, bytearray, memoryview)):
        return f"bytes:{len(bytes(value))}#{_identity(value)}"
    if isinstance(value, (list, tuple)):
        return [_stable(item) for item in value]

    # A raster or a greyscale image is identified by its shape and which object
    # it is, never by its pixels.
    pixels = getattr(value, "pixels", None)
    if pixels is not None and hasattr(pixels, "shape"):
        width = getattr(value, "width", None)
        height = getattr(value, "height", None)

        return f"raster:{width}x{height}#{_identity(value)}"

    fields = _fields_of(value)
    if fields is None:
        return f"opaque#{_identity(value)}"

    # `None` is elided, so a setting left at its default and one passed
    # explicitly as None are the same settings - which is the whole point.
    return {key: _stable(item) for key, item in sorted(fields.items()) if item is not None}


def _fields_of(value: object) -> dict[str, Any] | None:
    """The value's settings, or ``None`` when it keeps its state privately."""
    if isinstance(value, dict):
        return {str(key): item for key, item in value.items()}
    if hasattr(value, "__dataclass_fields__"):
        return {name: getattr(value, name) for name in value.__dataclass_fields__}

    return None


def fingerprint(value: object) -> str:
    """A stable string for any option bag.

    :param value: The settings.
    :returns: A string that is equal exactly when the settings are.
    """
    return json.dumps(_stable(value), sort_keys=True, separators=(",", ":"), default=str)
