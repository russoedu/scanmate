"""Page pairing, held to the TypeScript exactly."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from .page_pairing_policy import plan_pairs

_GOLDEN: dict[str, Any] = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "extract-decisions.json"
    ).read_text(encoding="utf-8")
)


@pytest.mark.parametrize("name", sorted(_GOLDEN["planPairs"]))
def test_matches_the_typescript(name: str) -> None:
    case = _GOLDEN["planPairs"][name]
    pairing = case["pairing"]
    plan = plan_pairs(
        case["originalCount"],
        case["scannedCount"],
        pairing if pairing == "index" else [tuple(p) for p in pairing],
    )
    want = case["plan"]

    assert [list(p) for p in plan.pairs] == want["pairs"]
    assert plan.unpaired.original == want["unpaired"]["original"]
    assert plan.unpaired.scanned == want["unpaired"]["scanned"]


class TestWhatIsLeftOver:
    def test_a_scan_that_lost_a_page_reports_it(self) -> None:
        # The whole reason unpaired exists: a missing page is one of the things
        # a returned document is checked for, so it is reported rather than
        # showing up as a shorter list nobody looks at.
        plan = plan_pairs(3, 2, "index")

        assert plan.pairs == [(1, 1), (2, 2)]
        assert plan.unpaired.original == [3]
        assert plan.unpaired.scanned == []

    def test_a_scan_with_an_extra_page_reports_it(self) -> None:
        plan = plan_pairs(2, 3, "index")

        assert plan.unpaired.scanned == [3]

    def test_explicit_pairing_can_reorder(self) -> None:
        # Scans come back out of order, so pairing is a decision the caller
        # makes rather than something assumed.
        plan = plan_pairs(3, 3, [(3, 1), (1, 3)])

        assert plan.pairs == [(3, 1), (1, 3)]
        assert plan.unpaired.original == [2]
        assert plan.unpaired.scanned == [2]

    def test_pairing_nothing_leaves_everything_unpaired(self) -> None:
        plan = plan_pairs(2, 2, [])

        assert plan.pairs == []
        assert plan.unpaired.original == [1, 2]
        assert plan.unpaired.scanned == [1, 2]

    def test_an_original_used_twice_is_allowed_and_counted_once(self) -> None:
        plan = plan_pairs(3, 3, [(1, 1), (1, 2)])

        assert plan.pairs == [(1, 1), (1, 2)]
        assert plan.unpaired.original == [2, 3]


@pytest.mark.parametrize(
    ("args", "key"),
    [
        ((2, 2, [(3, 1)]), "pastTheEnd"),
        ((2, 2, [(1, 5)]), "scanPastEnd"),
        ((2, 2, [(0, 1)]), "pageZero"),
    ],
)
def test_refuses_a_page_outside_its_document(args: tuple[Any, ...], key: str) -> None:
    with pytest.raises(ValueError) as raised:
        plan_pairs(*args)

    assert str(raised.value) == _GOLDEN["planPairsRejects"][key]
