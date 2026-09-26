"""What a session remembers, and when it forgets.

Tested by **behaviour**, not by the fingerprint string. That string carries
identity counters, which are per-process by definition, and the TypeScript sorts
keys with ``localeCompare`` rather than by code point - so an identical spelling
is neither achievable nor worth anything, because a cache key never crosses
between the two languages. What has to hold is the contract the key exists for:
equal settings give equal keys, different settings give different ones.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from .option_fingerprint_mapper import fingerprint
from .stage_cache_store import DOWNSTREAM, StageCache


class TestTheFingerprintContract:
    def test_equal_settings_give_equal_keys(self) -> None:
        assert fingerprint({"dpi": 300, "scope": "figures"}) == fingerprint(
            {"dpi": 300, "scope": "figures"}
        )

    def test_key_order_does_not_matter(self) -> None:
        # The whole reason this is not a plain dump: two identical bags written
        # in a different order must agree.
        assert fingerprint({"a": 1, "b": 2}) == fingerprint({"b": 2, "a": 1})

    def test_different_settings_give_different_keys(self) -> None:
        assert fingerprint({"dpi": 300}) != fingerprint({"dpi": 200})

    def test_a_setting_left_out_is_a_setting_left_at_none(self) -> None:
        # An absent key and one passed explicitly as None are the same
        # settings, and a cache that disagreed would recompute for nothing.
        assert fingerprint({"dpi": 300}) == fingerprint({"dpi": 300, "scope": None})

    def test_nesting_is_followed(self) -> None:
        assert fingerprint({"a": {"b": 1}}) != fingerprint({"a": {"b": 2}})

    def test_lists_keep_their_order(self) -> None:
        # Order is meaning in a list, unlike in a bag of settings.
        assert fingerprint({"pages": [1, 2]}) != fingerprint({"pages": [2, 1]})

    def test_a_dataclass_is_compared_by_its_fields(self) -> None:
        @dataclass(frozen=True)
        class Options:
            dpi: int
            scope: str | None = None

        assert fingerprint(Options(dpi=300)) == fingerprint(Options(dpi=300))
        assert fingerprint(Options(dpi=300)) != fingerprint(Options(dpi=200))

    def test_something_opaque_is_compared_by_identity(self) -> None:
        # A false miss costs time; a false hit returns the wrong answer. So two
        # equivalent-looking engines are NOT the same engine.
        class Engine:
            def __init__(self) -> None:
                self._state = 1

        one = Engine()
        another = Engine()

        assert fingerprint({"engine": one}) == fingerprint({"engine": one})
        assert fingerprint({"engine": one}) != fingerprint({"engine": another})

    def test_a_function_is_compared_by_identity(self) -> None:
        def predicate(text: str) -> bool:
            return text != ""

        def other(text: str) -> bool:
            return text != ""

        assert fingerprint({"keep": predicate}) == fingerprint({"keep": predicate})
        assert fingerprint({"keep": predicate}) != fingerprint({"keep": other})

    def test_pixels_are_never_stringified(self) -> None:
        # A raster would otherwise put megabytes into a cache key.
        import numpy
        from scanmate_ink import create_gray

        image = create_gray(400, 400)
        key = fingerprint({"page": image})

        assert len(key) < 120
        assert "raster:400x400" in key
        assert isinstance(image.pixels, numpy.ndarray)


class TestWhatTheCacheRemembers:
    def test_a_second_call_with_the_same_settings_does_not_recompute(self) -> None:
        cache = StageCache()
        calls = 0

        def run() -> str:
            nonlocal calls
            calls += 1

            return "aligned"

        assert cache.run("align", "fp", run) == "aligned"
        assert cache.run("align", "fp", run) == "aligned"
        assert calls == 1

    def test_different_settings_recompute(self) -> None:
        cache = StageCache()
        cache.run("align", "fp1", lambda: "one")

        assert cache.run("align", "fp2", lambda: "two") == "two"

    def test_a_failed_run_is_forgotten_so_a_retry_is_possible(self) -> None:
        # One transient failure must not make the session permanently broken.
        cache = StageCache()

        def fail() -> str:
            raise RuntimeError("the scanner was unplugged")

        with pytest.raises(RuntimeError):
            cache.run("align", "fp", fail)

        assert cache.has("align") is False
        assert cache.run("align", "fp", lambda: "recovered") == "recovered"

    def test_settled_answers_without_recomputing(self) -> None:
        cache = StageCache()
        cache.run("ocr", "fp", lambda: "read")

        assert cache.settled("ocr") == "read"
        assert cache.settled("diff") is None

    def test_clear_forgets_everything(self) -> None:
        cache = StageCache()
        cache.run("input", "fp", lambda: 1)
        cache.clear()

        assert cache.has("input") is False


class TestWhatTheCacheForgets:
    def test_re_running_a_stage_drops_what_depended_on_it(self) -> None:
        # Aligning with a different model invalidates the diff measured on the
        # old alignment, and the audit built on both.
        cache = StageCache()
        cache.run("align", "a1", lambda: "aligned")
        cache.run("diff", "d1", lambda: "diffed")
        cache.run("audit", "x1", lambda: "audited")

        cache.run("align", "a2", lambda: "realigned")

        assert cache.has("diff") is False
        assert cache.has("audit") is False

    def test_the_drop_is_transitive(self) -> None:
        # Dropping `pages` reaches everything, through align.
        cache = StageCache()
        for stage in ("pages", "align", "ocr", "find"):
            cache.run(stage, "fp", lambda: 1)

        cache.drop("pages")

        assert [s for s in ("pages", "align", "ocr", "find") if cache.has(s)] == []

    def test_filing_a_result_does_not_cascade(self) -> None:
        # `put` files a result a stage already has. Cascading from here would
        # delete that stage's own entry on the way past, and the value is
        # consistent with its dependants by construction - it is not news.
        cache = StageCache()
        cache.run("align", "a1", lambda: "aligned")
        cache.run("diff", "d1", lambda: "diffed")

        cache.put("align", "a2", "filed")

        assert cache.has("diff") is True

    def test_every_stage_appears_in_the_graph(self) -> None:
        # Otherwise `drop` raises on a stage nobody listed, and the failure
        # would surface as a KeyError in the middle of a session.
        named = set(DOWNSTREAM) | {s for following in DOWNSTREAM.values() for s in following}

        assert named == set(DOWNSTREAM)

    def test_the_graph_has_no_cycle(self) -> None:
        # `drop` recurses through it, so a cycle would not terminate.
        def reachable(stage: str, seen: frozenset[str]) -> None:
            assert stage not in seen
            for following in DOWNSTREAM[stage]:
                reachable(following, seen | {stage})

        for stage in DOWNSTREAM:
            reachable(stage, frozenset())
