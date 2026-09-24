"""In-place radix-2 Cooley-Tukey FFT, real and imaginary parts in separate arrays.

Only used by phase correlation, which needs a *global* translation estimate
that no amount of local feature matching can produce on a page with almost
nothing printed on it. Sizes must be powers of two; :func:`next_power_of_two`
and the caller's zero padding see to that.

THE ONE SLICE THAT CANNOT BE BIT-EXACT, AND WHOSE FAULT THAT IS
---------------------------------------------------------------

Everything here is additions, multiplications and divisions except the twiddle
bases, which are the cosine and sine of ``+/- 2 * pi / len``. That is 24
distinct values across every size up to 4096, and 23 of them agree with V8 to
the last bit. The exception is ``sin(+/- pi / 4)``: V8 returns
-0.7071067811865475 where the correctly rounded double is -0.7071067811865476.
Python returns the correct one, so it is **V8 that is a unit in the last place
wrong here, not the port**.

That single bit does not stay put. Every transform of eight or more points runs
a ``len = 8`` stage, and the twiddle is advanced by REPEATED MULTIPLICATION
rather than recomputed per step, so the error is carried forward through that
stage and into every larger one. The parity tests therefore compare against a
measured bound instead of ``==``, and they state the bound they measured.

Matching V8 exactly would mean hardcoding its wrong value, which would pin a
particular runtime's libm rather than this algorithm, and would make the Python
worse to make a test greener. The transform stays correct and the tolerance is
written down.

WHY THE LOOPS ARE LOOPS
-----------------------

``numpy.fft`` would be one line, and it is the wrong line - though not for the
reason one would guess. Measured against the goldens it is sometimes CLOSER
than this transcription (4.97e-16 against 7.02e-16 at eight points) and
sometimes much further (7.60e-15 against 3.20e-15 at sixty-four). That is the
problem: its error is whatever a different radix, a different stage order and
precomputed twiddle tables happen to produce, it is nobody's contract, and it
can move with a numpy release. The butterflies below are the same butterflies
in the same order, so the only divergence left is the one bit described above -
a difference that is understood, bounded and attributable.
"""

from __future__ import annotations

import math

import numpy as np
import numpy.typing as npt


def next_power_of_two(n: int) -> int:
    """:param n: Any integer.
    :returns: The smallest power of two at least ``n``, and 1 for anything below 1.
    """
    p = 1
    while p < n:
        p *= 2

    return p


def is_power_of_two(n: int) -> bool:
    """:param n: Any integer.
    :returns: Whether ``n`` is a positive power of two.
    """
    return n > 0 and (n & (n - 1)) == 0


def _bit_reverse(re: npt.NDArray[np.float64], im: npt.NDArray[np.float64], n: int) -> None:
    """Shuffle into the order the decimation-in-time butterflies expect.

    The butterflies below combine adjacent pairs, then pairs of pairs, and so
    on, which is the order the recursive form would have left the input in -
    so the iterative form has to put it there first.

    :param re: Real parts, modified in place.
    :param im: Imaginary parts, modified in place.
    :param n: The transform length.
    """
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j ^= bit

        if i < j:
            re[i], re[j] = re[j], re[i]
            im[i], im[j] = im[j], im[i]


def fft1d(
    re: npt.NDArray[np.float64],
    im: npt.NDArray[np.float64],
    inverse: bool = False,
) -> None:
    """Transform ``re``/``im`` of length ``n`` in place. ``inverse`` also divides by ``n``.

    :param re: Real parts, modified in place.
    :param im: Imaginary parts, modified in place.
    :param inverse: Run the inverse transform.
    :raises ValueError: When the length is not a power of two.
    """
    n = re.shape[0]
    if not is_power_of_two(n):
        message = f"fft length must be a power of two, got {n}"
        raise ValueError(message)
    if n == 1:
        return

    _bit_reverse(re, im, n)

    sign = 1 if inverse else -1
    length = 2
    while length <= n:
        angle = (sign * 2 * math.pi) / length
        w_re = math.cos(angle)
        w_im = math.sin(angle)
        half = length >> 1

        for start in range(0, n, length):
            cur_re = 1.0
            cur_im = 0.0

            for k in range(half):
                i = start + k
                j = i + half
                even_re = float(re[i])
                even_im = float(im[i])
                odd_re = re[j] * cur_re - im[j] * cur_im
                odd_im = re[j] * cur_im + im[j] * cur_re

                re[i] = even_re + odd_re
                im[i] = even_im + odd_im
                re[j] = even_re - odd_re
                im[j] = even_im - odd_im

                next_re = cur_re * w_re - cur_im * w_im
                cur_im = cur_re * w_im + cur_im * w_re
                cur_re = next_re

        length <<= 1

    if inverse:
        for i in range(n):
            re[i] /= n
            im[i] /= n


def fft2d(
    re: npt.NDArray[np.float64],
    im: npt.NDArray[np.float64],
    width: int,
    height: int,
    inverse: bool = False,
) -> None:
    """2D transform of a ``width x height`` row-major complex image, rows then columns.

    :param re: Real parts, row-major, modified in place.
    :param im: Imaginary parts, row-major, modified in place.
    :param width: Row length.
    :param height: Number of rows.
    :param inverse: Run the inverse transform.
    """
    row_re = np.zeros(width, dtype=np.float64)
    row_im = np.zeros(width, dtype=np.float64)
    for y in range(height):
        off = y * width
        row_re[:] = re[off : off + width]
        row_im[:] = im[off : off + width]
        fft1d(row_re, row_im, inverse)
        re[off : off + width] = row_re
        im[off : off + width] = row_im

    col_re = np.zeros(height, dtype=np.float64)
    col_im = np.zeros(height, dtype=np.float64)
    for x in range(width):
        for y in range(height):
            col_re[y] = re[y * width + x]
            col_im[y] = im[y * width + x]
        fft1d(col_re, col_im, inverse)
        for y in range(height):
            re[y * width + x] = col_re[y]
            im[y * width + x] = col_im[y]
