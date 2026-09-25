"""Which transform to believe, when more than one fits.

More degrees of freedom always fit at least as well, so a plain "highest
confidence wins" would drift towards the most flexible model on every input. On
a flatbed scan that is wrong in a way nothing downstream would notice: a
homography fitted to a flat page bends slightly to follow the page's own noise,
beats the similarity on ink correlation by a hair, passes ``is_plausible``, and
puts every region a pixel or two off. So a more complex model has to *earn* its
extra parameters by a margin, and a simpler one within that margin is kept.
"""

from __future__ import annotations

from dataclasses import dataclass

from scanmate_ink import TransformModel

#: Ascending cost, ascending fragility: the order a sweep should try them in.
DEFAULT_MODELS: tuple[TransformModel, ...] = ("similarity", "affine", "homography")

_DEGREES_OF_FREEDOM: dict[TransformModel, int] = {
    "similarity": 4,
    "affine": 6,
    "homography": 8,
}


@dataclass(frozen=True, slots=True)
class ScoredModel:
    """A fitted model and how well it did."""

    model: TransformModel
    confidence: float


def prefers(candidate: ScoredModel, incumbent: ScoredModel | None, margin: float) -> bool:
    """Should ``candidate`` replace ``incumbent`` as the answer?

    - A more complex candidate must beat the incumbent by more than ``margin``.
    - A simpler candidate wins if it comes within ``margin`` of the incumbent.
    - An equally complex one simply has to do better.

    Symmetric on purpose, so the answer does not depend on the order the models
    were tried in: whatever order ``models`` names, the simplest model within
    the margin of the best is the one returned.

    :param candidate: The model just fitted.
    :param incumbent: The best so far, or ``None`` on the first attempt.
    :param margin: How much a more complex model must win by.
    :returns: ``True`` when the candidate should take over.
    """
    if incumbent is None:
        return True

    extra = _DEGREES_OF_FREEDOM[candidate.model] - _DEGREES_OF_FREEDOM[incumbent.model]
    if extra > 0:
        return candidate.confidence > incumbent.confidence + margin
    if extra < 0:
        return candidate.confidence >= incumbent.confidence - margin

    return candidate.confidence > incumbent.confidence


def sweep_order(models: tuple[TransformModel, ...] | list[TransformModel]) -> list[TransformModel]:
    """The models to sweep, in the order given, each once.

    :param models: The families to try.
    :returns: The same list with duplicates removed, order preserved.
    :raises ValueError: On an empty list, rather than silently fitting nothing.
        (The TypeScript throws ``RangeError``, which Python spells ``ValueError``
        for an argument whose type is right and whose value is not.)
    """
    unique = list(dict.fromkeys(models))
    if len(unique) == 0:
        message = "models must name at least one transform model"
        raise ValueError(message)

    return unique
