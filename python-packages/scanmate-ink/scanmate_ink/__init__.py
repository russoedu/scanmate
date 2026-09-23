"""scanmate-ink: the numeric core, ported from @scanmate/ink.

A parallel port, not a rewrite. The TypeScript remains the reference, and every
subfeature here is measured against goldens produced by running the real
TypeScript build - see ``tools/parity``.
"""

from .deterministic_sampling import create_random, gaussian

__all__ = ["create_random", "gaussian"]
