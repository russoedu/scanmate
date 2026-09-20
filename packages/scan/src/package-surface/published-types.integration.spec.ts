import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * That the published declarations actually resolve.
 *
 * Every other suite in this workspace compiles against `src`, where a relative
 * specifier resolves through TypeScript's own path mapping and a packaging
 * defect is invisible. A consumer resolves through `node_modules` instead, and
 * under `node16`, `nodenext` or `bundler` there is **no directory-index
 * fallback**: `'./scan-session.js'` does not quietly become
 * `'./scan-session/index.js'`. TypeScript cannot resolve it, and rather than
 * erroring it degrades the module to `any` - so the package still runs, still
 * imports, and silently offers a consumer no types at all.
 *
 * That is exactly what `@scanmate/scan@0.2.1` shipped: it is the only package
 * whose root barrel re-exports folder barrels, and its `rollup.config.cjs`
 * carried an older normaliser that appended `.js` to every bare specifier
 * without asking whether it named a file or a directory.
 *
 * So this walks what is actually on disk, for every package, and fails if any
 * relative specifier names something that was never emitted.
 */

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const packages = join(workspace, 'packages')

/** Every `.d.ts` under a directory, at any depth. */
function declarations (directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.d.ts'))
    .map(entry => join(entry.parentPath, entry.name))
}

/** Where a relative specifier in a declaration file would land, or `null` when nowhere. */
function resolves (from: string, specifier: string): boolean {
  const base = join(dirname(from), specifier)
  const candidates = specifier.endsWith('.js')
    ? [base.replace(/\.js$/, '.d.ts')]
    : [`${base}.d.ts`, join(base, 'index.d.ts')]

  return candidates.some(candidate => existsSync(candidate))
}

const named = readdirSync(packages, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)

describe('what the packages publish', () => {
  it.each(named)('%s: every specifier in its declarations resolves', name => {
    const manifest = JSON.parse(readFileSync(join(packages, name, 'package.json'), 'utf8')) as { types?: string }
    const dist = join(packages, name, 'dist')
    const entry = join(packages, name, (manifest.types ?? '').replace(/^\.\//, ''))
    const broken: string[] = []

    // Everything is collected rather than asserted one at a time, so a failure
    // lists every specifier that does not resolve instead of only the first.
    const built = existsSync(dist)
    // What `types` names has to be there, or a consumer gets nothing at all.
    const typed = built && existsSync(entry)
    if (!built) broken.push('there is no dist - the package was not built')
    if (built && !typed) broken.push(`types names ${manifest.types}, which was not emitted`)
    if (typed)
      for (const file of declarations(dist))
        for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/from\s+['"](\.[^'"]+)['"]/g))
          if (!resolves(file, specifier)) broken.push(`${file.slice(dist.length + 1)} -> ${specifier}`)

    expect(broken).toEqual([])
  })
})
