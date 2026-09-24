"""Global translation from the Fourier shift theorem.

Shifting an image does not change the magnitude of its spectrum, only the
phase - and it changes the phase by an amount proportional to the shift. So
divide out the magnitudes entirely, keep the phase difference, transform back,
and what comes out is a single spike at the offset between the two images.

Its value here is that it does not care what is *on* the page. Feature matching
needs corners to match; a mostly blank form does not have enough of them, and
neither does a page that scanned faint. Phase correlation uses every pixel at
once, which makes it the fallback when features fail, and a good final polish
when they succeed.

It only finds translation. Rotation and scale have to be dealt with first.

THIS SLICE INHERITS THE FFT'S ONE INEXACTNESS
----------------------------------------------

:func:`~scanmate_ink.fft2d` is the one thing in ``scanmate-ink`` that cannot be
bit-exact against V8, because ``sin(+/- pi / 4)`` differs by one unit in the
last place between MSVC's libm (correctly rounded) and glibc's (which agrees
with V8). Everything here runs through two forward transforms and one inverse,
so the same seam runs through ``dx``, ``dy`` and ``peak``.

The parity tests therefore compare those three against a measured bound rather
than ``==``, exactly as the FFT's own tests do - and the parts that do NOT go
through the transform (the Hann window, the parabolic vertex, the wrap) are
held to ``==``, because there is no reason for them not to be.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from scanmate_ink import GrayImage, fft2d, hypot2, next_power_of_two


@dataclass(frozen=True, slots=True)
class PhaseCorrelationResult:
    """Where the spike landed, and how much of one it was."""

    #: Shift that takes ``a`` onto ``b``: a feature at ``p`` in ``a`` sits at
    #: ``p + (dx, dy)`` in ``b``.
    dx: float
    dy: float
    #: Height of the correlation spike. Near 1 is a clean single answer; near
    #: 0 is noise.
    peak: float


def phase_correlate(a: GrayImage, b: GrayImage) -> PhaseCorrelationResult:
    """Correlate two equally sized images.

    Both are Hann-windowed first. Without it the FFT sees the frame edges as a
    hard discontinuity repeating forever, and that cross pattern in the
    spectrum can be a stronger signal than the page.

    :param a: The reference image.
    :param b: The image to locate within it.
    :returns: The shift that takes ``a`` onto ``b``, and the peak height.
    :raises ValueError: When the two images are not the same size.
    """
    if a.width != b.width or a.height != b.height:
        message = "phase_correlate needs two images of the same size"
        raise ValueError(message)

    width = next_power_of_two(a.width)
    height = next_power_of_two(a.height)
    size = width * height

    a_re = np.zeros(size, dtype=np.float64)
    a_im = np.zeros(size, dtype=np.float64)
    b_re = np.zeros(size, dtype=np.float64)
    b_im = np.zeros(size, dtype=np.float64)

    window_x = hann(a.width)
    window_y = hann(a.height)

    # The TypeScript multiplies `windowX[x] * windowY[y]` per pixel. The outer
    # product is the same product in the other order, and float multiplication
    # is commutative to the bit, so this is equality rather than equivalence.
    window = np.outer(window_y, window_x)
    a_re.reshape(height, width)[: a.height, : a.width] = (
        a.pixels[: a.height, : a.width].astype(np.float64) * window
    )
    b_re.reshape(height, width)[: b.height, : b.width] = (
        b.pixels[: b.height, : b.width].astype(np.float64) * window
    )

    fft2d(a_re, a_im, width, height)
    fft2d(b_re, b_im, width, height)

    # Cross-power spectrum of b against a, normalised to unit magnitude so that
    # every frequency contributes its phase and nothing else.
    re = b_re * a_re + b_im * a_im
    im = b_im * a_re - b_re * a_im
    magnitude = hypot2(re, im)
    tiny = magnitude < 1e-12
    safe = np.where(tiny, 1.0, magnitude)
    b_re[:] = np.where(tiny, 0.0, re / safe)
    b_im[:] = np.where(tiny, 0.0, im / safe)

    fft2d(b_re, b_im, width, height, True)

    # `argmax` takes the FIRST maximum, which is what the TypeScript's strict
    # `>` against a running best does. A later `>=` there, or `argmax` picking
    # the last, would put the answer a whole pixel away on a tie - and ties are
    # not exotic on a blank page, where the surface is flat.
    peak_index = int(np.argmax(b_re))
    peak_value = float(b_re[peak_index])

    px = peak_index % width
    py = peak_index // width

    dx = _wrap(
        px
        + _parabolic(
            _sample(b_re, width, height, px - 1, py),
            peak_value,
            _sample(b_re, width, height, px + 1, py),
        ),
        width,
    )
    dy = _wrap(
        py
        + _parabolic(
            _sample(b_re, width, height, px, py - 1),
            peak_value,
            _sample(b_re, width, height, px, py + 1),
        ),
        height,
    )

    return PhaseCorrelationResult(dx=dx, dy=dy, peak=peak_value)


def _parabolic(left: float, center: float, right: float) -> float:
    """Sub-pixel offset of a peak, from a parabola through it and its neighbours.

    The correlation surface is sampled on the pixel grid, but the true offset
    is not a whole number of pixels. Three samples determine a parabola, and
    its vertex is a better estimate than the middle sample - typically to about
    a tenth of a pixel.

    :param left: The sample before the peak.
    :param center: The peak itself.
    :param right: The sample after it.
    :returns: The offset from ``center``, or 0 when the fit is degenerate or
        lands further than a whole pixel away (which means the three samples
        did not describe a peak at all).
    """
    denominator = left - 2 * center + right
    if abs(denominator) < 1e-12:
        return 0.0

    offset = (0.5 * (left - right)) / denominator

    return offset if abs(offset) < 1 else 0.0


def _sample(data: NDArray[np.float64], width: int, height: int, x: int, y: int) -> float:
    """One value, with the grid wrapping at both edges.

    The TypeScript writes ``((x % width) + width) % width`` because JavaScript's
    ``%`` keeps the sign of the dividend. Python's already returns a
    non-negative result for a positive modulus, so the dance is unnecessary -
    and the two expressions agree on every input, negative ones included.
    """
    return float(data[(y % height) * width + (x % width)])


def _wrap(value: float, n: int) -> float:
    """Map an index in ``[0, n)`` onto a signed shift in ``[-n/2, n/2)``."""
    return value - n if value > n / 2 else value


def hann(n: int) -> NDArray[np.float64]:
    """The Hann window of length ``n``.

    Exported because the goldens hold it to ``==`` on its own: it is one of the
    few things here that does not go through the FFT, so there is no reason for
    it to be merely close.

    :param n: The window length.
    :returns: The window, as float64.
    """
    w = np.zeros(n, dtype=np.float64)
    if n == 1:
        w[0] = 1

        return w
    for i in range(n):
        w[i] = 0.5 * (1 - math.cos((2 * math.pi * i) / (n - 1)))

    return w
