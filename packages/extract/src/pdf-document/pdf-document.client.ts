import type { ScanmateBinarySource } from '@scanmate/ink'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

/**
 * Opening a PDF with pdf.js, in Node.
 *
 * Three things here are easy to get wrong and each fails quietly, so they live
 * in one place:
 *
 * 1. **`getDocument` detaches the buffer it is given.** Hand it the caller's
 *    bytes and the caller is left holding a zero-length array. It always gets a
 *    copy.
 * 2. **Standard fonts need a filesystem path, not a URL.** A born-digital PDF
 *    that uses Helvetica or Times without embedding them renders with fallback
 *    metrics unless pdf.js can load the standard-14 data - which ships inside
 *    `pdfjs-dist` itself, so no system fonts are ever needed. In Node pdf.js
 *    reads it with `fs`, so a `file://` URL silently loads nothing.
 * 3. **That path must end in a forward slash, on every platform.** pdf.js
 *    validates it and throws `Invalid factory url` otherwise, so Windows
 *    separators are normalised.
 */

/** A path to a PDF, or its bytes. A string is a filesystem path. */

export interface OpenedPdf {
  document:   PDFDocumentProxy
  /** Size of the source, in bytes. */
  byteLength: number
  /** Release everything pdf.js holds for this document. Safe to call twice. */
  close:      () => Promise<void>
}

let standardFonts: string | undefined

/** Where `pdfjs-dist` keeps the standard-14 font data, as pdf.js wants it spelled. */
export function standardFontDirectory (): string {
  if (standardFonts !== undefined) return standardFonts

  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve('pdfjs-dist/package.json'))
  standardFonts = join(root, 'standard_fonts').replaceAll('\\', '/') + '/'

  return standardFonts
}

export async function openPdf (input: ScanmateBinarySource): Promise<OpenedPdf> {
  const bytes = await readBytes(input)
  if (bytes.byteLength === 0) throw new Error('cannot open an empty PDF')

  const task = getDocument({
    // A copy, always: pdf.js transfers ownership of what it is given. A typed
    // copy - spread into a plain array, a 5 MB scan is five million numbers.
    data:                new Uint8Array(bytes),
    standardFontDataUrl: standardFontDirectory(),
    useSystemFonts:      false,
  })
  const document = await task.promise
  let closed = false

  return {
    document,
    byteLength: bytes.byteLength,
    close:      async () => {
      if (closed) return
      closed = true
      await task.destroy()
    },
  }
}

async function readBytes (input: ScanmateBinarySource): Promise<Uint8Array> {
  if (typeof input === 'string') return new Uint8Array(await readFile(input))
  if (input instanceof URL) return new Uint8Array(await readFile(fileURLToPath(input)))
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)

  throw new TypeError('expected a path, a file URL, a Uint8Array or an ArrayBuffer')
}
