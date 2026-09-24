"""Sequential summation, and the two things about it that are easy to get wrong.

The correctness of this helper is measured through its callers -
``geometric_transform``'s area average and ``similarity_scoring``'s correlation
both compare against goldens that a pairwise reduction fails. What those
goldens cannot reach is the chunking, because neither of them ever sums more
than about three thousand terms. So the chunk boundary is tested here directly,
at a size no image-sized golden will ever produce.
"""

from __future__ import annotations

import numpy as np

from .float_accumulation_algorithm import _CHUNK, sequential_sum, sequential_total


def test_matches_a_running_loop_exactly() -> None:
    """The whole contract, stated against the thing it is imitating."""
    rng = np.random.default_rng(4)
    values = rng.standard_normal(5000) * 1e6

    running = 0.0
    for value in values:
        running += float(value)

    assert sequential_total(values) == running


def test_differs_from_a_pairwise_reduction() -> None:
    """Otherwise the helper would have no reason to exist.

    Pairwise is the more accurate algorithm, which is exactly why it is wrong
    here: the job is to agree with a JavaScript loop, not to beat it.
    """
    rng = np.random.default_rng(4)
    values = rng.standard_normal(5000) * 1e6

    assert sequential_total(values) != float(values.sum())


def test_chunking_does_not_change_the_answer() -> None:
    """Spanning the chunk boundary must be bit-identical to not spanning it.

    Carrying the running total into the next chunk is what makes that true -
    restarting each chunk from zero and adding the parts afterwards is a
    different set of additions, and no image-sized golden anywhere in this
    package is large enough to notice.
    """
    rng = np.random.default_rng(9)
    values = rng.standard_normal(_CHUNK + 5000) * 1e6

    running = 0.0
    for value in values:
        running += float(value)

    assert values.size > _CHUNK
    assert sequential_total(values) == running


def test_restarting_each_chunk_would_be_a_different_answer() -> None:
    """Guards the guard above: the chunk carry is load-bearing, not decorative."""
    rng = np.random.default_rng(9)
    values = rng.standard_normal(_CHUNK + 5000) * 1e6

    restarted = 0.0
    for start in range(0, values.size, _CHUNK):
        restarted += float(np.cumsum(values[start : start + _CHUNK])[-1])

    assert restarted != sequential_total(values)


def test_reduces_the_last_axis_of_a_two_dimensional_array() -> None:
    """The shape ``geometric_transform`` uses: one total per row."""
    values = np.arange(12, dtype=np.float64).reshape(3, 4)

    assert sequential_sum(values).tolist() == [6, 22, 38]


def test_an_empty_axis_sums_to_zero() -> None:
    """Not one, and not an error.

    No caller reaches this today - ``correlation`` short-circuits on an empty
    image before it gets here, and the resampling plans always carry at least
    one term - so it is tested directly rather than left as a branch nothing
    exercises.
    """
    assert sequential_total(np.zeros(0, dtype=np.float64)) == 0
    assert sequential_sum(np.zeros((3, 0), dtype=np.float64)).tolist() == [0, 0, 0]
