import { openPdf } from '../pdf-document'
import { inspectPage } from '../page-inspection'
import { DEFAULT_DPI_LIMITS, pageDpi, renderPage } from '../page-rendering'
import type { ExtractedPage, ExtractOptions } from './extract-result.contract'
import { selectPages } from './page-selection.mapper'
import type { ScanmateBinarySource } from '@scanmate/ink'

/**
 * Every requested page of one PDF, rendered, with what the page says about itself.
 *
 * {@link extractPageStream} yields pages one at a time and is the primitive: an
 * A4 page at 150 dpi is nearly 9 MB of RGBA, so a long document held whole is a
 * gigabyte a small function instance may not have. {@link extractPages} collects
 * the stream, for documents where that is fine.
 */
export async function * extractPageStream (pdf: ScanmateBinarySource, options: ExtractOptions = {}): AsyncGenerator<ExtractedPage> {
  const {
    dpi = 'native',
    fallbackDpi = DEFAULT_DPI_LIMITS.fallbackDpi,
    minDpi = DEFAULT_DPI_LIMITS.minDpi,
    maxDpi = DEFAULT_DPI_LIMITS.maxDpi,
    pages: selection,
    output = 'png',
    quality = 92,
    background = 'white',
    includeText = true,
    onProgress,
  } = options

  const opened = await openPdf(pdf)
  try {
    const pages = selectPages(selection, opened.document.numPages)
    for (const [position, number] of pages.entries()) {
      const started = Date.now()
      const index = position + 1
      onProgress?.({ stage: 'extract', phase: 'start', page: number, index, total: pages.length })

      const page = await opened.document.getPage(number)
      try {
        const inspected = await inspectPage(page)
        const metadata = includeText ? inspected : { ...inspected, text: null, textItems: [] }
        const renderDpi = pageDpi(metadata, dpi, { fallbackDpi, minDpi, maxDpi })
        const image = await renderPage(page, { dpi: renderDpi, output, quality, background })

        onProgress?.({
          stage:      'extract',
          phase:      'done',
          page:       number,
          index,
          total:      pages.length,
          durationMs: Date.now() - started,
          detail:     { kind: metadata.kind, dpi: renderDpi },
        })
        yield { page: number, image, metadata }
      } finally {
        page.cleanup()
      }
    }
  } finally {
    await opened.close()
  }
}

export async function extractPages (pdf: ScanmateBinarySource, options: ExtractOptions = {}): Promise<ExtractedPage[]> {
  const pages: ExtractedPage[] = []
  for await (const page of extractPageStream(pdf, options)) pages.push(page)

  return pages
}
