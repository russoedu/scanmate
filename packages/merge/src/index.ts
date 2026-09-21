/**
 * `@scanmate/merge` - PDFs, images and rasters into one PDF.
 *
 * ```ts
 * import { mergeDocuments } from '@scanmate/merge'
 *
 * // What a person uploaded, page by page, as one document:
 * const { pdf } = await mergeDocuments(['page-1.jpg', 'page-2.jpg', 'annex.pdf'])
 *
 * // A pipeline's aligned pages as one evidence file:
 * const evidence = await mergeDocuments(aligned.map(p => ({ raster: p.aligned.raster, dpi: p.original.dpi })))
 * ```
 *
 * PDF pages are copied, never re-rendered. A JPEG goes in as its own bytes and
 * a PNG's pixels losslessly; everything else - TIFF (every page), WebP, HEIF,
 * AVIF, rasters - is decoded and encoded once, losslessly by default. A single
 * PDF on its own comes back byte for byte.
 *
 * PDF writing is `@cantoo/pdf-lib`, the maintained fork of pdf-lib: pure
 * JavaScript, nothing to install on the host. Image decoding is `@scanmate/ink`.
 */

export { mergeDocuments } from './document-merge'
export type { Embedding, MergedPage, MergeOptions, MergeResult } from './document-merge'
export { MergeSourceError } from './source-reading'
export type { SourceKind } from './source-reading'
export { markPages } from './page-marking'
export type { MarkOptions, MarkResult, PageMark } from './page-marking'
export type { PageSize } from './page-placement'

// --- Building blocks ---

export { MIN_RECORDED_DPI, PAPER, placeImage, resolveDpi } from './page-placement'
export type { Placement } from './page-placement'
export { isPdf, readSource } from './source-reading'
export type { ResolvedSource } from './source-reading'
export { toUserSpace, viewportSize, viewportTransform } from './page-marking'
export type { Affine, PageGeometry } from './page-marking'
