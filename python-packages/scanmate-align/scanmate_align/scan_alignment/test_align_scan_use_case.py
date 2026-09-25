"""The whole alignment, end to end, against the TypeScript's own decisions.

This is the last slice, and the one where a mismatch could come from anywhere:
the coarse strategy, the feature counts, the match count, which models RANSAC
could fit at all, which one the preference margin selected, or whether the sweep
stopped early. Every one of those is asserted separately, so a failure names the
stage rather than the pipeline.

TWO FIELDS ARE NOT IN THE GOLDEN, AND BOTH ABSENCES ARE DELIBERATE
-------------------------------------------------------------------

``duration_ms`` is wall-clock time. Shipping it would either make the
comparison fail forever or teach a reader that some fields here are decorative.

``image`` is PNG bytes - libvips on one side, Pillow on the other. They are
different encoders writing the same pixels, and the pixels are ``raster``, which
IS compared, by digest. The codec is ink's business and ink's goldens cover it.

THE ONE DEPARTURE IN THE PORT'S CALLING CONVENTION
---------------------------------------------------

``alignScan`` is ``async`` and :func:`align_scan` is not. The TypeScript's
asynchrony is about libvips on libuv's threadpool, not about the algorithm;
Python's codec is Pillow and synchronous, so an ``async def`` would be a
coroutine that never yields. Every number is still the TypeScript's, which is
what this file is for.
"""

from __future__ import annotations

import hashlib
import json
import math
from functools import cache
from pathlib import Path
from typing import Any

import pytest
from scanmate_ink import (
    IDENTITY,
    DocumentOptions,
    Raster,
    ScanOptions,
    TransformModel,
    create_synthetic_document,
    downscale_gray,
    ink_map,
    simulate_scan,
    to_grayscale,
)

from .align_result_contract import AlignOptions, AlignResult
from .align_scan_use_case import align_scan
from .alignment_referee_use_case import create_referee, to_confidence
from .model_selection_policy import DEFAULT_MODELS, ScoredModel, prefers, sweep_order

_GOLDEN = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "align-scan-alignment.json"
    ).read_text(encoding="utf-8")
)
_CASES: list[dict[str, Any]] = _GOLDEN["cases"]
_IDS = [c["label"] for c in _CASES]

#: The bar every inexact slice in this port uses.
_TOLERANCE = 1e-12

_PAGE = create_synthetic_document(
    DocumentOptions(
        width=_GOLDEN["page"]["width"],
        height=_GOLDEN["page"]["height"],
        seed=_GOLDEN["page"]["seed"],
    )
)


def _decode(value: float | str) -> float:
    """``"NaN"`` back to a float.

    JSON has no literal for NaN, and `JSON.stringify` writes `null` - which
    would make the golden say "no value" where it means "not a number". A
    rejected model attempt carries NaN by design, so the encoding is
    load-bearing rather than tidy.
    """
    return float(value) if isinstance(value, str) else value


def _scan_options(scan: dict[str, Any]) -> ScanOptions:
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


def _align_options(align: dict[str, Any]) -> AlignOptions:
    """The golden's base options plus this case's overrides, as the dataclass."""
    base = _GOLDEN["options"]
    models = align.get("models")

    return AlignOptions(
        working_size=align.get("workingSize", base["workingSize"]),
        coarse_size=base["coarseSize"],
        max_features=base["maxFeatures"],
        output=base["output"],
        model=align.get("model", "all"),
        confidence_target=align.get("confidenceTarget", 0.9),
        models=None if models is None else tuple(models),
        min_inliers=align.get("minInliers", 12),
    )


@cache
def _aligned(label: str) -> AlignResult:
    """One case's result. Cached: a full alignment is seconds of Python.

    Most cases align the synthetic page against a simulated scan of it. The
    `skewedOriginal` case is a scan of a *skewed* page, so it carries a second
    set of scan options under `nested` - that is what gives the ORIGINAL a skew
    of its own, and 0 radians being 0 degrees is why every other case leaves the
    radians-to-degrees conversion on that field unobservable.
    """
    case = next(c for c in _CASES if c["label"] == label)
    original: Raster = _PAGE.raster
    nested = case.get("nested")
    if nested is not None:
        original = simulate_scan(_PAGE.raster, _scan_options(case["scan"])).raster
        scanned: Raster = simulate_scan(original, _scan_options(nested)).raster
    else:
        scanned = simulate_scan(_PAGE.raster, _scan_options(case["scan"])).raster

    return align_scan(original, scanned, _align_options(case["align"]))


def _original_raster(label: str) -> Raster:
    """The raster this case aligns ONTO, which is not always the synthetic page."""
    case = next(c for c in _CASES if c["label"] == label)
    if case.get("nested") is None:
        return _PAGE.raster

    return simulate_scan(_PAGE.raster, _scan_options(case["scan"])).raster


class TestTheDecisions:
    """What the pipeline concluded. Exact, and asserted one stage at a time."""

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_the_coarse_stage_agrees(self, case: dict[str, Any]) -> None:
        # First, because everything after it depends on it - a coarse strategy
        # that diverged would move the features, the matches and the models.
        got = _aligned(case["label"]).diagnostics
        want = case["result"]["diagnostics"]
        assert got.coarse_strategy == want["coarseStrategy"]
        assert abs(got.coarse_score - want["coarseScore"]) < _TOLERANCE

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_the_feature_stage_agrees(self, case: dict[str, Any]) -> None:
        got = _aligned(case["label"]).diagnostics
        want = case["result"]["diagnostics"]
        assert got.features.original == want["features"]["original"]
        assert got.features.scanned == want["features"]["scanned"]
        assert got.matches == want["matches"]

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_every_model_attempt_agrees(self, case: dict[str, Any]) -> None:
        # Including the rejected ones. The attempt list's LENGTH is what says
        # whether the sweep stopped early, which is a decision in its own right.
        got = _aligned(case["label"]).diagnostics.attempts
        want = case["result"]["diagnostics"]["attempts"]
        assert len(got) == len(want), "the sweep ran a different number of models"

        for i, (g, w) in enumerate(zip(got, want, strict=True)):
            assert g.model == w["model"], i
            assert g.rejected == w["rejected"], i
            assert g.selected == w["selected"], i
            assert g.inliers == w["inliers"], i
            if w["confidence"] is None:
                assert g.confidence is None, i
            else:
                assert g.confidence is not None
                assert abs(g.confidence - w["confidence"]) < _TOLERANCE, i
            # NaN on a rejected attempt, and `NaN == NaN` is false in both
            # languages - so the comparison has to be about NaN-ness.
            want_error = _decode(w["reprojectionError"])
            if math.isnan(want_error):
                assert math.isnan(g.reprojection_error), i
            else:
                assert abs(g.reprojection_error - want_error) < _TOLERANCE, i

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_the_headline_reprojection_error_agrees(self, case: dict[str, Any]) -> None:
        # NaN when the coarse estimate stood alone, which is the honest answer:
        # there were no inliers to measure a reprojection over.
        got = _aligned(case["label"]).diagnostics.reprojection_error
        want = _decode(case["result"]["diagnostics"]["reprojectionError"])
        if math.isnan(want):
            assert math.isnan(got)
        else:
            assert abs(got - want) < _TOLERANCE

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_the_selected_model_and_method_agree(self, case: dict[str, Any]) -> None:
        got = _aligned(case["label"])
        want = case["result"]
        assert got.method == want["method"]
        assert got.diagnostics.selected_model == want["diagnostics"]["selectedModel"]


class TestTheNumbers:
    """The transform and the scores."""

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_the_matrix_and_its_inverse_agree(self, case: dict[str, Any]) -> None:
        got = _aligned(case["label"])
        want = case["result"]
        for i, (g, w) in enumerate(zip(got.matrix, want["matrix"], strict=True)):
            assert abs(g - w) < _TOLERANCE, f"matrix[{i}]"
        for i, (g, w) in enumerate(zip(got.inverse, want["inverse"], strict=True)):
            assert abs(g - w) < _TOLERANCE, f"inverse[{i}]"

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_the_decomposed_summary_agrees(self, case: dict[str, Any]) -> None:
        # What a caller actually reads - "how far was it turned, how much
        # bigger is it" - rather than the nine numbers behind it.
        got = _aligned(case["label"]).transform
        want = case["result"]["transform"]
        assert got.model == want["model"]
        assert abs(got.rotation_deg - want["rotationDeg"]) < _TOLERANCE
        assert abs(got.scale_x - want["scaleX"]) < _TOLERANCE
        assert abs(got.scale_y - want["scaleY"]) < _TOLERANCE
        assert abs(got.shear_deg - want["shearDeg"]) < _TOLERANCE
        assert abs(got.translation.x - want["translation"]["x"]) < _TOLERANCE
        assert abs(got.translation.y - want["translation"]["y"]) < _TOLERANCE
        # Zero for everything but a homography, and that is the point: a
        # similarity reporting perspective would mean the decomposition had
        # attributed the page's noise to a parameter the model does not have.
        assert abs(got.perspective.x - want["perspective"]["x"]) < _TOLERANCE
        assert abs(got.perspective.y - want["perspective"]["y"]) < _TOLERANCE

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_the_confidence_and_agreement_scores_agree(self, case: dict[str, Any]) -> None:
        got = _aligned(case["label"])
        want = case["result"]
        assert abs(got.confidence - want["confidence"]) < _TOLERANCE
        assert (
            abs(got.diagnostics.correlation - want["diagnostics"]["correlation"]) < _TOLERANCE
        )
        assert (
            abs(
                got.diagnostics.intersection_over_union
                - want["diagnostics"]["intersectionOverUnion"]
            )
            < _TOLERANCE
        )

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_both_pages_skew_the_same_in_degrees(self, case: dict[str, Any]) -> None:
        got = _aligned(case["label"]).diagnostics.skew_deg
        want = case["result"]["diagnostics"]["skewDeg"]
        assert abs(got.original - want["original"]) < _TOLERANCE
        assert abs(got.scanned - want["scanned"]) < _TOLERANCE


class TestTheOutput:
    """The pixels, and the canvas they sit on."""

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_the_warped_raster_is_byte_identical(self, case: dict[str, Any]) -> None:
        # By digest, because the raster is 208,000 bytes and there are six
        # cases. This is the real output: every number above is a claim about
        # how it was reached.
        got = _aligned(case["label"])
        digest = hashlib.sha256(got.raster.pixels.tobytes()).hexdigest()
        assert digest == case["rasterDigest"]

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_it_sits_on_the_originals_canvas(self, case: dict[str, Any]) -> None:
        # The whole promise of the package: every coordinate known from the PDF
        # still means what it meant.
        got = _aligned(case["label"])
        original = _original_raster(case["label"])
        assert (got.width, got.height) == (case["result"]["width"], case["result"]["height"])
        assert got.width == original.width
        assert got.height == original.height

    @pytest.mark.parametrize("case", _CASES, ids=_IDS)
    def test_the_dpi_is_none_rather_than_invented(self, case: dict[str, Any]) -> None:
        assert _aligned(case["label"]).dpi is None
        assert case["result"]["dpi"] is None

    def test_output_none_skips_the_encode(self) -> None:
        # Which is most of the cost on a big page, and is why every case here
        # uses it.
        assert _GOLDEN["options"]["output"] == "none"
        assert _aligned("flatbed").image is None


class TestTheGoldensDiscriminate:
    """What the six cases between them actually exercise."""

    def test_both_methods_are_represented(self) -> None:
        # `coarse` is the path a real batch hits on a blank continuation sheet,
        # and without a case for it the fallback is untested.
        assert {c["result"]["method"] for c in _CASES} == {"coarse", "features"}

    def test_all_three_models_get_selected_somewhere(self) -> None:
        assert {c["result"]["diagnostics"]["selectedModel"] for c in _CASES} == {
            "similarity",
            "affine",
            "homography",
        }

    def test_the_sweep_both_stops_early_and_runs_to_the_end(self) -> None:
        # The attempt count is the evidence. One model tried means either a
        # named model or an immediate win; three means the target was never
        # reached and the preference margin decided.
        counts = {len(c["result"]["diagnostics"]["attempts"]) for c in _CASES}
        assert 1 in counts
        assert 3 in counts

    def test_a_rejected_attempt_is_represented(self) -> None:
        assert any(
            a["rejected"] for c in _CASES for a in c["result"]["diagnostics"]["attempts"]
        )

    def test_a_real_downscale_is_represented(self) -> None:
        # Without one, `prepared.scale` is always 1 and the step that lifts a
        # RANSAC residual back to full resolution is the identity. A mutation
        # run found exactly that: removing it changed no golden.
        assert any(c["align"].get("workingSize", 320) < _PAGE.raster.width for c in _CASES)

    def test_an_original_with_its_own_skew_is_represented(self) -> None:
        # 0 radians is 0 degrees, so a page that is not skewed cannot tell a
        # radians-to-degrees conversion from its absence.
        assert any(c["result"]["diagnostics"]["skewDeg"]["original"] != 0 for c in _CASES)

    def test_a_confidence_target_that_is_exactly_reached_is_represented(self) -> None:
        # The check is `>=`. This is the one input where `>` gives a different
        # answer - the sweep stops after one model instead of trying a second -
        # and the target is taken from a confidence the sweep really reaches
        # rather than typed in.
        case = next(c for c in _CASES if c["label"] == "exactTarget")
        target = case["align"]["confidenceTarget"]
        first = case["result"]["diagnostics"]["attempts"][0]["confidence"]
        assert first == target
        assert len(case["result"]["diagnostics"]["attempts"]) == 1

    def test_a_warp_the_prefilter_actually_blurs_is_represented(self) -> None:
        # It fires above `sqrt(|det|) > 1.25` and blurs by `(scale - 1) / 2`,
        # which rounds to a radius of ZERO until the scale reaches 2. So a case
        # at 1.4 or 1.6 trips the condition and blurs by nothing - which is why
        # turning the prefilter off changed no golden until this case existed.
        reached = [
            c["label"]
            for c in _CASES
            if math.sqrt(
                abs(
                    c["result"]["matrix"][0] * c["result"]["matrix"][4]
                    - c["result"]["matrix"][1] * c["result"]["matrix"][3]
                )
            )
            >= 2
        ]
        assert reached != [], "no warp minifies enough for the prefilter to blur by a whole pixel"

    def test_a_nan_reprojection_error_is_represented_and_encoded(self) -> None:
        # Both halves matter. A rejected attempt carries NaN by design, and
        # `JSON.stringify(NaN)` is `null` - so without the string encoding the
        # golden would say "no value" where it means "not a number", and a port
        # returning 0 would pass.
        encoded = [
            a["reprojectionError"]
            for c in _CASES
            for a in c["result"]["diagnostics"]["attempts"]
        ]
        assert "NaN" in encoded
        assert None not in encoded


class TestModelSelectionIsOrderIndependent:
    """The property `prefers` is documented to have, checked against the goldens."""

    def test_reversing_the_model_order_changes_nothing(self) -> None:
        # `prefers` is symmetric on purpose: whatever order `models` names, the
        # simplest model within the margin of the best is the one returned.
        # These two cases are the same page and the same options apart from the
        # order, so they must agree on everything.
        forward = _aligned("fullSweep")
        reversed_ = _aligned("reversedModels")

        assert forward.diagnostics.selected_model == reversed_.diagnostics.selected_model
        assert forward.matrix == reversed_.matrix
        assert forward.confidence == reversed_.confidence

    def test_the_two_cases_really_do_try_the_models_in_different_orders(self) -> None:
        # Guards the test above: if both swept in the same order it would pass
        # while proving nothing.
        forward = [a.model for a in _aligned("fullSweep").diagnostics.attempts]
        reversed_ = [a.model for a in _aligned("reversedModels").diagnostics.attempts]
        assert forward != reversed_
        assert forward == list(DEFAULT_MODELS)
        assert reversed_ == list(reversed(DEFAULT_MODELS))


class TestPrefers:
    """The policy on its own, exhaustively.

    217 cases: every ordering of complexity against every relationship between
    the two confidences, at three margins. It is the one piece of this slice
    that is pure, so it is the one that can be pinned like this.
    """

    @pytest.mark.parametrize("case", _GOLDEN["prefers"])
    def test_it_matches_the_golden(self, case: dict[str, Any]) -> None:
        candidate = ScoredModel(
            model=case["candidate"]["model"], confidence=case["candidate"]["confidence"]
        )
        incumbent = (
            None
            if case["incumbent"] is None
            else ScoredModel(
                model=case["incumbent"]["model"], confidence=case["incumbent"]["confidence"]
            )
        )
        assert prefers(candidate, incumbent, case["margin"]) is case["prefers"]

    def test_the_golden_is_not_all_one_answer(self) -> None:
        # A table of 217 `False`s would pass against a function that always
        # returns False.
        answers = [c["prefers"] for c in _GOLDEN["prefers"]]
        assert 0 < sum(answers) < len(answers)

    def test_no_incumbent_always_loses(self) -> None:
        # The short-circuit: the first model tried is always the incumbent, and
        # a sweep that rejected it would fit nothing at all.
        assert prefers(ScoredModel(model="homography", confidence=0), None, 0.02) is True


class TestSweepOrder:
    """Duplicates removed, order kept, and an empty list refused."""

    def test_it_preserves_the_order_given(self) -> None:
        assert sweep_order(["homography", "similarity"]) == ["homography", "similarity"]

    def test_it_removes_duplicates_keeping_the_first(self) -> None:
        models: list[TransformModel] = ["affine", "similarity", "affine"]
        assert sweep_order(models) == ["affine", "similarity"]

    def test_an_empty_list_is_refused_rather_than_fitting_nothing(self) -> None:
        # The TypeScript throws RangeError; Python spells that ValueError for an
        # argument whose type is right and whose value is not.
        with pytest.raises(ValueError, match="at least one"):
            sweep_order([])


class TestWhatIsUnreachableFromARealPage:
    """Two guards these goldens cannot exercise, asserted as invariants instead.

    Both survived mutation. Neither is a gap: the first needs an input a page
    pair cannot produce, and the second cannot be observed at these sizes at all.
    """

    def test_the_confidence_clamp_needs_an_anti_correlated_pair(self) -> None:
        # `to_confidence` clamps to [0, 1] because anti-correlated ink is no
        # alignment at all. No page pair here scores below zero, so the clamp is
        # unreachable from the goldens - but it is reachable, and this is what
        # it looks like: a page against its own negative.
        page = _PAGE.raster
        inverted = Raster(pixels=page.pixels.copy())
        inverted.pixels[:, :, :3] = 255 - inverted.pixels[:, :, :3]

        judge = create_referee(
            ink_map(to_grayscale(page)),
            ink_map(to_grayscale(inverted)),
            _GOLDEN["options"]["workingSize"],
        )
        agreement = judge(IDENTITY)

        assert agreement.correlation < 0, "the inverted page is no longer anti-correlated"
        # The clamp is the whole point: a negative confidence would compare as
        # "worse than nothing" against a model that found no consensus at all.
        assert to_confidence(agreement) == 0

    def test_the_referee_size_cap_cannot_bind_on_a_page_this_small(self) -> None:
        # `min(working_size, 800)`. `downscale_gray` only ever shrinks, so on a
        # 200x260 page every working size from 260 upwards is the same
        # measurement - which is why removing the cap changes nothing here. It
        # is a performance guard for large pages, and the invariant is what can
        # be asserted.
        longest = max(_PAGE.raster.width, _PAGE.raster.height)
        assert longest < 800, (
            "the page is now large enough for the referee cap to bind, so it needs a real test "
            "rather than this invariant"
        )
        for size in (longest, 800, 2000):
            assert downscale_gray(
                ink_map(to_grayscale(_PAGE.raster)), size
            ).image.width == _PAGE.raster.width
