"""Adding up floats in the order a ``+=`` loop adds them up.

``total += values[i]`` in a loop and ``np.sum(values)`` are not the same
operation. numpy reduces PAIRWISE - it sums blocks and then sums the blocks -
which keeps the error growing like the square root of the count instead of
linearly. That is a better algorithm and a different number, and a port whose
job is to agree with a JavaScript loop cannot use it.

The difference is not academic at the sizes here. Across the resampling
weights it is invisible below about eight terms and appears at eight; across a
3072-pixel correlation it is routine. ``math.fsum`` is no help either, for the
opposite reason: it is correctly rounded, so it disagrees with the loop even
more often than numpy does.

``np.cumsum`` is the primitive that does what is wanted, because producing
every prefix forces it to run in order. This module wraps it so the intent is
named at the call site, and so the memory it costs stays bounded: summing a
twelve-megapixel image with a bare ``cumsum`` allocates a 96 MB temporary,
while the chunked loop below allocates a megabyte and carries the running total
across chunks. Carrying the total is exact rather than nearly so - the sum of a
chunk starting from ``total`` is ``total + c0 + c1 + ...``, which is the same
sequence of additions the unchunked version performs.

This lives in ``js_semantics`` rather than in either caller because two slices
need it - ``geometric_transform``'s area average and ``similarity_scoring``'s
correlation - and neither owns the concept. It is the same reason
:func:`~.js_numeric_algorithm.js_round` moved here.
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

#: Terms per chunk. Large enough that the chunking never dominates, small
#: enough that the temporary stays around 8 MB of float64.
_CHUNK = 1 << 20


def sequential_sum(values: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
    """Sum the LAST axis strictly left to right.

    :param values: Any float array; the last axis is the one reduced.
    :returns: The running-order totals, with the last axis dropped. A 1-D input
        therefore gives a zero-dimensional result, which ``float()`` narrows.
    """
    terms = values.shape[-1]
    if terms == 0:
        return np.zeros(values.shape[:-1], dtype=np.float64)

    if terms <= _CHUNK:
        return np.cumsum(values, axis=-1)[..., -1]

    total = np.zeros(values.shape[:-1], dtype=np.float64)
    for start in range(0, terms, _CHUNK):
        block = values[..., start : start + _CHUNK]
        carried = np.concatenate([total[..., None], block], axis=-1)
        total = np.cumsum(carried, axis=-1)[..., -1]

    return total


def sequential_total(values: npt.ArrayLike) -> float:
    """:func:`sequential_sum` of a flat array, as a plain float.

    Widened to ``ArrayLike`` rather than float64 because it converts anyway,
    and the callers hand it float32 image data.

    :param values: Any array; flattened in C order, which is the order the
        TypeScript's own index loop visits a row-major image in.
    :returns: The total.
    """
    return float(sequential_sum(np.asarray(values, dtype=np.float64).reshape(-1)))
