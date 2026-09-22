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
 * | a PDF and an image | the PDF's page rendered at the image's resolution | extract |
 * | two images | decoded, one page | ink only |
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

  if (onePdf !== twoPdf) return { ...await pairWithImage(onePdf ? one : two, onePdf ? two : one, onePdf ? 'original' : 'scanned', options), merged }

  // Two images: nothing to render, and nothing but the kernel loads.
  return { pages: await pairImages(one, two), unpaired: { original: [], scanned: [] }, merged, warning: null }
}

/**
 * A document on one side and an image on the other - a PDF original and a
 * photographed page, say.
 *
 * The image is one page, so it pairs with one page of the document: the first
 * that `extract.pages` selects, or page 1. That page is rendered at the image's
 * own resolution - its pixels over the page's width in inches - so the two are
 * compared at a matched scale, and it keeps its text layer, so the reading and
 * the audit still know what the page prints.
 */
async function pairWithImage (
  pdf: ScanmateSource,
  image: ScanmateSource,
  pdfSide: 'original' | 'scanned',
  options: ResolveOptions,
): Promise<Omit<ResolvedDocument, 'merged'>> {
  const { decodeImage, readImageMetadata } = await loadInk()
  const { extractPages, inspectDocument, selectPages } = await loadExtract()
  const document = pdf as ScanmateBinarySource

  const { pageCount } = await inspectDocument(document)
  const [number] = selectPages(options.extract?.pages, pageCount)
  const inspected = await inspectDocument(document, { pages: [number] })
  const [geometry] = inspected.pages
  const raster: Raster = await decodeImage(image)
  const photo: PageImage = { raster, image: null, width: raster.width, height: raster.height, dpi: await resolution(image, readImageMetadata) }
  const dpi = raster.width / (geometry.displayWidth / 72)
  const [rendered] = await extractPages(document, { ...options.extract, pages: [number], dpi, output: 'none', onProgress: options.onProgress })
  const sides = pdfSide === 'original' ? { original: rendered.image, scanned: photo } : { original: photo, scanned: rendered.image }

  return {
    pages:    [{ page: number, ...sides, scannedPage: 1, metadata: { [pdfSide]: rendered.metadata } }],
    unpaired: { original: [], scanned: [] },
    warning:  pageCount > 1 ? `the image was compared with page ${number} of a ${pageCount}-page document; choose another with extract.pages` : null,
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
    metadata:    {},
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
