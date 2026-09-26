"""What a session remembers, and when it forgets.

**A stage that re-runs drops everything downstream of it.** Aligning with a
different model invalidates the diff that was measured on the old alignment, and
the audit built on both. :data:`DOWNSTREAM` is that relationship, written once,
rather than a rule remembered at each call site.

.. note::
   The TypeScript caches **promises**, not values, so a second call arriving
   while the first is still running joins it rather than starting a rival run -
   without which ``Promise.all([session.ocr(), session.diff()])`` would align
   the document twice. Nothing here is asynchronous, so there is no in-flight
   run to join and values are cached directly. The rest is the same, including
   evicting a failed run so one transient failure does not make the session
   permanently broken.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, TypeAlias, TypeVar

CachedStage: TypeAlias = Literal[
    "input", "pages", "align", "prepare", "enhance", "ocr", "diff", "checkboxes", "find", "audit"
]

#: What each stage's result feeds. Transitive: dropping ``pages`` drops all of it.
DOWNSTREAM: dict[str, tuple[str, ...]] = {
    "input": ("pages",),
    "pages": ("align",),
    "align": ("prepare", "enhance", "diff", "checkboxes", "audit"),
    # What the document chose to read under feeds every reader, and nothing else.
    "prepare": ("ocr", "audit"),
    "enhance": ("ocr", "audit"),
    "ocr": ("find", "audit"),
    "diff": ("audit",),
    "checkboxes": (),
    "find": (),
    "audit": (),
}

_Result = TypeVar("_Result")


@dataclass(slots=True)
class _Entry:
    fingerprint: str
    value: Any


class StageCache:
    """A session's memory of what it has already computed."""

    def __init__(self) -> None:
        self._entries: dict[str, _Entry] = {}

    def run(
        self, stage: CachedStage, fingerprint: str, start: Callable[[], _Result]
    ) -> _Result:
        """The cached result for this stage with these settings, or a fresh one.

        Running afresh drops whatever depended on the old answer.

        :param stage: Which stage.
        :param fingerprint: A key for the settings it would run with.
        :param start: How to compute it, when it has to be computed.
        :returns: The result.
        :raises Exception: Whatever ``start`` raises, after forgetting the
            stage so a retry is possible.
        """
        entry = self._entries.get(stage)
        if entry is not None and entry.fingerprint == fingerprint:
            return entry.value  # type: ignore[no-any-return]

        self.drop(stage)
        try:
            value = start()
        except Exception:
            # A failure is not an answer: forget it so a retry is possible.
            self._entries.pop(stage, None)
            raise
        self._entries[stage] = _Entry(fingerprint=fingerprint, value=value)

        return value

    def put(self, stage: CachedStage, fingerprint: str, value: _Result) -> None:
        """File a result this session already has.

        Unlike :meth:`run`, this does **not** drop what lies downstream. The
        result being filed was produced by a stage that is still settling - an
        audit handing back the reading and the pixels it just computed - and
        cascading a drop from here would delete that audit's own entry on the
        way past. The value is consistent with its dependants by construction;
        it is not news.

        :param stage: Which stage.
        :param fingerprint: A key for the settings it was made with.
        :param value: The result.
        """
        self._entries[stage] = _Entry(fingerprint=fingerprint, value=value)

    def settled(self, stage: CachedStage) -> Any:
        """The stored result, or ``None`` when the stage has not run."""
        entry = self._entries.get(stage)

        return None if entry is None else entry.value

    def has(self, stage: CachedStage) -> bool:
        """Whether the stage has a result on file."""
        return stage in self._entries

    def drop(self, stage: CachedStage) -> None:
        """Forget this stage and everything that was computed from it."""
        self._entries.pop(stage, None)
        for following in DOWNSTREAM[stage]:
            self.drop(following)  # type: ignore[arg-type]

    def clear(self) -> None:
        """Forget everything."""
        self._entries.clear()
