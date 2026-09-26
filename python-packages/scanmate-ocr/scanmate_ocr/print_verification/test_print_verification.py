"""Print verification, held to the TypeScript exactly.

The input pages are **not** carried in the golden. Both ports build them from
``create_raster`` + ``draw_label`` + ``to_grayscale``, which are bit-exact
ports, so the greyscale page hashes identically on each side and only the
verdicts need recording. That is a stronger arrangement than shipping pixels:
if the page construction ever diverged, every case here would fail at once.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from scanmate_ink import (
    GrayImage,
    LabelOptions,
    Point,
    ScanmateOrientedRect,
    TextRun,
    box_blur_raster,
    create_raster,
    draw_label,
    to_grayscale,
)

from .glyph_templates_algorithm import collect_templates, template_key
from .print_polarity_policy import print_polarity
from .verify_print_use_case import SHARPENING, VerifyOptions, verify_printed_run

_GOLDEN: dict[str, Any] = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "ocr-print-verification.json"
    ).read_text(encoding="utf-8")
)

_DPI = _GOLDEN["dpi"]
_S = _DPI / 72


def _build(spec: dict[str, Any]) -> tuple[GrayImage, list[TextRun], Any]:
    """One page of labels, and a TextRun for each - in POINTS, not pixels."""
    page = create_raster(spec["width"], spec["height"])
    runs: list[TextRun] = []
    for text, x, y in spec["labels"]:
        box = draw_label(page, text, Point(x=x * _S, y=y * _S), LabelOptions(scale=spec["scale"]))
        runs.append(
            TextRun(
                text=text,
                x=box.x / _S,
                y=box.y / _S,
                width=box.width / _S,
                height=box.height / _S,
                angle=0,
                baseline=None,
                font_size=box.height / _S,
                font_name="synthetic",
                ends_line=False,
            )
        )

    return to_grayscale(page), runs, page


@pytest.fixture(scope="module")
def pages() -> dict[str, tuple[GrayImage, list[TextRun], Any]]:
    return {name: _build(spec) for name, spec in _GOLDEN["pages"].items()}


@pytest.fixture(scope="module")
def templates(pages: dict[str, tuple[GrayImage, list[TextRun], Any]]) -> dict[str, Any]:
    return {
        name: collect_templates(pages[name][0], _DPI, pages[name][1])
        for name in ("original", "sparse", "small")
    }


def _box(run: TextRun) -> ScanmateOrientedRect:
    return ScanmateOrientedRect(
        x=run.x, y=run.y, width=run.width, height=run.height, angle=run.angle
    )


def _cases(
    pages: dict[str, tuple[GrayImage, list[TextRun], Any]], templates: dict[str, Any]
) -> dict[str, tuple[GrayImage, GrayImage, TextRun, Any, VerifyOptions]]:
    original, orig_runs, original_raster = pages["original"]
    tampered, _, _ = pages["tampered"]
    sparse, sparse_runs, _ = pages["sparse"]
    small, small_runs, _ = pages["small"]
    tpl = templates["original"]
    blurred = to_grayscale(box_blur_raster(original_raster, 3))

    return {
        "unchanged": (original, original, orig_runs[1], tpl, VerifyOptions()),
        "changed": (original, tampered, orig_runs[1], tpl, VerifyOptions()),
        "another-figure": (original, original, orig_runs[3], tpl, VerifyOptions()),
        "no-figure": (original, original, orig_runs[2], tpl, VerifyOptions()),
        "text-scope": (original, original, orig_runs[2], tpl, VerifyOptions(scope="text")),
        "few-rivals": (sparse, sparse, sparse_runs[0], templates["sparse"], VerifyOptions()),
        "too-coarse": (small, small, small_runs[1], templates["small"], VerifyOptions()),
        "confirm-agreeing": (
            original, original, orig_runs[1], tpl,
            VerifyOptions(scope="confirm", claimed="13.50"),
        ),
        "confirm-without-a-claim": (
            original, original, orig_runs[1], tpl, VerifyOptions(scope="confirm"),
        ),
        "confirm-misaligned": (
            original, original, orig_runs[1], tpl,
            VerifyOptions(scope="confirm", claimed="1"),
        ),
        "a-single-digit-is-not-a-figure": (
            original, original, orig_runs[1], tpl, VerifyOptions(min_digits=5),
        ),
        "a-change-the-print-matched-too-well-to-be": (
            original, tampered, orig_runs[1], tpl, VerifyOptions(max_printed=0.2),
        ),
        "the-same-change-with-the-bar-left-alone": (
            original, tampered, orig_runs[1], tpl, VerifyOptions(max_printed=0.9),
        ),
        "a-scan-too-soft-to-decide": (
            original, blurred, orig_runs[1], tpl, VerifyOptions(),
        ),
    }


@pytest.mark.parametrize("name", sorted(_GOLDEN["verifyPrintedRun"]))
def test_matches_the_typescript(
    name: str,
    pages: dict[str, tuple[GrayImage, list[TextRun], Any]],
    templates: dict[str, Any],
) -> None:
    """Every verdict, and every score behind it, `==` and not `approx`."""
    want = _GOLDEN["verifyPrintedRun"][name]
    original, scan, run, tpl, options = _cases(pages, templates)[name]
    check = verify_printed_run(original, scan, _DPI, run, tpl, options)

    assert check.verified == want["verified"]
    if not check.verified:
        assert check.because == want["because"]

        return

    assert check.reading == want["reading"]
    assert check.agrees == want["agrees"]
    assert check.checked == want["checked"]
    assert check.confidence == want["confidence"]
    assert len(check.cells) == len(want["cells"])
    for cell, expected in zip(check.cells, want["cells"], strict=True):
        assert cell.at == expected["at"]
        assert cell.printed == expected["printed"]
        # The correlations themselves, to the last bit: they are what the
        # margin is measured against, and a port that is close decides
        # differently on the cells that are close.
        assert cell.printed_score == expected["printedScore"]
        assert cell.rival == expected["rival"]
        assert cell.rival_score == expected["rivalScore"]
        assert cell.read == expected["read"]


def test_the_pages_themselves_are_built_identically(
    pages: dict[str, tuple[GrayImage, list[TextRun], Any]],
) -> None:
    """The foundation the whole file rests on.

    Nothing above means anything if the two ports draw different pages, so the
    runs the TypeScript recorded are compared against the ones built here.
    """
    _, runs, _ = pages["original"]

    assert len(runs) == len(_GOLDEN["runs"])
    for run, want in zip(runs, _GOLDEN["runs"], strict=True):
        assert run.text == want["text"]
        assert (run.x, run.y, run.width, run.height) == (
            want["x"],
            want["y"],
            want["width"],
            want["height"],
        )


def test_template_counts_match(
    templates: dict[str, Any],
) -> None:
    for name, want in _GOLDEN["templateCounts"].items():
        assert len(templates[name]) == want


@pytest.mark.parametrize("key", sorted(_GOLDEN["templateKeys"]))
def test_template_keys_match(
    key: str, pages: dict[str, tuple[GrayImage, list[TextRun], Any]]
) -> None:
    run = pages["original"][1][int(key.split("-")[1])]
    got = [template_key(run, c) for c in run.text if c.strip() != ""]

    assert got == _GOLDEN["templateKeys"][key]


@pytest.mark.parametrize("key", sorted(_GOLDEN["printPolarity"]))
def test_polarity_matches(
    key: str, pages: dict[str, tuple[GrayImage, list[TextRun], Any]]
) -> None:
    original, runs, _ = pages["original"]
    run = runs[int(key.split("-")[1])]

    assert print_polarity(original, _DPI, _box(run)) == _GOLDEN["printPolarity"][key]


@pytest.mark.parametrize(
    "case", _GOLDEN["templateKeyHalves"], ids=lambda c: f"{c['fontSize']}-{c['angle']}"
)
def test_template_key_rounds_halves_up(case: dict[str, Any]) -> None:
    """``Math.round`` sends a half UP; Python's ``round`` sends it to even.

    A size of 10.25 doubles to 20.5, which rounds to 21 and files the glyph
    under 10.5 - where banker's rounding gives 20 and files it under 10. Two
    stores, and a run then matched against templates that are not there. Same
    for a 45 degree angle, which is half a quarter turn.
    """
    run = TextRun(
        text="0", x=0, y=0, width=10, height=10, angle=case["angle"],
        baseline=None, font_size=case["fontSize"], font_name="F", ends_line=False,
    )

    assert template_key(run, "0") == case["key"]


class TestWhatTheCheckIsFor:
    """The behaviours, said out loud, so a failure names one."""

    def test_an_untouched_figure_agrees(
        self, pages: dict[str, tuple[GrayImage, list[TextRun], Any]], templates: dict[str, Any]
    ) -> None:
        original, runs, _ = pages["original"]
        check = verify_printed_run(original, original, _DPI, runs[1], templates["original"])

        assert check.verified is True
        assert check.agrees is True
        assert check.reading == "12.50"

    def test_a_changed_digit_is_caught_and_named(
        self, pages: dict[str, tuple[GrayImage, list[TextRun], Any]], templates: dict[str, Any]
    ) -> None:
        # The whole point of the package: not "this looks wrong" but "this is a
        # 3 where the original printed a 2".
        original, runs, _ = pages["original"]
        tampered, _, _ = pages["tampered"]
        check = verify_printed_run(original, tampered, _DPI, runs[1], templates["original"])

        assert check.agrees is False
        assert check.reading == "13.50"
        changed = [c for c in check.cells if c.read != c.printed]
        assert len(changed) == 1
        assert (changed[0].printed, changed[0].read) == ("2", "3")
        # And it is decided on the ink: the printed glyph loses badly.
        assert changed[0].printed_score < changed[0].rival_score

    def test_a_run_with_no_digits_is_not_a_figure(
        self, pages: dict[str, tuple[GrayImage, list[TextRun], Any]], templates: dict[str, Any]
    ) -> None:
        original, runs, _ = pages["original"]
        check = verify_printed_run(original, original, _DPI, runs[2], templates["original"])

        assert check.verified is False
        assert check.because == "no-figure"

    def test_a_page_printing_too_little_will_not_rule_rivals_out(
        self, pages: dict[str, tuple[GrayImage, list[TextRun], Any]], templates: dict[str, Any]
    ) -> None:
        # A glyph whose own rivals are missing could be confirmed as the one it
        # replaced, simply for lacking anything better to match.
        sparse, runs, _ = pages["sparse"]
        check = verify_printed_run(sparse, sparse, _DPI, runs[0], templates["sparse"])

        assert check.because == "few-rivals"

    def test_a_cell_below_the_match_height_is_refused(
        self, pages: dict[str, tuple[GrayImage, list[TextRun], Any]], templates: dict[str, Any]
    ) -> None:
        # Never invent resolution: scaling a short cell up interpolates the
        # detail that decides between two digits, and an invented stroke
        # favours whichever rival it resembles.
        small, runs, _ = pages["small"]
        check = verify_printed_run(small, small, _DPI, runs[1], templates["small"])

        assert check.because == "too-coarse"

    def test_confirm_needs_a_claim_that_lines_up(
        self, pages: dict[str, tuple[GrayImage, list[TextRun], Any]], templates: dict[str, Any]
    ) -> None:
        original, runs, _ = pages["original"]
        tpl = templates["original"]

        assert verify_printed_run(
            original, original, _DPI, runs[1], tpl, VerifyOptions(scope="confirm")
        ).because == "no-claim"
        assert verify_printed_run(
            original, original, _DPI, runs[1], tpl,
            VerifyOptions(scope="confirm", claimed="1"),
        ).because == "no-claim"

    def test_a_print_that_matched_well_is_not_overturned(
        self, pages: dict[str, tuple[GrayImage, list[TextRun], Any]], templates: dict[str, Any]
    ) -> None:
        # A rival may only overturn the print when the print itself matched
        # badly. The changed digit's own glyph scores 0.34, so a bar below that
        # refuses to call the change and a bar above it allows one - the only
        # pair that tells this rule apart from no rule at all.
        original, runs, _ = pages["original"]
        tampered, _, _ = pages["tampered"]
        tpl = templates["original"]

        strict = verify_printed_run(
            original, tampered, _DPI, runs[1], tpl, VerifyOptions(max_printed=0.2)
        )
        lenient = verify_printed_run(
            original, tampered, _DPI, runs[1], tpl, VerifyOptions(max_printed=0.9)
        )

        assert strict.agrees is True
        assert lenient.agrees is False

    def test_a_soft_scan_is_mostly_left_undecided(
        self, pages: dict[str, tuple[GrayImage, list[TextRun], Any]], templates: dict[str, Any]
    ) -> None:
        """Most of a soft scan cannot be decided, and it says so.

        .. admonition:: A known gap, stated rather than papered over

           Each cell is judged at three sharpenings and only counts if all
           three read it the same way - a reading that moves as the sharpening
           moves is the sharpening talking, not the ink. Mutation testing
           removed that cross-pass agreement and **no test failed**.

           It was not for want of trying: blur radii 1 to 8 over both a clean
           and a tampered page produce eighteen undecided cells, and every one
           of them is undecided because the *first* pass could not call it -
           the margin or the floor was missed - rather than because the passes
           disagreed. So the branch is reachable in principle, on a real
           marginal scan, and is not reached by any synthetic fixture found so
           far. The rule is ported and correct; what is missing is a fixture
           that exercises it, and pretending otherwise would be worse than
           this paragraph.
        """
        original, runs, raster = pages["original"]
        blurred = to_grayscale(box_blur_raster(raster, 3))
        check = verify_printed_run(
            original, blurred, _DPI, runs[1], templates["original"]
        )

        assert check.verified is True
        # Most of this soft scan cannot be decided, and the package says so
        # rather than guessing a digit.
        assert check.checked == 1
        assert [c.read for c in check.cells] == ["1", None, None, None]
        # The sweep has something to compare, which is what makes the rule
        # meaningful at all.
        assert len(SHARPENING) > 1

    def test_confirm_checks_only_where_the_reading_disagrees(
        self, pages: dict[str, tuple[GrayImage, list[TextRun], Any]], templates: dict[str, Any]
    ) -> None:
        # The reading has already named the alternative, so one cell is in
        # dispute and one template answers it.
        original, runs, _ = pages["original"]
        check = verify_printed_run(
            original, original, _DPI, runs[1], templates["original"],
            VerifyOptions(scope="confirm", claimed="13.50"),
        )

        assert check.checked == 1
        assert check.reading == "12.50"
