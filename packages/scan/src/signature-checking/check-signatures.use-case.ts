import { readFile } from 'node:fs/promises'

import type { ScanmateBinarySource } from '@scanmate/ink'
import type { SealReport } from '@scanmate/seal'

import type { ScanmateDocument } from '../document-input'
import { loadSeal } from '../stage-loading'

/**
 * Every signature in a document, checked against the bytes it covers.
 *
 * This asks a different question from the rest of the session, and answers it
 * without looking at a single pixel: not "does this say what was agreed", which
 * needs the original to compare against, but "has this file changed since
 * someone signed it", which the file answers by itself. Milliseconds, no
 * rendering, no reading.
 *
 * **On the document as it arrived, not as this package assembled it.** A side
 * given as images is merged here into a PDF that nobody signed, so verifying
 * that would be verifying our own bytes - always unsigned, and a lie by
 * construction. An assembled document reports `signed: false`, which is true.
 */
export async function checkSignatures (document: ScanmateDocument): Promise<SealReport> {
  if (Array.isArray(document)) return { signed: false, signatures: [], unbroken: false }

  const bytes = await read(document as ScanmateBinarySource)
  const { verifySignatures } = await loadSeal()

  return await verifySignatures(bytes)
}

/** The whole file, however the caller named it. A signature covers bytes, so bytes are what it takes. */
async function read (source: ScanmateBinarySource): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source
  if (source instanceof ArrayBuffer) return new Uint8Array(source)

  if (source instanceof URL && source.protocol !== 'file:') {
    const response = await fetch(source)
    if (!response.ok) throw new Error(`the document at ${source.href} could not be read: ${response.status} ${response.statusText}`)
    const body = await response.arrayBuffer()

    return new Uint8Array(body)
  }

  return await readFile(source)
}
