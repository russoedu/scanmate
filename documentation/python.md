# The Python packages

`scanmate-ink`, `scanmate-align` and the distributions that follow them are a
**parallel port** of the TypeScript, not a replacement for it. The TypeScript
remains the reference. The only useful definition of "correct" here is that the
Python produces the same numbers, bit for bit, as the TypeScript it parallels —
which is what `tools/parity` exists to prove.

| Package | Parallels | State |
| --- | --- | --- |
| `scanmate-ink` | `@scanmate/ink` | complete; 13 slices |
| `scanmate-align` | `@scanmate/align` | complete; 5 slices |

For `scanmate-align` the proof is end to end: `align_scan` produces the same
transform, the same diagnostics and a **byte-identical warped raster** on every
golden case, across the whole pipeline — decode, ink separation, the coarse
search, ORB, RANSAC, model selection and the final warp.

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
without a word. It builds every package the writer imports explicitly rather than relying on
`ci.yml`'s verify step, which is `nx affected` on a pull request: a PR touching
only Python would never build them, and the check would then fail on a missing
import rather than on a stale golden.

Use `nx run-many -t build -p a,b` there, **not** `nx build a b`. The second form
passes `b` as an argument to a's build *command*, which made rollup bundle
`@scanmate/align` into ink's own output — succeeding silently on a machine where
align's `dist` already existed, and failing only on a clean checkout. That CI
step is the clean checkout, and it caught it.

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

- `hypot_algorithm.py` — `Math.hypot`. CPython's `math.hypot` is written to be
  *correctly rounded* and V8's computes a scaled square root, so they disagree
  in the last bit on **16% of inputs**; `numpy.hypot` is a third algorithm again
  and disagrees on 17%. "More accurate" is still different. This one was found
  the hard way: six call sites in `scanmate-ink` used `math.hypot`, every
  plane-geometry golden agreed, all 1,227 tests passed, and the divergence only
  surfaced from `@scanmate/align`'s RANSAC goldens, where a mean over 40
  reprojection errors came out one ULP low.

Getting any of these wrong is invisible without the goldens, which is the
reason they are asserted directly as well as through their callers.

### The libm seams, and how each is pinned

Three places the two runtimes genuinely disagree, none of them anybody's bug.
Each is measured and pinned **separately**, because a tolerance covering two
faults while claiming to cover one is worse than no tolerance:

| Function | Disagreement | Consequence |
| --- | --- | --- |
| `sin(±π/4)` | 1 ULP, MSVC vs glibc | the FFT, and everything through it |
| `Math.cos` | 5 of 125 Hann arguments | phase correlation's window |
| `Math.atan2` | 18 of 107 keypoint angles | ORB's rotation bin |

The `atan2` one sits in front of a **cliff** rather than a slope: the angle
picks one of 32 rotation bins, and neighbouring bins give completely different
descriptors, so a 1-ULP difference landing on a boundary would change 256 bits
at once. That is measured rather than hoped about — the closest any angle comes
to a boundary is 7.53e-4 radians, or 3.4e12 ULP — and a test fails loudly if a
future fixture ever gets close.

Where a bound is used instead of `==` it is an absolute 1e-12, the same bar
everywhere, and each such test also asserts the measured worst case is orders
inside it. A tolerance with no headroom is not evidence.

### Mutation testing is the standard, not an extra

Every slice is mutation-tested before it lands, and it has found a real gap in
nearly every one — usually a golden that could not discriminate. A representative
few:

- The ORB fixtures could not reach `Math.round` **at all**: 32,768 pattern
  values and not one lands on an exact half. A 161×121 page at scale factor 2
  asks for 80.5 × 60.5 pixels, which is the only reachable place.
- Telling phase correlation's first-maximum-wins from last-maximum-wins needs a
  **blank page**, which is exactly the case that algorithm exists for.
- `scan_alignment`'s working size never actually downscaled, so the step that
  lifts a RANSAC residual back to full resolution was the identity in every
  case.

It has also killed claims of the port's own docstrings and test names — a test
asserting `max_features` was a global cap (it is a per-level allowance, so 5
over 2 levels really does return 6), and a comment claiming whole-pixel shifts
would be exact on phase correlation's `dx`. Both were corrected against
measurement.

A surviving mutant is not automatically a gap. Several guards are unreachable by
construction, and each is asserted as an **invariant** rather than left alone —
the frame guess's pivot and target coincide exactly when it wins, `content_extent`
never returns a zero width while its density is positive, and so on.

## Publishing

Public PyPI, from this repository's own CI, using a `PYPI_TOKEN` repository
secret (Settings → Secrets and variables → Actions). The release guard fails
fast when that secret is empty rather than letting `twine` prompt — a prompt on
a CI agent is a build that hangs until it times out rather than one that fails.

`tesseract` is deliberately **not** installed on the build agent. Not needing
it is the point: the OCR wheels bundle their own native code.
