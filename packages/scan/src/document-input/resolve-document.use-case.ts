import type { ExtractPairOptions } from '@scanmate/extract'
import type { PageImage, ProgressCallback, Raster, ScanmateBinarySource, ScanmateSource } from '@scanmate/ink'
import type { MergeOptions } from '@scanmate/merge'

import { loadExtract, loadInk, loadMerge } from '../stage-loading'
import type { ResolvedDocument, ScanmateDocument, ScanmatePage } from './document-input.contract'
import { isPdfSource } from './pdf-sniff.policy'

/**
 * Turns what the caller has into pages the stages can work on.
 *
 * Three routes, and which one runs decides what gets loaded:
 *
 * | given | route | loads |
 * |---|---|---|
 * | an array | merged into one PDF, then extracted | merge, then extract |
 * | a PDF | extracted | extract |
 * | an image | decoded, one page | ink only |
 *
 * The last row is the one worth having. Two images compared against each other
 * is the commonest small case, and it never opens a PDF library at all.
 */

export interface ResolveOptions {
  merge?:      Omit<MergeOptions, 'onProgress'>
  extract?:    Omit<ExtractPairOptions, 'onProgress'>
  onProgress?: ProgressCallback
}

export async function resolveDocument (
  original: ScanmateDocument,
  scanned: ScanmateDocument,
  options: ResolveOptions = {},
): Promise<ResolvedDocument> {
  const merged = { original: null as Uint8Array | null, scanned: null as Uint8Array | null }

  const asDocument = async (side: ScanmateDocument, which: 'original' | 'scanned'): Promise<ScanmateSource> => {
    if (!Array.isArray(side)) return side as ScanmateSource
    const { mergeDocuments } = await loadMerge()
    const result = await mergeDocuments(side as readonly ScanmateSource[], { ...options.merge, onProgress: options.onProgress })
    merged[which] = result.pdf

    return result.pdf
  }

  const one = await asDocument(original, 'original')
  const two = await asDocument(scanned, 'scanned')
  const [onePdf, twoPdf] = await Promise.all([isPdfSource(one), isPdfSource(two)])

  if (onePdf && twoPdf) {
    const { extractPair } = await loadExtract()
    const pair = await extractPair(
      { original: one as ScanmateBinarySource, scanned: two as ScanmateBinarySource },
      { ...options.extract, onProgress: options.onProgress },
    )

    return {
      pages:    pair.pages as unknown as ScanmatePage[],
      unpaired: pair.unpaired,
      merged,
      warning:  null,
    }
  }

  // Not two PDFs. `dpi: 'match'` measures the scan against the original's own
  // page, which needs both sides to be documents, so it cannot apply here.
  const pages = await pairImages(one, two)

  return {
    pages,
    unpaired: { original: [], scanned: [] },
    merged,
    warning:  onePdf === twoPdf
      ? null
      : 'one side is a document and the other an image, so the two were not rendered at a matched resolution',
  }
}

/** Two images, decoded, as a single page pair. Loads the kernel and nothing else. */
async function pairImages (original: ScanmateSource, scanned: ScanmateSource): Promise<ScanmatePage[]> {
  const { decodeImage, readImageMetadata } = await loadInk()
  const side = async (source: ScanmateSource): Promise<PageImage> => {
    const raster: Raster = await decodeImage(source)
    const dpi = await resolution(source, readImageMetadata)

    return { raster, image: null, width: raster.width, height: raster.height, dpi }
  }
  const [first, second] = await Promise.all([side(original), side(scanned)])

  return [{
    page:        1,
    original:    first,
    scanned:     second,
    scannedPage: 1,
    metadata:    { original: null, scanned: null },
  }]
}

/** What the file says its resolution is, when it says anything. */
async function resolution (
  source: ScanmateSource,
  read: (input: ScanmateSource) => Promise<{ dpi?: number | null, density?: number | null }>,
): Promise<number | null> {
  try {
    const metadata = await read(source)

    return metadata.dpi ?? metadata.density ?? null
  } catch {
    // A raster given directly has no file to ask; that is not an error.
    return null
  }
}
