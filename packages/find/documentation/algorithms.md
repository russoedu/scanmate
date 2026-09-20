# How `@scanmate/find` decides

Two questions:

1. **Is the content that must be on this page actually on it?** — the company
   name, the order number, the total.
2. **Where is the field?** — the box under "Signature of", resolved from text
   the original prints rather than from coordinates someone typed once.

![the signer fields, resolved from the anchor the original prints](../assets/regions.jpg)

*The two boxes were not measured by hand. They are offsets from the words
"Signature of", found in the original's own text layer, on the
[IRS Form W-9](https://www.irs.gov/pub/irs-pdf/fw9.pdf) (public domain).*

## Finding content

```mermaid
flowchart TD
  A[expected content] --> B[normalise both sides<br/>case, diacritics, typography]
  B --> C[search the original's text<br/>every place it prints this]
  C --> D{printed anywhere<br/>on this page?}
  D -->|yes| E[for each place, read what<br/>the scan says there]
  E --> F{intact at every place?}
  F -->|yes| G[found, identifiable]
  F -->|some| H[found, not identifiable]
  F -->|none| I{anywhere else<br/>on the page?}
  D -->|no| I
  I -->|yes| J[found on the page,<br/>not identifiable]
  I -->|no| K[not found]
```

The order matters. The **original's** text is searched first, because it is
exact: it says where the document prints this content, and how many times. Only
then is the scan's reading of those places checked.

That gives the strongest statement available — *this value is present at every
place the document prints it* — and it distinguishes two cases that a plain
search cannot:

- An amount printed twice, altered once: **found** (the other copy is genuine)
  but **not identifiable**.
- An amount that appears somewhere else on the page but not where it belongs:
  found `on-page` rather than `in-place`, and not identifiable.

`foundOnPages` lists every page whose reading contains it, so a value that
turns up on the wrong page — pages swapped, a substituted sheet — is visible.

## Approximate, but not about figures

OCR of a real scan never reproduces a phrase character for character. An exact
`includes` would report a perfectly good scan as incomplete because one letter
came back wrong. So matching is **Sellers' algorithm**: Levenshtein distance
where the match may begin and end anywhere in the text — the first row of the
table is zero, so skipping ahead is free, and the best ending is read off the
last row. Score is `1 - distance / needle length`, and `minScore` (0.85) is the
floor.

Two kinds of content are held to more than closeness:

```mermaid
flowchart TD
  A[candidate match] --> B{needle contains digits?}
  B -->|yes| C{same digits, in order?}
  C -->|no| R[rejected]
  C -->|yes| D{a digit touching<br/>either end?}
  D -->|yes| R
  D -->|no| K[accepted]
  B -->|no| E{needle is a lone letter?}
  E -->|yes| F{present as a word<br/>of its own?}
  F -->|no| R
  F -->|yes| K
  E -->|no| G{score ≥ 0.85?}
  G -->|yes| K
  G -->|no| R
```

- **Figures must keep their digits.** `1,250.00` is not an approximate match for
  `7,250.00`, however similar the strings are — one edit in eight characters
  scores 0.875, comfortably over any sensible threshold. And a figure must not
  run into more digits: `1,250.00` is not "found" inside `11,250.00`.
- **A lone letter must be a word of its own.** The "A" of "Schedule A" is an
  identifier; one letter in ten characters is 90% similar to any other letter,
  so fuzzy matching would find "Schedule B" just as happily.

Both sides go through the same normalisation as `@scanmate/ocr` — reusing it
rather than reimplementing it, because a mismatch between the two would be a
silent correctness bug.

## Resolving a field from an anchor

Coordinates typed into a config drift the moment a template changes. An anchor
does not: the field is *under the words the form prints*.

```mermaid
flowchart TD
  A[anchor text] --> B[join runs on one line<br/>baselines within 2 points]
  B --> C[normalise and compare]
  C --> D{how many places<br/>match?}
  D -->|none| E[named outcome: not found]
  D -->|more than one| F{occurrence given?}
  F -->|no| G[named outcome: ambiguous]
  F -->|yes, nth| H[take that one]
  D -->|exactly one| I[take it]
  H --> J[offsets from the anchor's corner]
  I --> J
  J --> K{every region finite, positive,<br/>on the page, not overlapping?}
  K -->|no| L[named outcome: invalid]
  K -->|yes| M[regions, in points]
```

Runs are joined across a line first, because a text layer splits a phrase
wherever the generator changed anything — "Signature of" can be three separate
runs. Anything ambiguous is a **named outcome**, never a guess: zero matches and
five matches are different problems, and both are the caller's to handle.

The resolved regions are validated before they are returned — finite, positive,
inside the page, and not overlapping each other — so a bad offset table fails
here rather than silently measuring the wrong rectangle.

One rule is a security rule: **only the original's text layer is ever read**. A
returned scan can carry a text layer of its own, stale or planted, and nothing
here will use it.

## Constants

| option | default | |
|---|---|---|
| `minScore` | `0.85` | Least similarity for a match; figures and lone letters are exact regardless. |
| `normalise` | shared with `@scanmate/ocr` | Case, diacritics, typography, hyphens. |
| `lineTolerance` | `2` pt | Baselines this close are one line. |
| `maxRuns` | `12` | Runs joined when looking for an anchor. |
| `occurrence` | `'unique'` | Or the nth, when a form repeats its anchor per signer. |

## What it does not do

- It does not read the scan. It works from `@scanmate/ocr`'s report.
- It does not look at ink. Whether a resolved region was *filled in* is
  `@scanmate/diff`'s question.
- It does not invent a location for content it cannot find in the original: if
  the document does not print it, there is no "place" for it to be.
