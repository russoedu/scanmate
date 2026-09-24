"""Text normalisation, measured against the TypeScript.

Exact, across 814 cases: every entry of an adversarial corpus through every
combination of steps the goldens carry, plus the 822-entry diacritics table
compared entry by entry.

WHY THE CORPUS LOOKS LIKE THAT
-------------------------------

Not one entry is a plausible sentence, and that is the point. A plausible
sentence is exactly where a port looks right. Each entry targets a specific way
the two languages disagree:

- JavaScript's ``\\s`` and Python's are different sets in BOTH directions -
  Python's has U+001C to U+001F and U+0085, JavaScript's has U+FEFF - so the
  corpus carries characters from each side of that.
- ``\\p{L}``, ``\\p{N}``, ``\\p{Sc}`` and ``\\p{P}`` have no equivalent in
  Python's ``re``, so the port asks :func:`unicodedata.category` instead and
  the corpus exercises letters, digits, currency signs, Roman numerals and
  vulgar fractions, which are four different categories that all have to come
  out on the right side of "meaningful".
- The two runtimes are on different UNICODE VERSIONS - V8 on 16.0 against
  CPython's 15.1 when this was written. They agree on every case-fold and
  every NFKC in this corpus, which is a measured fact about these characters
  and not a guarantee about all of them. The golden records both versions, and
  :func:`test_the_two_runtimes_still_agree_on_case_and_nfkc` checks the
  runtimes directly, so a future divergence is reported as what it is rather
  than as a mystery in the pipeline.
"""

from __future__ import annotations

import json
import unicodedata
from pathlib import Path

import pytest

from .confusables_mapper import fold_confusables
from .diacritics_mapper import diacritics_map, fold_diacritics
from .normalise_text_algorithm import (
    DEFAULT_NORMALISE,
    NormaliseOptions,
    normalise_text,
    tokenise,
    with_options,
)

_GOLDEN = json.loads(
    (
        Path(__file__).parents[4] / "tools" / "parity" / "goldens" / "text-normalisation.json"
    ).read_text(encoding="utf-8"),
)

#: The TypeScript's option names against this port's.
_OPTION_NAMES = {
    "nfkc": "nfkc",
    "typography": "typography",
    "dehyphenate": "dehyphenate",
    "diacritics": "diacritics",
    "caseFold": "case_fold",
    "dropNoise": "drop_noise",
    "stripPunctuation": "strip_punctuation",
    "confusables": "confusables",
}

_CORPUS = _GOLDEN["corpus"]
_CASES = [(variant, name) for variant in _GOLDEN["variants"] for name in _CORPUS]


def options_for(variant: str) -> NormaliseOptions:
    """Build this port's options from the golden's partial TypeScript object.

    :param variant: The variant the golden keys its options under.
    :returns: The equivalent options.
    """
    overrides = _GOLDEN["variants"][variant]

    return with_options(**{_OPTION_NAMES[key]: value for key, value in overrides.items()})


def test_the_defaults_are_the_same_eight_settings() -> None:
    """Six on, two off - and WHICH two off is the safety property.

    Stripping punctuation would make a thousands separator vanish, and folding
    confusables would forgive a zero written as an ``o``. Both are the exact
    substitutions a check exists to catch, so both are opt-in.
    """
    for js_name, py_name in _OPTION_NAMES.items():
        assert getattr(DEFAULT_NORMALISE, py_name) is _GOLDEN["defaults"][js_name], js_name

    assert DEFAULT_NORMALISE.strip_punctuation is False
    assert DEFAULT_NORMALISE.confusables is False


@pytest.mark.parametrize(("variant", "name"), _CASES)
def test_normalise_text_matches(variant: str, name: str) -> None:
    """Every corpus entry through every variant.

    :param variant: Which steps are on.
    :param name: The corpus entry.
    """
    result = normalise_text(_CORPUS[name], options_for(variant))

    assert result == _GOLDEN["normaliseText"][variant][name]


@pytest.mark.parametrize(("variant", "name"), _CASES)
def test_tokenise_matches(variant: str, name: str) -> None:
    """The same, as a word list.

    Separate from :func:`test_normalise_text_matches` because the empty case
    is the one that differs in kind: an empty string tokenises to an empty
    list, not to a list holding one empty string.

    :param variant: Which steps are on.
    :param name: The corpus entry.
    """
    result = tokenise(_CORPUS[name], options_for(variant))

    assert result == _GOLDEN["tokenise"][variant][name]


def test_nothing_left_tokenises_to_no_words_rather_than_one_empty_one() -> None:
    """``''.split(' ')`` is ``['']`` in both languages, which would be a word."""
    assert tokenise("") == []
    assert tokenise(" | ___ ~~ ") == []
    assert normalise_text(" | ___ ~~ ") == ""


def test_the_two_runtimes_still_agree_on_case_and_nfkc() -> None:
    """The measurement the exact assertions above rest on.

    V8 and CPython implement different Unicode versions, so their agreement is
    a fact about the characters in this corpus rather than a guarantee. This
    checks the two runtimes against each other directly - if a future release
    of either moves one of these, the failure says so, instead of surfacing as
    an inexplicable normalisation difference three steps downstream.
    """
    for name, text in _CORPUS.items():
        assert text.lower() == _GOLDEN["runtime"]["lowerCased"][name], name
        assert unicodedata.normalize("NFKC", text) == _GOLDEN["runtime"]["nfkc"][name], name

    # Recorded, not asserted equal: they are 16.0 and 15.1 today, and the two
    # aligning later would be good news rather than a regression. What must
    # hold is that the golden carries a version at all, so a future reader can
    # see which pair of runtimes the agreement above was measured between.
    assert _GOLDEN["runtime"]["unicodeVersion"]
    assert unicodedata.unidata_version


def test_javascript_whitespace_is_used_and_not_pythons() -> None:
    """The two sets differ in BOTH directions, and both directions matter.

    U+FEFF is whitespace to JavaScript and not to Python, so splitting on
    Python's set would leave it glued to a word. U+001C and U+0085 are
    whitespace to Python and not to JavaScript, so splitting on Python's set
    would break a token that JavaScript keeps whole.

    Read off the goldens rather than asserted from memory: these are the
    entries built for exactly this, and both survive the default pipeline.
    """
    assert normalise_text(_CORPUS["bom"]) == _GOLDEN["normaliseText"]["defaults"]["bom"]
    assert (
        normalise_text(_CORPUS["pythonOnlySpace"])
        == _GOLDEN["normaliseText"]["defaults"]["pythonOnlySpace"]
    )
    # With typography off, U+FEFF survives to the whitespace split, which is
    # where using Python's `\s` would keep it inside the token.
    no_typography = options_for("noTypography")

    assert (
        normalise_text(_CORPUS["bom"], no_typography)
        == _GOLDEN["normaliseText"]["noTypography"]["bom"]
    )


def test_the_diacritics_table_is_the_one_the_typescript_built() -> None:
    """All 822 entries, compared as a whole map.

    The Python table is GENERATED from this same build rather than retyped,
    and this is what stops a regenerated or hand-edited copy from drifting.
    """
    expected = dict(_GOLDEN["diacriticsMap"])

    assert diacritics_map() == expected
    assert len(expected) == 822


@pytest.mark.parametrize("text", list(_GOLDEN["foldDiacritics"]))
def test_fold_diacritics_matches(text: str) -> None:
    """Including the folds that LENGTHEN the string.

    An ash folds to two characters, so a caller assuming the length is
    preserved is wrong; the golden carries those cases.

    :param text: The input the golden holds.
    """
    assert fold_diacritics(text) == _GOLDEN["foldDiacritics"][text]


@pytest.mark.parametrize("text", list(_GOLDEN["foldConfusables"]))
def test_fold_confusables_matches(text: str) -> None:
    """Pairs before singles, and pairs among themselves in order.

    ``rn1`` is ``ml`` and not ``rnl`` because ``rn`` folds before ``1`` does;
    ``cli`` is ``dl`` because ``cl`` folds before ``i`` does. Reordering the
    table is not a tidy-up, it is a different fold - which is what these
    entries pin.

    :param text: The input the golden holds.
    """
    assert fold_confusables(text) == _GOLDEN["foldConfusables"][text]


def test_confusables_run_after_the_pairs_not_alongside_them() -> None:
    """Stated directly, because the golden alone does not show the ordering."""
    assert fold_confusables("rn1") == "ml"
    assert fold_confusables("cli") == "dl"
    assert fold_confusables("vvi") == "wl"


def test_a_wrapped_word_is_rejoined_only_between_a_letter_and_a_lower_case_one() -> None:
    """The three conditions, each shown failing on its own.

    The regex can only match the shape; whether the character before the
    hyphen is a letter and the one after is lower case is a Unicode CATEGORY
    question, which Python's ``re`` cannot ask. Getting either wrong rejoins
    a hyphenated compound that was never wrapped, or leaves every wrapped word
    counting as an edit.
    """
    defaults = None

    assert normalise_text(_CORPUS["hyphenWrap"], defaults) == "information"
    assert normalise_text(_CORPUS["hyphenWrapCrLf"], defaults) == "information"
    assert normalise_text(_CORPUS["hyphenWrapSpaces"], defaults) == "information"
    assert normalise_text(_CORPUS["softHyphenWrap"], defaults) == "information"
    # A capital after the break is a new sentence, not a wrap.
    assert normalise_text(_CORPUS["hyphenBeforeCaps"], defaults) != "wrapping"
    # A digit before it is a range or a reference, not a wrapped word.
    assert normalise_text(_CORPUS["hyphenAfterDigit"], defaults) != "5x"
    # No line break at all is just a compound.
    assert normalise_text(_CORPUS["hyphenNoBreak"], defaults) == "in-line"


def test_currency_and_numerals_survive_the_noise_filter() -> None:
    """Four Unicode categories that all have to count as meaningful.

    A currency sign is ``Sc``, a digit is ``Nd``, a Roman numeral is ``Nl``
    and a vulgar fraction is ``No``. A port that checked only letters and
    digits would silently drop a bare currency amount from the comparison.
    """
    assert tokenise(_CORPUS["currency"]) == _GOLDEN["tokenise"]["defaults"]["currency"]
    assert tokenise(_CORPUS["romanNumeral"]) == _GOLDEN["tokenise"]["defaults"]["romanNumeral"]
    assert tokenise(_CORPUS["fractionVulgar"]) == _GOLDEN["tokenise"]["defaults"]["fractionVulgar"]
    assert tokenise(_CORPUS["noise"]) == _GOLDEN["tokenise"]["defaults"]["noise"]


def test_punctuation_is_kept_by_default_because_figures_need_it() -> None:
    """``1,250.00`` must not become ``125000``.

    The whole reason the step is opt-in, stated as a test so it cannot be
    flipped on as a convenience.
    """
    assert "," in normalise_text(_CORPUS["numbers"])
    assert normalise_text(_CORPUS["numbers"]) == _GOLDEN["normaliseText"]["defaults"]["numbers"]

    stripped = normalise_text(_CORPUS["numbers"], options_for("stripPunctuation"))

    assert stripped == _GOLDEN["normaliseText"]["stripPunctuation"]["numbers"]
    assert "," not in stripped
