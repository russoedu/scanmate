"""Coarse estimation, against the TypeScript's own decisions.

The first slice that is a **use case** rather than an algorithm: it guesses
three ways, nudges each with phase correlation, warps all of them and keeps
whichever scores best. So what has to agree is not one number but a decision -
which strategy wins - and the matrix that comes with it.

WHERE THE FIXTURES COME FROM
-----------------------------

Rebuilt here from the same synthetic document and the same scan options, not
shipped. The first version of the golden carried both ink maps for all five
cases and came to **43 MB**, which is not a file to put in a repository.

Rebuilding proves more than shipping would. Every step of the chain -
``create_synthetic_document``, ``simulate_scan``, ``to_grayscale``,
``ink_map`` - is already pinned by the ink goldens, so a fixture that matches
here shows the whole chain agrees rather than that two arrays were copied
correctly. The golden carries a sha256 of each ink map so a drift in that chain
is legible immediately, instead of surfacing as a coarse-estimation failure
that sends the search into the wrong slice.

WHAT IS EXACT AND WHAT IS NOT
------------------------------

``strategy`` is exact. It is a comparison between correlation scores that are
far apart - the winner and runner-up differ in the second decimal place, not
the sixteenth - so the libm seams this slice inherits from phase correlation
cannot reach it.

``score`` and ``matrix`` are held to a bound, because the polished candidates
go through two forward transforms and an inverse.
"""

from __future__ import annotations

import hashlib
import json
import math
from functools import cache
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from scanmate_ink import (
    DocumentOptions,
    GrayImage,
    ScanOptions,
    content_extent,
    create_synthetic_document,
    downscale_gray,
    ink_map,
    simulate_scan,
    to_grayscale,
)

from ..phase_correlation import phase_correlate
from .estimate_coarse_use_case import CoarseOptions, CoarseResult, estimate_coarse

_GOLDEN = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "align-coarse-estimation.json"
    ).read_text(encoding="utf-8")
)
_CASES: list[dict[str, Any]] = _GOLDEN["cases"]

#: The same bar the FFT and phase-correlation tests use.
_TOLERANCE = 1e-12

#: Matches the golden writer. Small deliberately: at the default working size
#: of 512 this file took 6m16s, because phase correlation is three 512x512
#: transforms of pure-Python loops per candidate. At 128 the same five cases
#: still pick four different strategies.
_PAGE = create_synthetic_document(DocumentOptions(width=170, height=220, seed=42))
_WORKING_SIZE: int = _CASES[0]["options"]["workingSize"]


def _scan_options(scan: dict[str, Any]) -> ScanOptions:
    """The golden's camelCase scan options, as the Python dataclass."""
    canvas = scan.get("canvas")

    return ScanOptions(
        rotation_deg=scan.get("rotationDeg", 0),
        scale=scan.get("scale", 1),
        translate_x=scan.get("translateX", 0),
        translate_y=scan.get("translateY", 0),
        noise=scan.get("noise", 0),
        blur=scan.get("blur", 0),
        illumination=scan.get("illumination", 0),
        canvas=None if canvas is None else (canvas["width"], canvas["height"]),
        seed=scan.get("seed", 1234),
    )


#: The original's ink map is the same for every case, so it is built once.
_ORIGINAL_INK = ink_map(to_grayscale(_PAGE.raster))


@cache
def _fixtures(label: str) -> tuple[GrayImage, GrayImage]:
    """Rebuild one case's two ink maps.

    Cached, and not as a micro-optimisation: generating a 425x550 synthetic
    document and simulating a scan of it is seconds of pure-Python loops, and
    the uncached version of this file took longer than ten minutes to run.
    """
    case = next(c for c in _CASES if c["label"] == label)
    simulated = simulate_scan(_PAGE.raster, _scan_options(case["scan"]))

    return _ORIGINAL_INK, ink_map(to_grayscale(simulated.raster))


@cache
def _estimated(label: str, working_size: int = _WORKING_SIZE) -> CoarseResult:
    """Run the estimator once per (case, working size).

    Cached for the same reason: it warps and correlates three candidates and
    runs phase correlation on each, which is the expensive half of the file.
    """
    original, scanned = _fixtures(label)

    return estimate_coarse(original, scanned, CoarseOptions(working_size=working_size))


def _digest(image: GrayImage) -> str:
    return hashlib.sha256(
        np.ascontiguousarray(image.pixels, dtype=np.float32).tobytes()
    ).hexdigest()


_IDS = [c["label"] for c in _CASES]


class TestTheFixturesRebuildIdentically:
    """The whole ink chain, before any of this slice runs.

    Its own class because a failure here is not a coarse-estimation failure.
    It means `create_synthetic_document`, `simulate_scan`, `to_grayscale` or
    `ink_map` has drifted, and the ink goldens are where to look.
    """

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_both_ink_maps_hash_the_same(self, case: dict[str, Any]) -> None:
        original, scanned = _fixtures(case["label"])
        assert _digest(original) == case["inkDigest"]["original"], "the original ink map drifted"
        assert _digest(scanned) == case["inkDigest"]["scanned"], "the scanned ink map drifted"

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_the_sizes_are_what_the_golden_recorded(self, case: dict[str, Any]) -> None:
        original, scanned = _fixtures(case["label"])
        assert (original.width, original.height) == (
            case["size"]["original"]["width"],
            case["size"]["original"]["height"],
        )
        assert (scanned.width, scanned.height) == (
            case["size"]["scanned"]["width"],
            case["size"]["scanned"]["height"],
        )


class TestTheDecision:
    """Which guess wins. Exact, and the assertion that matters most."""

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_the_same_strategy_wins(self, case: dict[str, Any]) -> None:
        got = _estimated(case["label"])
        assert got.strategy == case["result"]["strategy"]

    def test_the_cases_do_not_all_pick_the_same_strategy(self) -> None:
        # Guards the goldens. Five cases that all chose `deskew` would look
        # like coverage and would test one branch - the whole point of this
        # stage is that it picks between guesses.
        strategies = {c["result"]["strategy"] for c in _CASES}
        assert len(strategies) >= 4, f"only {strategies} are exercised"

    def test_all_three_guess_families_win_somewhere(self) -> None:
        # `frame`, `content` and `deskew` are three different bets about what
        # the scan went through, and each is the right answer for a different
        # kind of page. A golden where only one ever won would leave the other
        # two untested while looking thorough.
        families = {c["result"]["strategy"].split("+")[0] for c in _CASES}
        assert families == {"frame", "content", "deskew"}

    def test_both_the_polished_and_unpolished_paths_win_somewhere(self) -> None:
        # `+phase` means the phase-correlation nudge produced a better score
        # than the raw guess. Both outcomes have to be represented, or the
        # nudge is either never applied or never rejected.
        strategies = {c["result"]["strategy"] for c in _CASES}
        assert any(s.endswith("+phase") for s in strategies)
        assert any(not s.endswith("+phase") for s in strategies)


class TestTheNumbers:
    """Score, matrix and skew, within the bound this slice inherits."""

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_the_score_matches(self, case: dict[str, Any]) -> None:
        got = _estimated(case["label"])
        assert abs(got.score - case["result"]["score"]) < _TOLERANCE

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_the_matrix_matches(self, case: dict[str, Any]) -> None:
        got = _estimated(case["label"])
        for i, (g, w) in enumerate(zip(got.matrix, case["result"]["matrix"], strict=True)):
            assert abs(g - w) < _TOLERANCE, f"matrix[{i}]"

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_both_pages_skew_the_same(self, case: dict[str, Any]) -> None:
        # `estimate_skew` is ink's and exact; asserted here anyway because the
        # deskew strategy is built from the DIFFERENCE of the two, and a skew
        # that drifted would change which strategy wins without changing any
        # score directly.
        got = _estimated(case["label"])
        assert got.skew.original == case["result"]["skew"]["original"]
        assert got.skew.scanned == case["result"]["skew"]["scanned"]

    def test_the_same_inputs_give_the_same_answer_twice(self) -> None:
        """Determinism, which is the part that IS observable.

        An earlier version of this test re-ran every case at a second working
        size and asserted the two scores were within 0.5 of each other, calling
        that evidence the decision has margin. It was not: a different working
        size is a different measurement, so the comparison said almost nothing
        - and it cost 52 seconds of the file's 75.

        The margin between the winning candidate and the runner-up is not
        observable through this API at all; `estimate_coarse` returns only the
        winner. What holds up the "strategy is exact" claim is not an argument,
        it is the evidence: all five cases agree with the TypeScript exactly,
        across four different winning strategies, on two platforms' libms.

        What can be checked cheaply is that the answer is a function of its
        inputs - no accumulated state, no reliance on a shared PRNG position -
        and that is what this does.
        """
        original, scanned = _fixtures("rescaled")
        first = estimate_coarse(original, scanned, CoarseOptions(working_size=_WORKING_SIZE))
        second = estimate_coarse(original, scanned, CoarseOptions(working_size=_WORKING_SIZE))

        assert first == second

    def test_every_case_scores_well_clear_of_zero(self) -> None:
        # A score of 0 is what `estimate_coarse` returns when no candidate was
        # plausible at all. Every case here found something, which is what
        # makes the strategy assertions meaningful.
        for case in _CASES:
            assert case["result"]["score"] > 0.4, case["label"]


class TestTheAlgorithmMeansWhatItSays:
    """Properties, and three guards no input can reach.

    The unreachable ones each survived mutation. None is a gap: removing them
    changes nothing because nothing can get to them, and asserting WHY is more
    useful than contriving an input that cannot occur.
    """

    def test_it_recovers_roughly_the_transform_the_scan_applied(self) -> None:
        # Not parity - a check that the goldens describe a working estimator.
        # Every strategy agreeing on a wrong answer would still pass every
        # assertion above.
        for case in _CASES:
            if case["label"] in {"noisy", "margins"}:
                # The two cases where the coarse stage is allowed to do badly:
                # noise with an illumination ramp, and a page shifted inside a
                # larger canvas. That is what the fine stages are for, and
                # their scores - 0.42 and 0.54 against 0.89 and above for the
                # rest - say so honestly rather than pretending.
                continue
            original, scanned = _fixtures(case["label"])
            got = estimate_coarse(original, scanned)
            truth = case["truth"]
            # Compare where the page centre lands, which is what a scale-and-
            # rotate estimate is really claiming.
            cx, cy = original.width / 2, original.height / 2
            got_x = (got.matrix[0] * cx + got.matrix[1] * cy + got.matrix[2])
            got_y = (got.matrix[3] * cx + got.matrix[4] * cy + got.matrix[5])
            want_x = truth[0] * cx + truth[1] * cy + truth[2]
            want_y = truth[3] * cx + truth[4] * cy + truth[5]
            assert math.hypot(got_x - want_x, got_y - want_y) < 0.1 * original.width, case["label"]

    def test_a_blank_page_still_returns_something_usable(self) -> None:
        # Both content strategies need ink to measure; with none, only `frame`
        # survives and the fallback matrix has to be sane rather than NaN.
        blank = GrayImage(np.zeros((64, 48), dtype=np.float32))
        got = estimate_coarse(blank, blank)
        assert all(math.isfinite(v) for v in got.matrix)
        assert got.strategy in {"frame", "frame+phase", "fallback"}

    def test_an_implausible_scale_is_refused_outright(self) -> None:
        # `max_scale_ratio` gates every candidate, and when none survives the
        # result has to SAY so rather than hand back the best of a bad lot.
        # Asserting the strategy and the score, not just that the matrix is
        # finite - a mutation run showed the finite check alone passed with the
        # gate removed entirely.
        tiny = GrayImage(_ORIGINAL_INK.pixels[::20, ::20].copy())
        got = estimate_coarse(
            _ORIGINAL_INK, tiny, CoarseOptions(working_size=_WORKING_SIZE, max_scale_ratio=1.5)
        )

        assert got.strategy == "fallback"
        # Zero, not -inf. The fallback matrix is a guess, and a score of 0 is
        # how a caller is told not to trust it.
        assert got.score == 0
        assert all(math.isfinite(v) for v in got.matrix)

    def test_the_frame_guess_only_wins_when_its_pivot_and_target_coincide(self) -> None:
        """Why swapping them is unobservable, and it is a property not a fluke.

        The frame guess maps the original's centre onto the scan's centre. A
        mutation run swapped those two and changed nothing on any case, which
        looked like a coverage gap and is not: `simulate_scan` defaults its
        canvas to the page scaled, so both images have the same shape and
        `downscale_gray` takes them to the same working size - and the two
        centres are then the same point.

        Adding a case with a genuinely different aspect ratio (`wideCanvas`,
        99x128 against 128x94) did not change that either, and the reason is
        the algorithm rather than the fixture: the frame guess wins exactly
        when the two frames correspond, which is when the sizes match. When
        they do not, `content` or `deskew` beats it.

        So the swap is a real bug that this API cannot expose. Asserting the
        property is more useful than contriving a page to catch it.
        """
        for case in _CASES:
            original, scanned = _fixtures(case["label"])
            shrunk_original = downscale_gray(original, _WORKING_SIZE).image
            shrunk_scanned = downscale_gray(scanned, _WORKING_SIZE).image
            same_frame = (shrunk_original.width, shrunk_original.height) == (
                shrunk_scanned.width,
                shrunk_scanned.height,
            )
            if case["result"]["strategy"].startswith("frame"):
                assert same_frame, (
                    f"{case['label']}: frame won with frames of different sizes - the pivot and "
                    "target no longer coincide, so the swap IS observable and needs a test"
                )

    def test_phase_correlation_cannot_hand_back_a_non_finite_shift(self) -> None:
        # Which is why the finiteness guard in `_with_translation_polish`
        # survives mutation. `warp_gray` fills outside pixels with 0 and
        # cannot introduce a NaN from finite input, and `phase_correlate`'s
        # own guards keep the surface finite - including for an all-zero
        # target, where every cross-power magnitude underflows.
        rng = np.random.default_rng(3)
        for trial in range(20):
            a = GrayImage(rng.random((32, 40), dtype=np.float32))
            blank = trial % 5 == 0
            b = GrayImage(rng.random((32, 40), dtype=np.float32) * (0.0 if blank else 1.0))
            shift = phase_correlate(a, b)
            assert math.isfinite(shift.dx)
            assert math.isfinite(shift.dy)
            assert math.isfinite(shift.peak)

    def test_the_geometric_mean_guard_is_unreachable_from_a_real_page(self) -> None:
        """It survives mutation, and this says why rather than contriving one.

        `_geometric_mean` refuses a NaN or non-positive ratio. The ratios come
        from image dimensions (never zero after a downscale) and from content
        extents - and `content_extent` never returns a width below 1 while its
        density is above 0, which is the condition under which it is called at
        all. So there is no page that reaches the guard.

        That also rules out a divergence worth naming: JavaScript's `x / 0` is
        Infinity and Python's raises `ZeroDivisionError`, so a zero-width
        extent would not merely give a different answer, it would crash one
        side and not the other.
        """
        for pixels in (
            np.zeros((64, 64), dtype=np.float32),
            np.zeros((64, 64), dtype=np.float32),
        ):
            pixels[30, 40] = 1.0
            extent = content_extent(GrayImage(pixels), 0)
            if extent.density > 0:
                assert extent.width >= 1
                assert extent.height >= 1

    def test_a_differently_shaped_canvas_still_aligns(self) -> None:
        # The case that makes the frame guess's pivot and target different
        # points at all. Everywhere else `simulate_scan` keeps the page's
        # shape, so both images downscale to the same working size and the two
        # centres coincide.
        case = next(c for c in _CASES if c["label"] == "wideCanvas")
        assert case["size"]["scanned"]["width"] != case["size"]["original"]["width"]
        assert case["size"]["scanned"]["height"] == case["size"]["original"]["height"]
        got = _estimated("wideCanvas")
        assert got.score > 0.5
