import { writeSync } from 'node:fs'

/**
 * Logs every module specifier Node is asked to resolve, then defers to the default.
 *
 * Hooks run on their own thread, where `process.stdout.write` is relayed to the
 * main thread asynchronously - and lines still in flight when the process exits
 * are lost, which under load made a resolved package look unresolved. Writing
 * straight to the descriptor lands each line before the resolution goes on.
 */
export async function resolve (specifier, context, next) {
  writeSync(1, `RESOLVE ${specifier}\n`)

  return next(specifier, context)
}
