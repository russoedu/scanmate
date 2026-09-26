# scanmate-ocr

How alike two texts are, measured every way an OCR comparison needs.

A **parallel port** of [`@scanmate/ocr`][ts] — of the measures, which are pure
computation and are held to the TypeScript bit for bit.

```sh
pip install scanmate-ocr
```

```python
from scanmate_ocr import compare_texts

metrics = compare_texts(expected, read)
metrics.word_recall            # is what should be there, there?
metrics.character_error_rate   # what anyone who works with OCR expects to see
metrics.length_ratio           # near 0 when a page read as nothing at all
```

## Why several measures and not one

They fail differently, and that is the point:

- **Edit distance** counts every insertion, deletion and substitution, so it
  notices a changed digit — and punishes text that merely reflowed.
- **Set and bag measures** (Jaccard, Dice, cosine, recall) ignore order, so they
  survive reflow and a reading order OCR got wrong — and miss a swapped clause.
- **Character and word error rates** are what anyone who works with OCR expects
  to see. They are deliberately **not clamped at 1**: reading far more than was
  expected is a different failure from reading it wrong, and the number says
  which.
- **Jaro-Winkler** is for short strings — names, references — and meaningless on
  a page.

## A JavaScript string is UTF-16

Every length and every character here is a **UTF-16 code unit**, not a Python
character, because that is what JavaScript counts. They differ only outside the
Basic Multilingual Plane — an emoji is one Python character and two JavaScript
ones — and where they differ, every length-derived measure moves:

```python
levenshtein("\U0001F600", "")   # 2, not 1
utf16_length("\U0001F600")      # 2, where len() says 1
```

A port that used Python characters agrees on every ordinary page and disagrees
on the one that had an emoji in it. Mutation testing caught exactly that: the
first set of astral test cases happened to give the same distance either way,
and the code-point mutant survived until a case was added where it does not.

`utf16_units` and `utf16_length` are exported because they are the reason the
numbers agree, and anyone comparing against these results needs the same rule.

## What is not here

**This package does not run OCR.** Reading a page is Tesseract's job, and a
Python wrapper around a different Tesseract build is not a parallel port of a
WASM one — the recognised text is the engine's output, not this package's
computation. So `ocr_pages`, `read_run`, `recheck_run`, `judge_run`,
`match_words` and the engine itself are **absent on purpose**.

**Print verification is not ported yet.** `verify_printed_run`, `glyph_cells`,
`glyph_words`, `place_glyphs`, `print_polarity` and the template functions all
take a rendered page's *pixels*, so porting them needs image-driven goldens
rather than value-driven ones. That is work outstanding, not a decision.

`test_package_surface.py` keeps all three lists — ported, absent by design, not
yet ported — and **fails if an export upstream lands in none of them**, so
"missing" never has to be guessed at.

## Requirements

Python 3.11 or newer, and `scanmate-ink` for its text normalisation. Fully typed
(PEP 561), `mypy --strict` clean. No OCR engine, because it runs none.

[ts]: https://github.com/russoedu/scanmate/tree/main/packages/ocr#readme
