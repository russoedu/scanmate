import { open } from 'node:fs/promises'

import type { ScanmateSource } from '@scanmate/ink'

/**
 * Is this source a PDF?
 *
 * By its first five bytes, not its extension. A scan arrives named whatever the
 * scanner called it, and deciding what to do with a document by trusting its
 * name is how a JPEG ends up in a PDF parser.
 *
 * `@scanmate/merge` exports an `isPdf` that would do this, but importing it
 * would load `@cantoo/pdf-lib` on every session merely to look at five bytes -
 * exactly the cost this package exists to avoid. Five bytes is five lines.
 */

const SIGNATURE = '%PDF-'

export async function isPdfSource (source: ScanmateSource): Promise<boolean> {
  if (typeof source === 'string' || source instanceof URL) {
    const path = source instanceof URL ? source : source
    // A remote URL is not opened here; the stage that fetches it decides.
    if (path instanceof URL && path.protocol !== 'file:') return path.pathname.toLowerCase().endsWith('.pdf')

    const file = await open(path, 'r')
    try {
      const head = Buffer.alloc(SIGNATURE.length)
      const { bytesRead } = await file.read(head, 0, SIGNATURE.length, 0)

      return bytesRead === SIGNATURE.length && head.toString('latin1') === SIGNATURE
    } finally {
      await file.close()
    }
  }

  const bytes = source instanceof ArrayBuffer
    ? new Uint8Array(source, 0, Math.min(SIGNATURE.length, source.byteLength))
    : (ArrayBuffer.isView(source) ? new Uint8Array((source).buffer, (source).byteOffset, Math.min(SIGNATURE.length, (source).byteLength)) : null)
  if (bytes === null) return false

  return bytes.length === SIGNATURE.length && String.fromCodePoint(...bytes) === SIGNATURE
}
