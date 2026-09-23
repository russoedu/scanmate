<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

# Working in this repository

Seven published packages under `packages/`, plus `@scanmate/playground` and the
workspace root itself - nine projects, which is what `nx run-many` reports.
`@scanmate/scan` is the facade that holds the pipeline; the other six stand on
their own. The root `README.md` has the map and what each package answers.

## Where the reasoning lives

This repository is documented on the assumption that **whoever reads it next
was not here when it was written**, which includes you.

- `packages/*/README.md` - what the package answers, what it refuses to claim,
  and what it has actually been measured on. `packages/seal/README.md` is the
  pattern: it names the real documents it was tried on and the two defects they
  found, without naming the documents.
- `packages/*/documentation/*.md` - how each stage decides, with the numbers.
  `packages/scan/documentation/audit.md` carries the calibration results and,
  as importantly, what they do not prove.
- **Code comments carry the why**, and often a measurement: why brackets are
  balanced rather than nearest-match, why `struck` is judged on eroded ink
  rather than fill, why every stage import is `import type` or `await import()`.
  Match that when you add code; a comment restating the line above it is noise,
  a comment recording what was measured is the point.
- **Commit messages are the long form.** `git log` is where a decision and the
  evidence for it were written down at the time.

## Before you change anything

- `CLAUDE.md` - the Nx rules for this workspace.
- The **vertical slice architecture** governs every file: capability, then
  cohesive subfeature, then flat role-suffixed files. The
  `vertical-slice-architect` agent in `.claude/agents/` carries the rules and
  the report format - use it for placement questions and structure reviews. The
  workspace lint enforces part of it (`@mnci/eslint-config`, `verticalSlices`).
- `documentation/releasing.md` - how a release is cut, and the two kinds of
  staleness that follow one.
- `tools/calibration/README.md` - how the audit's thresholds were measured, and
  how to measure them again on another document.

## Two standing rules

- **Real documents never enter the repository.** Measure against a folder kept
  outside it, and commit the numbers rather than the pages.
- **Verify before claiming.** `npx nx run-many -t lint,typecheck,test,build`
  covers every project. If a test fails, say so with its output; a passing
  build is the only evidence that something works.

