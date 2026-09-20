import { EncryptedPDFError, PDFDocument } from '@cantoo/pdf-lib'
import type { PDFImage } from '@cantoo/pdf-lib'
import { decodeImage, encodeImage, readImageMetadata } from '@scanmate/ink'
import type { ImageMetadata, Raster, ScanmateSource } from '@scanmate/ink'

import { placeImage, resolveDpi } from '../page-placement'
import type { PageSize } from '../page-placement'
import { MergeSourceError, readSource } from '../source-reading'
import type { ResolvedSource, SourceKind } from '../source-reading'
import type { Embedding, MergedPage, MergeOptions, MergeResult } from './merge-result.contract'

/**
 * Many files in, one PDF out: PDFs, images and rasters, in the order given,
 * mixed freely.
 *
 * A PDF's pages are copied, not re-rendered, so their text layer, vectors and
 * any signatures stay as they were. A JPEG with no EXIF rotation, in RGB or
 * grey, is embedded as its own bytes, so a scan is not compressed a second
 * time; a PNG's pixels are carried over losslessly (the PDF holds them deflated,
 * not as the PNG file). Anything else is decoded - EXIF rotation applied,
 * transparency flattened onto white, every page of a multi-page TIFF - and
 * encoded once. The upload a person scanned page by page
 * becomes one document in upload order, and a pipeline's aligned or enhanced
 * pages become one evidence file.
 */
export async function mergeDocuments (sources: readonly ScanmateSource[], options: MergeOptions = {}): Promise<MergeResult> {
  const { pageSize = 'image', margin = 0, imageDpi = 150, encoding = 'png', quality = 92, passThrough = true, metadata, onProgress } = options
  if (sources.length === 0) throw new RangeError('nothing to merge')

  const resolved: ResolvedSource[] = []
  for (const [index, source] of sources.entries()) resolved.push(await readSource(source, index))

  const context: Context = { merged: await PDFDocument.create(), pages: [], pageSize, margin, imageDpi, encoding, quality }

  for (const [index, source] of resolved.entries()) {
    const started = Date.now()
    onProgress?.({ stage: 'merge', phase: 'start', page: index + 1, index: index + 1, total: resolved.length })
    const before = context.pages.length

    if (source.kind === 'pdf') await appendPdf(context, source.bytes, index)
    else if (source.kind === 'image') await appendImageFile(context, source.bytes, index)
    else await appendRaster(context, source, index)

    onProgress?.({
      stage:      'merge',
      phase:      'done',
      page:       index + 1,
      index:      index + 1,
      total:      resolved.length,
      durationMs: Date.now() - started,
      detail:     { kind: source.kind, pages: context.pages.length - before },
    })
  }

  const [first] = resolved
  if (passThrough && metadata === undefined && resolved.length === 1 && first.kind === 'pdf')
    return { pdf: first.bytes, pageCount: context.pages.length, pages: context.pages, passedThrough: true }

  const { merged } = context
  merged.setProducer('@scanmate/merge')
  if (metadata?.title !== undefined) merged.setTitle(metadata.title)
  if (metadata?.author !== undefined) merged.setAuthor(metadata.author)
  if (metadata?.subject !== undefined) merged.setSubject(metadata.subject)
  if (metadata?.keywords !== undefined) merged.setKeywords(metadata.keywords)
  if (metadata?.creator !== undefined) merged.setCreator(metadata.creator)

  return { pdf: await merged.save(), pageCount: context.pages.length, pages: context.pages, passedThrough: false }
}

interface Context {
  merged:   PDFDocument
  pages:    MergedPage[]
  pageSize: PageSize
  margin:   number
  imageDpi: number
  encoding: 'png' | 'jpeg'
  quality:  number
}

interface Origin {
  index:      number
  sourcePage: number
  kind:       SourceKind
  embedding:  Embedding
}

async function appendPdf (context: Context, bytes: Uint8Array, index: number): Promise<void> {
  const source = await loadPdf(bytes, index)
  const copied = await context.merged.copyPages(source, source.getPageIndices())

  for (const [i, page] of copied.entries()) {
    context.merged.addPage(page)
    const { width, height } = page.getSize()
    context.pages.push({
      page:       context.pages.length + 1,
      source:     index + 1,
      sourcePage: i + 1,
      kind:       'pdf',
      embedding:  'pdf-page',
      width,
      height,
      dpi:        null,
    })
  }
}

async function loadPdf (bytes: Uint8Array, index: number): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (error) {
    if (error instanceof EncryptedPDFError)
      throw new MergeSourceError(index, 'it is an encrypted PDF, which cannot be copied without its password')

    throw new MergeSourceError(index, `it is not a readable PDF (${error instanceof Error ? error.message : String(error)})`)
  }
}

async function appendImageFile (context: Context, bytes: Uint8Array, index: number): Promise<void> {
  const meta = await imageMetadata(bytes, index)
  const dpi = resolveDpi(undefined, meta.density, context.imageDpi)
  const upright = (meta.orientation ?? 1) === 1
  const asJpeg = meta.format === 'jpeg' && upright && (meta.space === 'srgb' || meta.space === 'b-w')
  const asPng = meta.format === 'png' && upright

  if (meta.pages === 1 && (asJpeg || asPng)) {
    const image = asJpeg ? await context.merged.embedJpg(bytes) : await context.merged.embedPng(bytes)
    place(context, image, meta.width, meta.height, dpi, { index, sourcePage: 1, kind: 'image', embedding: asJpeg ? 'jpeg' : 'png' })

    return
  }

  for (let page = 0; page < meta.pages; page++) {
    const raster = await decodeImage(bytes, { page })
    const { image, embedding } = await encodeAndEmbed(context, raster)
    place(context, image, raster.width, raster.height, dpi, { index, sourcePage: page + 1, kind: 'image', embedding })
  }
}

async function imageMetadata (bytes: Uint8Array, index: number): Promise<ImageMetadata> {
  try {
    return await readImageMetadata(bytes)
  } catch {
    throw new MergeSourceError(index, 'it is neither a PDF nor an image that can be read')
  }
}

async function appendRaster (context: Context, source: Extract<ResolvedSource, { kind: 'raster' }>, index: number): Promise<void> {
  const { raster, bytes } = source
  const dpi = resolveDpi(source.dpi, null, context.imageDpi)
  const format = bytes === null ? null : embeddableFormat(bytes)

  if (bytes !== null && format !== null) {
    const image = format === 'jpeg' ? await context.merged.embedJpg(bytes) : await context.merged.embedPng(bytes)
    place(context, image, raster.width, raster.height, dpi, { index, sourcePage: 1, kind: 'raster', embedding: format })

    return
  }

  const { image, embedding } = await encodeAndEmbed(context, raster)
  place(context, image, raster.width, raster.height, dpi, { index, sourcePage: 1, kind: 'raster', embedding })
}

async function encodeAndEmbed (context: Context, raster: Raster): Promise<{ image: PDFImage, embedding: Embedding }> {
  if (context.encoding === 'jpeg') {
    const jpeg = await encodeImage(raster, { format: 'jpeg', quality: context.quality })

    return { image: await context.merged.embedJpg(jpeg), embedding: 'encoded-jpeg' }
  }

  const png = await encodeImage(raster, { format: 'png' })

  return { image: await context.merged.embedPng(png), embedding: 'encoded-png' }
}

function place (context: Context, image: PDFImage, pixelWidth: number, pixelHeight: number, dpi: number, origin: Origin): void {
  const placement = placeImage(pixelWidth, pixelHeight, dpi, context.pageSize, context.margin)
  const page = context.merged.addPage([placement.pageWidth, placement.pageHeight])
  page.drawImage(image, { x: placement.x, y: placement.y, width: placement.width, height: placement.height })
  context.pages.push({
    page:       context.pages.length + 1,
    source:     origin.index + 1,
    sourcePage: origin.sourcePage,
    kind:       origin.kind,
    embedding:  origin.embedding,
    width:      placement.pageWidth,
    height:     placement.pageHeight,
    dpi,
  })
}

/** PNG or JPEG by signature - the two formats a PDF takes as they are. */
function embeddableFormat (bytes: Uint8Array): 'png' | 'jpeg' | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'png'
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'jpeg'

  return null
}
