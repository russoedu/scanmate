import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'

/**
 * The vertical-slice rules this workspace is organised by, enforced by lint
 * rather than by review - review is what let them drift.
 *
 * Each package's `src/` holds subfeatures; each subfeature exposes an
 * `index.ts` and holds flat, role-suffixed files. See
 * `.claude/agents/vertical-slice-architect.md` for the full rules and the
 * reasoning behind them.
 */

const ROLES = ['handler', 'use-case', 'algorithm', 'policy', 'model', 'contract', 'mapper', 'validator', 'repository', 'client', 'store', 'error', 'config', 'enum']
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PRODUCTION = new RegExp(String.raw`^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:${ROLES.join('|')})\.ts$`)
const TEST = /\.spec\.ts$/
const SIBLING = /^\.\.\/([^./][^/]*)(\/.*)?$/

/** Where a file sits: its package's `src`, and the subfeature it belongs to (`null` at the root of `src`). */
function locate (filename) {
  const parts = filename.split(sep)
  const src = parts.lastIndexOf('src')
  if (src === -1) return null

  return { src: parts.slice(0, src + 1).join(sep), slice: parts.length - src > 2 ? parts[src + 1] : null, depth: parts.length - src - 2 }
}

/** The subfeatures a slice's production files import, by name. */
const graphs = new Map()
function graphOf (src) {
  let graph = graphs.get(src)
  if (graph !== undefined) return graph

  graph = new Map()
  const slices = readdirSync(src, { withFileTypes: true }).filter(entry => entry.isDirectory())
  for (const { name: slice } of slices) {
    const edges = new Set()
    const sources = files(join(src, slice))
    for (const file of sources) {
      const imports = readFileSync(file, 'utf8').matchAll(/(?:from|import\()\s*'\.\.\/([^./][^/']*)/g)
      for (const [, target] of imports) if (target !== slice) edges.add(target)
    }
    graph.set(slice, edges)
  }
  graphs.set(src, graph)

  return graph
}

function files (directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'fixtures' ? [] : files(path)

    return entry.name.endsWith('.ts') && !TEST.test(entry.name) ? [path] : []
  })
}

/** A path back from `from` to `to` through the graph, or `null`. */
function pathBetween (graph, from, to, seen = new Set()) {
  if (from === to) return [to]
  if (seen.has(from)) return null
  seen.add(from)
  const nexts = graph.get(from) ?? []
  for (const next of nexts) {
    const rest = pathBetween(graph, next, to, seen)
    if (rest !== null) return [from, ...rest]
  }

  return null
}

const SOURCES = {
  ImportDeclaration:      node => node.source,
  ExportNamedDeclaration: node => node.source,
  ExportAllDeclaration:   node => node.source,
  ImportExpression:       node => (node.source.type === 'Literal' ? node.source : null),
}

/** Calls `check` with every relative module specifier in the file. */
function onSpecifiers (check) {
  return Object.fromEntries(Object.entries(SOURCES).map(([type, pick]) => [type, (node) => {
    const source = pick(node)
    if (source !== null && source !== undefined && typeof source.value === 'string') check(source.value, source)
  }]))
}

export default {
  meta:  { name: 'slice-boundaries' },
  rules: {
    'file-role': {
      meta: {
        type:     'problem',
        messages: {
          case:    'Name files and folders in kebab-case: "{{name}}".',
          role:    'A production file ends in its role - .{{roles}}.ts - so "{{name}}" says what it is. See the vertical-slice rules.',
          nesting: 'A subfeature is flat: "{{name}}" sits in a folder inside one. Split the subfeature instead of nesting it.',
          root:    'Only index.ts lives at the root of src; "{{name}}" belongs in a subfeature.',
        },
        schema: [],
      },
      create (context) {
        const place = locate(context.filename)
        if (place === null) return {}
        const name = basename(context.filename)

        return {
          Program (node) {
            const folders = relative(place.src, dirname(context.filename)).split(sep).filter(part => part !== '')
            for (const folder of folders) if (folder !== 'fixtures' && !KEBAB.test(folder)) context.report({ node, messageId: 'case', data: { name: folder } })
            if (name !== 'index.ts' && !KEBAB.test(name.split('.', 1)[0])) context.report({ node, messageId: 'case', data: { name } })
            if (TEST.test(name)) return
            if (place.slice === null) {
              if (name !== 'index.ts') context.report({ node, messageId: 'root', data: { name } })
            } else if (place.depth > 1 && !folders.includes('fixtures')) {
              context.report({ node, messageId: 'nesting', data: { name } })
            } else if (name !== 'index.ts' && !PRODUCTION.test(name)) {
              context.report({ node, messageId: 'role', data: { name, roles: ROLES.join('|.') } })
            }
          },
        }
      },
    },

    'no-deep-import': {
      meta: {
        type:     'problem',
        messages: {
          deep: 'Reach "{{slice}}" through its index.ts - import from \'../{{slice}}\', not from a file inside it.',
          self: 'Import the files of your own subfeature directly, never through its own index.ts.',
        },
        schema: [],
      },
      create (context) {
        if (locate(context.filename)?.slice === null) return {}

        return onSpecifiers((specifier, node) => {
          const sibling = SIBLING.exec(specifier)
          if (sibling?.[2] !== undefined) context.report({ node, messageId: 'deep', data: { slice: sibling[1] } })
          if (['.', './', './index'].includes(specifier)) context.report({ node, messageId: 'self' })
        })
      },
    },

    'no-slice-cycle': {
      meta: {
        type:     'problem',
        messages: {
          cycle: 'Subfeatures import each other: {{path}}. Move what both need into a slice they can both depend on.',
        },
        schema: [],
      },
      create (context) {
        const place = locate(context.filename)
        if (place === null || place.slice === null || TEST.test(context.filename)) return {}

        return onSpecifiers((specifier, node) => {
          const sibling = SIBLING.exec(specifier)
          if (sibling === null || sibling[1] === place.slice) return
          const back = pathBetween(graphOf(place.src), sibling[1], place.slice)
          if (back !== null) context.report({ node, messageId: 'cycle', data: { path: [place.slice, ...back].join(' -> ') } })
        })
      },
    },
  },
}
