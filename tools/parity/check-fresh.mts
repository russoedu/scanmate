/**
 * Fails when the committed goldens no longer match the TypeScript that produced them.
 *
 * The Python port is measured against `tools/parity/goldens`. Those files are
 * only as good as the build they came from, so a change to the TypeScript that
 * moves a number leaves the goldens stale — and a stale golden is worse than
 * none: the Python tests keep passing while the two implementations have
 * silently diverged, which is the exact failure this whole parity spine exists
 * to prevent.
 *
 * So this regenerates them and asks git whether anything moved. Drift in the
 * TypeScript fails CI here, loudly, instead of surfacing later as a Python test
 * that "mysteriously" disagrees.
 *
 * Run after a build, like the writer it calls.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')

const written = spawnSync(process.execPath, [join(here, 'write-goldens.mts')], {
  cwd:      repoRoot,
  encoding: 'utf8',
  stdio:    'inherit',
})
if (written.status !== 0) {
  // Thrown, not `process.exit`: the non-zero status is what CI reads, and an
  // uncaught throw gives that plus a stack naming this file.
  throw new Error('Could not regenerate the goldens - build the TypeScript first.')
}

/*
 * `--exit-code` on the goldens directory alone. Scoped, so an unrelated dirty
 * file in the working tree cannot fail this, and `--` so a path that looks like
 * a flag cannot be read as one.
 */
const diff = spawnSync('git', ['diff', '--exit-code', '--', join('tools', 'parity', 'goldens')], {
  cwd:      repoRoot,
  encoding: 'utf8',
  stdio:    'inherit',
})

if (diff.status !== 0) {
  throw new Error(
    'The goldens are stale: regenerating them from the current TypeScript build changed them. ' +
    'The TypeScript moved, so the Python port is now being measured against numbers it no longer ' +
    'has to match. Commit the regenerated goldens together with whatever Python change keeps the ' +
    'port in step - never on their own.',
  )
}
console.log('goldens are fresh')
