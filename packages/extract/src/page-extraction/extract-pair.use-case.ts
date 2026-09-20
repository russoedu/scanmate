import { openPdf } from '../pdf-document'
import { inspectPage } from '../page-inspection'
import { DEFAULT_DPI_LIMITS, pairDpi, renderPage } from '../page-rendering'
import type { ExtractPairOptions, PairedDocument, PairedPage } from './extract-result.contract'
import { planPairs } from './page-pairing.policy'
import type { PairingPlan } from './page-pairing.policy'
import { selectPages } from './page-selection.mapper'
import type { ScanmateBinarySource } from '@scanmate/ink'

/**
 * An original PDF and the scan that came back, page by page, rendered so the two
 * are directly comparable - the input `@scanmate/align` expects.
 *
 * By default both sides of each pair are rendered at the *scan's* resolution
 * (`dpi: 'match'`). See `DpiChoice` for the measurements behind that default.
 *
 * {@link extractPairStream} yields one pair at a time, for the same memory reason
 * as `extractPageStream`; {@link extractPair} collects the pairs and adds the
 * pages that found no partner.
 */
export function extractPairStream (
  pdfs: { original: ScanmateBinarySource, scanned: ScanmateBinarySource },
  options: ExtractPairOptions = {},
): AsyncGenerator<PairedPage> {
  return pairStream(pdfs, options, () => {})
}

export async function extractPair (
  pdfs: { original: ScanmateBinarySource, scanned: ScanmateBinarySource },
  options: ExtractPairOptions = {},
): Promise<PairedDocument> {
  let planned: { plan: PairingPlan, counts: PairedDocument['pageCount'] } | undefined
  const pages: PairedPage[] = []
  const stream = pairStream(pdfs, options, (plan, counts) => { planned = { plan, counts } })
  for await (const page of stream) pages.push(page)
  if (planned === undefined) throw new Error('extractPair finished without planning its pairs')

  return { pages, unpaired: planned.plan.unpaired, pageCount: planned.counts }
}

/** The shared generator. `onPlan` receives the pairing before the first page renders. */
async function * pairStream (
  pdfs: { original: ScanmateBinarySource, scanned: ScanmateBinarySource },
  options: ExtractPairOptions,
  onPlan: (plan: PairingPlan, counts: PairedDocument['pageCount']) => void,
): AsyncGenerator<PairedPage> {
  const {
    dpi = 'match',
    fallbackDpi = DEFAULT_DPI_LIMITS.fallbackDpi,
    minDpi = DEFAULT_DPI_LIMITS.minDpi,
    maxDpi = DEFAULT_DPI_LIMITS.maxDpi,
    pages: selection,
    output = 'png',
    quality = 92,
    background = 'white',
    includeText = true,
    pairing = 'index',
    onProgress,
  } = options

  const original = await openPdf(pdfs.original)
  try {
    const scanned = await openPdf(pdfs.scanned)
    try {
      const counts = { original: original.document.numPages, scanned: scanned.document.numPages }
      const plan = planPairs(counts.original, counts.scanned, pairing)
      onPlan(plan, counts)
      const wanted = new Set(selectPages(selection, original.document.numPages))
      const pairs = plan.pairs.filter(([o]) => wanted.has(o))

      for (const [position, [originalNumber, scannedNumber]] of pairs.entries()) {
        const started = Date.now()
        const index = position + 1
        onProgress?.({ stage: 'extract', phase: 'start', page: originalNumber, index, total: pairs.length })

        const originalPage = await original.document.getPage(originalNumber)
        const scannedPage = await scanned.document.getPage(scannedNumber)
        try {
          const originalMeta = await inspectPage(originalPage)
          const scannedMeta = await inspectPage(scannedPage)
          const metadata = includeText
            ? { original: originalMeta, scanned: scannedMeta }
            : { original: { ...originalMeta, text: null, textItems: [] }, scanned: { ...scannedMeta, text: null, textItems: [] } }

          const resolution = pairDpi(metadata.original, metadata.scanned, dpi, { fallbackDpi, minDpi, maxDpi })
          const render = { output, quality, background }
          const originalImage = await renderPage(originalPage, { ...render, dpi: resolution.original })
          const scannedImage = await renderPage(scannedPage, { ...render, dpi: resolution.scanned })

          onProgress?.({
            stage:      'extract',
            phase:      'done',
            page:       originalNumber,
            index,
            total:      pairs.length,
            durationMs: Date.now() - started,
            detail:     {
              dpi:          resolution,
              originalKind: metadata.original.kind,
              scannedKind:  metadata.scanned.kind,
            },
          })
          yield {
            page:        originalNumber,
            scannedPage: scannedNumber,
            original:    originalImage,
            scanned:     scannedImage,
            metadata,
          }
        } finally {
          originalPage.cleanup()
          scannedPage.cleanup()
        }
      }
    } finally {
      await scanned.close()
    }
  } finally {
    await original.close()
  }
}
