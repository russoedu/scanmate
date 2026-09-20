import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { isRaster } from '@scanmate/ink'
import type { Raster, ScanmateSource } from '@scanmate/ink'

import { MergeSourceError } from './merge-source.contract'

/**
 * A source resolved to what merging needs: its bytes and what they are, or its
 * pixels. Content decides, never the file name - a scanner that saves a PDF as
 * `scan.jpg` still gives a PDF.
 */
export type ResolvedSource =
  | { kind: 'pdf', bytes: Uint8Array } |
  { kind: 'image', bytes: Uint8Array, dpi: null } |
  { kind: 'raster', raster: Raster, dpi: number | null, bytes: Uint8Array | null }

/** A PDF may carry junk before its header; readers look for it in the first kilobyte. */
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2D] // %PDF-
const HEADER_WINDOW = 1024

export async function readSource (source: ScanmateSource, index: number): Promise<ResolvedSource> {
  if (isRaster(source)) return { kind: 'raster', raster: source, dpi: null, bytes: null }
  if (isImageWithResolution(source))
    return { kind: 'raster', raster: source.raster, dpi: source.dpi ?? null, bytes: source.image ?? null }

  const bytes = await readBytes(source, index)
  if (bytes.byteLength === 0) throw new MergeSourceError(index, 'it is empty')

  return isPdf(bytes) ? { kind: 'pdf', bytes } : { kind: 'image', bytes, dpi: null }
}

export function isPdf (bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length - PDF_HEADER.length, HEADER_WINDOW)
  for (let start = 0; start <= end; start++)
    if (PDF_HEADER.every((b, i) => bytes[start + i] === b)) return true

  return false
}

function isImageWithResolution (source: ScanmateSource): source is { raster: Raster, dpi?: number | null, image?: Uint8Array | null } {
  return typeof source === 'object' && source !== null && 'raster' in source && isRaster(source.raster)
}

async function readBytes (source: Exclude<ScanmateSource, Raster | { raster: Raster }>, index: number): Promise<Uint8Array> {
  try {
    if (typeof source === 'string') return new Uint8Array(await readFile(source))
    if (source instanceof URL) return new Uint8Array(await readFile(fileURLToPath(source)))
    if (source instanceof ArrayBuffer) return new Uint8Array(source)
    if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
  } catch (error) {
    throw new MergeSourceError(index, `it could not be read (${error instanceof Error ? error.message : String(error)})`)
  }

  throw new MergeSourceError(index, 'expected a path, a file URL, bytes, a raster or { raster, dpi }')
}
