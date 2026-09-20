/** Logs every module specifier Node is asked to resolve, then defers to the default. */
export async function resolve (specifier, context, next) {
  process.stdout.write(`RESOLVE ${specifier}\n`)

  return next(specifier, context)
}
