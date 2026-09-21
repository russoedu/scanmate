import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * That every type a stage publishes can be named from here.
 *
 * A session's options and results are the stages' own types, so a caller who
 * installed only `@scanmate/scan` must be able to reach each of them - or one
 * stays stuck inside its package, reachable only by adding that package to the
 * caller's manifest. The list is written out by hand in the barrel, so a type
 * added to a stage later would be missed without this.
 *
 * And that none of it is a value: a value re-exported from a stage would load
 * that stage the moment this package is imported, which is exactly what the
 * lazy loading exists to prevent.
 */

const packages = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const STAGES = ['ink', 'extract', 'align', 'enhance', 'ocr', 'diff', 'find', 'merge', 'audit']
const barrel = readFileSync(join(packages, 'scan/src/index.ts'), 'utf8')

/** The names in each `export type { ... } from '<from>'` of a barrel, as `[exported, as]`. */
function typeExports (source: string, from?: string): Array<[string, string]> {
  const names: Array<[string, string]> = []
  for (const [, list, specifier] of source.matchAll(/export type \{([^}]*)\} from '([^']+)'/g)) {
    if (from !== undefined && specifier !== from) continue
    for (const entry of list.split(',')) {
      const [name, alias = name] = entry.trim().split(/\s+as\s+/, 2)
      if (name !== '') names.push([name, alias])
    }
  }

  return names
}

describe('the types this package passes on', () => {
  it.each(STAGES)('@scanmate/%s: every type it exports is exported here', stage => {
    const published = typeExports(readFileSync(join(packages, stage, 'src/index.ts'), 'utf8')).map(([, name]) => name)
    const passedOn = new Set(typeExports(barrel, `@scanmate/${stage}`).map(([name]) => name))
    // A type one stage only passes on from ink is reached through ink's own export.
    const fromInk = new Set(typeExports(barrel, '@scanmate/ink').map(([name]) => name))

    expect(published.filter(name => !passedOn.has(name) && !fromInk.has(name))).toEqual([])
  })

  it('exports no name twice', () => {
    const exported = typeExports(barrel).map(([, alias]) => alias)

    expect(exported.filter((name, i) => exported.indexOf(name) !== i)).toEqual([])
  })

  it('takes nothing but types from a stage', () => {
    expect(barrel).not.toMatch(/^export \{[^}]*\} from '@scanmate\//m)
    expect(barrel).not.toMatch(/^export \* from '@scanmate\//m)
  })
})
