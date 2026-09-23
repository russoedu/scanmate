# Releasing

Every package is released together, at one version, by CI. Nothing is published
from a developer machine - and the repository is arranged so that an attempt
fails rather than half-succeeds (see the comments in `.npmrc`).

## The sequence

```bash
gh variable set RELEASE_SPECIFIER --body 0.22.0
```

Then merge the pull request into `main` with a **merge commit**. CI verifies
every project, versions every package to that specifier, tags, publishes to npm
and writes the GitHub Releases. When it is done:

```bash
gh variable delete RELEASE_SPECIFIER
```

**Delete it every time.** It is read on every push to `main`, so a variable left
set pins the next release to a version that has already been published, and that
run fails at the publish.

## Why an exact version, never a keyword

`RELEASE_SPECIFIER` accepts `major`, `minor` and `patch`, and they are the wrong
answer here. The packages depend on each other, and a keyword bump is resolved
per project from that project's own conventional commits: a change to
`@scanmate/ink` alone bumps ink, leaves `@scanmate/scan` where it was, and
publishes a scan that asks for a version of ink that did not exist when its
range was written. An exact `X.Y.Z` moves all of them together, which is the
only arrangement that has ever installed cleanly.

Pick the number by the largest change in the release: a new capability is a
minor, documentation and fixes are a patch.

## What the manifests say in git

`0.0.1`, all of them, and that is deliberate: `nx.json` sets `git.commit: false`
for the release, so CI writes the real version into each `package.json` and the
interdependency ranges at publish time and never commits them back. Do not
"fix" a manifest to the released version - the tags and the registry are the
record.

## Afterwards

Check the registry, and expect a delay:

```bash
npm view @scanmate/scan version --prefer-online
```

Two kinds of staleness follow a release, neither of them a fault:

- **The npm CDN propagates package by package**, over several minutes. A brand
  new package name - `@scanmate/seal` on its first release - took about five.
  Until every package has landed, `npm install @scanmate/scan@X.Y.Z` fails with
  `ETARGET no matching version found for @scanmate/ink@^X.Y.Z`, because scan's
  dependency cannot resolve yet.
- **npm caches the packument locally.** Once the registry has caught up, an
  install can still fail with the same `ETARGET` until you pass
  `--prefer-online`.

Read the CI log before concluding anything is wrong: it prints the tarball
contents and `Published to https://registry.npmjs.org/ with tag "latest"` for
each package, and that is the authority on what was actually released.

## Publishing or deprecating by hand

`npm deprecate` and friends are refused inside this directory, and the refusal
looks like a `404 PUT`. The project `.npmrc` overrides your login; read the
comments at the top of it for the two ways round.
