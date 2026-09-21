/** Turning each thing handed to merge - a path, bytes, pixels - into a PDF, an image or a raster. */

export { MergeSourceError } from './merge-source.contract'
export type { SourceKind } from './merge-source.contract'
export { isPdf, readSource } from './read-source.use-case'
export { openPdf, PdfPasswordError } from './open-pdf.use-case'
export type { OpenPdfOptions } from './open-pdf.use-case'
export type { ResolvedSource } from './read-source.use-case'
