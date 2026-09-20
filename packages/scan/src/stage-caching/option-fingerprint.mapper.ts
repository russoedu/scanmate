/**
 * A stable key for an option bag, so a stage knows whether it has already run
 * with these settings.
 *
 * Not `JSON.stringify`: key order would make two identical bags disagree, an
 * explicit `undefined` would differ from an absent key, an OCR engine or a
 * normalisation predicate would throw or serialise to nothing, and a raster
 * would stringify megabytes of pixels to decide a cache hit.
 *
 * So keys are sorted, `undefined` is elided, and anything that cannot be
 * compared by value - a function, an engine, a typed array - is compared by
 * **identity**, through a counter kept in a `WeakMap`. Two calls passing the
 * same engine agree; two calls passing equivalent-looking engines do not, which
 * is the safe direction: a false miss costs time, a false hit returns the wrong
 * answer.
 */

const identities = new WeakMap<object, number>()
let nextIdentity = 0

function identity (value: object): number {
  let id = identities.get(value)
  if (id === undefined) {
    id = nextIdentity++
    identities.set(value, id)
  }

  return id
}

function stable (value: unknown): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return `bigint:${value}`
  if (typeof value === 'function') return `fn#${identity(value)}`
  if (typeof value !== 'object') return String(value)

  if (ArrayBuffer.isView(value)) return `bytes:${(value).byteLength}#${identity(value)}`
  if (value instanceof ArrayBuffer) return `buffer:${value.byteLength}#${identity(value)}`
  if (value instanceof URL) return `url:${value.href}`
  if (Array.isArray(value)) return value.map(item => stable(item))

  const raster = value as { width?: unknown, height?: unknown, data?: unknown }
  // A raster is identified by its shape and which object it is, never by its pixels.
  if (typeof raster.width === 'number' && typeof raster.height === 'number' && ArrayBuffer.isView(raster.data))
    return `raster:${raster.width}x${raster.height}#${identity(value)}`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, of]) => of !== undefined)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, of]) => [key, stable(of)] as const)

  // An object with no comparable content is still a distinct thing to a caller.
  return entries.length === 0 && Object.keys(value).length > 0 ? `object#${identity(value)}` : Object.fromEntries(entries)
}

/** A stable string for any option bag. Equal strings mean equal settings. */
export function fingerprint (value: unknown): string {
  return JSON.stringify(stable(value)) ?? 'undefined'
}
