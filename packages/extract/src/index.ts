/**
 * `@scanmate/extract` - PDF pages as rasters, with what each page says about itself.
 *
 * ```ts
 * import { extractPair } from '@scanmate/extract'
 * import { alignPages } from '@scanmate/align'
 *
 * const { pages, unpaired } = await extractPair({ original: 'contract.pdf', scanned: 'returned.pdf' })
 * const aligned = await alignPages(pages)
 * ```
 *
 * Every page carries its metadata: size and rotation, whether it is a scan or
 * born-digital, the text layer and where each run of it sits, and the real resolution of a
 * scanned page. By default each pair is rendered at the scan's own resolution,
 * which is what makes the two sides directly comparable.
 *
 * pdf.js does the parsing and `@napi-rs/canvas` - a prebuilt Skia addon with
 * nothing to install on the host - does the drawing.
 */

export { inspectDocument } from './document-inspection'
export type { DocumentInfo, DocumentInspection, InspectedPage, InspectOptions } from './document-inspection'
export { extractPages, extractPageStream, extractPair, extractPairStream } from './page-extraction'
export type { ExtractedPage, ExtractOptions, ExtractPairOptions, PagePairing, PageSelection, PairedDocument, PairedPage } from './page-extraction'

export type { EmbeddedImage, PageKind, PageMetadata } from './page-inspection'
export type { DpiChoice } from './page-rendering'

// --- Building blocks, for pipelines that need to stop part way ---

export { openPdf } from './pdf-document'
export type { OpenedPdf } from './pdf-document'
export { classifyPage, inspectPage, SCAN_COVERAGE } from './page-inspection'
export { DEFAULT_DPI_LIMITS, nativeDpi, pageDpi, pairDpi, renderPage } from './page-rendering'
export type { DpiLimits, RenderOptions } from './page-rendering'
export { planPairs, selectPages } from './page-extraction'
export { readTextLayer } from './text-layer'
export type { TextLayer } from './text-layer'

// --- Synthetic PDFs, for tests and deployment smoke checks ---

export { A4, createSyntheticPdf } from './synthetic-pdf'
export type { SyntheticImage, SyntheticLine, SyntheticPdfPage, SyntheticText } from './synthetic-pdf'
