# The Python packages

`scanmate-ink` and the distributions that follow it are a **parallel port** of
the TypeScript, not a replacement for it. The TypeScript remains the reference.
The only useful definition of "correct" here is that the Python produces the
same numbers, bit for bit, as the TypeScript it parallels — which is what
`tools/parity` exists to prove.

## Scaffolding a package

```sh
mnci add python-lib <name>
```

That writes `python-packages/<name>/` with a `pyproject.toml`, a `project.json`
carrying `lint`, `typecheck`, `test`, `build` and `nx-release-publish`, a
sample module and a `tests/` directory. Four things then have to be changed by
hand, every time. They are written down here so the list is one place rather
than folklore.

| edit | why |
|---|---|
| `version = "0.0.1"` | The generator writes `1.0.0`. Releases resolve the current version from the git tag, but `fallbackCurrentVersionResolver: disk` reads the manifest when no tag exists — so on a package's **first** release the template's `1.0.0` would be taken as current, and the npm siblings released from the same commit would disagree about what "first release" means. |
| `requires-python = ">=3.11"` | The generator writes `>=3.9`. This port targets 3.11 and up. |
| `testpaths = ["<module>"]`, and delete the generated `tests/` | Tests live **beside the code** as `test_<basename>.py`, matching the `.spec.ts` convention on the TypeScript side. Pytest is pointed at the module, not at a `tests/` directory. |
| wheel `exclude = ["**/test_*.py", "**/conftest.py"]` | Follows from the line above: tests beside the code would otherwise be packaged into the wheel. |
| add an empty `<module>/py.typed` | The package is fully typed and says so, per PEP 561. Without the marker a consumer's own type checker silently treats every import from it as `Any` — the strictness is then real here and worth nothing downstream. |
| `[tool.ruff]` and `[tool.ruff.lint]` | The generator configures ruff with nothing, so it runs on defaults. |

Two edits this list **used to** carry and no longer needs, because
`@mnci/nx-python-pip` now does them:

- a hand-written `typecheck` target — the generator writes one, running
  `python -m mypy .`;
- `mypy` in `requirements-dev.txt` — it is part of the generated toolchain.

## Typing

`[tool.mypy] strict = true`, generated. There is one relaxation,
`disable_error_code = ["import-untyped"]`, which tolerates a third-party
library that ships no stubs and nothing else — a module that genuinely cannot
be resolved still fails, as `import-not-found`.

`npm run typecheck` covers Python the same way it covers TypeScript: the target
is named `typecheck`, so `nx run-many -t typecheck` includes it. That naming is
the whole mechanism — Nx **skips** projects with no target of a given name and
still exits 0, so a Python project without one is type-checked by nothing while
the workspace reports green.

## Parity with the TypeScript

```sh
npm run parity:goldens   # regenerate, after a build
npm run parity:check     # regenerate and fail if anything moved
```

`tools/parity/write-goldens.mts` runs the **real** `@scanmate/*` build and
writes the values into `tools/parity/goldens/`. Never write a golden by hand: a
hand-written golden only proves that two copies of the same misunderstanding
agree.

The Python tests compare with `==`, never `pytest.approx`. A port that is right
to six places and wrong in the last bit produces a different sample, and every
downstream result diverges from there — approximate equality would hide exactly
the class of bug the goldens exist to catch.

`parity:check` regenerates and diffs, so a change to the TypeScript that moves
a number fails there rather than surfacing later as a Python test that
mysteriously disagrees. A stale golden is worse than no golden: the Python
tests keep passing while the two implementations have silently diverged.

**It runs in CI from `.github/workflows/parity.yml`, which is a separate file
on purpose.** `ci.yml` is mnci-owned — `mnci upgrade` rewrites it wholesale —
so a step added there would survive until the next upgrade and then vanish
without a word. It builds `@scanmate/ink` explicitly rather than relying on
`ci.yml`'s verify step, which is `nx affected` on a pull request: a PR touching
only Python would never build ink, and the check would then fail on a missing
import rather than on a stale golden.

That workflow earned its keep on its first run. `package-surface.json` is
extracted from the build's own `index.d.ts`, and `dist/index.d.ts` turns out to
be a one-line re-export stub — so the extractor found no named exports at all
and the golden had collapsed to an empty list, which would have "passed"
against a Python package exporting anything whatsoever. The declarations are in
`dist/src/index.d.ts`.

### Why the JS semantics slice exists

`scanmate_ink/js_semantics/` restates the parts of JavaScript's arithmetic that
Python does differently. It is its own subfeature rather than a helper inside
one caller, because it has three:

- `js_numeric_algorithm.py` — `ToUint32`, `ToInt32`, `Math.imul`, `>>>` and
  `Math.round`. Python's integers are arbitrary precision and its `>>` is
  arithmetic on a signed value, so a direct transcription of the PRNG produces
  a sequence that is perfectly random-looking and simply disagrees with the
  TypeScript. `js_round` is separate again: Python's built-in `round` is
  banker's rounding and JavaScript's rounds half towards positive infinity, so
  they differ on every half-way case — which decides a blur radius in
  `ink_separation` and `geometric_transform`, and a glyph scale in
  `synthetic_document`.
- `float_accumulation_algorithm.py` — `sequential_sum`, because `total += x` in
  a loop is not `np.sum`. numpy reduces PAIRWISE, which is more accurate and a
  different number; across a 3072-pixel correlation the two disagree routinely.

Getting any of these wrong is invisible without the goldens, which is the
reason they are asserted directly as well as through their callers.

## Publishing

Public PyPI, from this repository's own CI, using a `PYPI_TOKEN` repository
secret (Settings → Secrets and variables → Actions). The release guard fails
fast when that secret is empty rather than letting `twine` prompt — a prompt on
a CI agent is a build that hangs until it times out rather than one that fails.

`tesseract` is deliberately **not** installed on the build agent. Not needing
it is the point: the OCR wheels bundle their own native code.
