import type { ScanmateBinarySource, ScanmateSource } from '@scanmate/ink'

import { isPdfSource } from '../document-input'
import type { ScanmateDocument } from '../document-input'
import { LazyEngine } from '../reading-engine'
import type { ScanmateOptions } from '../scan-session/scan-session.contract'
import { loadExtract, loadMerge, loadOcr } from '../stage-loading'
import type { BatchInfo, BatchOptions } from './batch-running.contract'

/** What `runInBatches` needs from a session, so it can run without importing the class that calls it. */
export interface BatchSession {
  dispose: () => Promise<void>
}

type OpenSession<Session extends BatchSession> = (original: ScanmateDocument, scanned: ScanmateDocument, options: ScanmateOptions) => Session

/**
 * A long document, a few pages at a time, with only what `work` returns kept.
 *
 * Each batch is its own session over a range of the original's pages, disposed
 * before the next is opened, so the peak is one batch's pixels however long the
 * document is. Everything else is done once: a side given as an array is
 * merged once, not per batch, and one OCR engine - started only if a batch
 * reads - serves every batch.
 */
export async function runInBatches<Session extends BatchSession, Result> (
  original: ScanmateDocument,
  scanned: ScanmateDocument,
  work: (session: Session, batch: BatchInfo) => Promise<Result>,
  options: BatchOptions,
  open: OpenSession<Session>,
): Promise<Result[]> {
  const { batch = 4, onBatch, ...session } = options
  if (!Number.isSafeInteger(batch) || batch < 1) throw new RangeError(`a batch is a whole number of pages, at least one: got ${batch}`)

  const [one, two] = [await asDocument(original, session), await asDocument(scanned, session)]
  const ranges = await batchesOf(one, two, batch, session)
  const engine = session.engine ?? new LazyEngine(async () => {
    const { createTesseractEngine } = await loadOcr()

    return await createTesseractEngine(session.ocr?.tesseract)
  })

  const results: Result[] = []
  try {
    for (const [position, pages] of ranges.entries()) {
      const info = { index: position + 1, count: ranges.length, pages }
      const scan = open(one, two, pages === null ? { ...session, engine } : { ...session, engine, extract: { ...session.extract, pages } })
      try {
        const result = await work(scan, info)
        results.push(result)
        await onBatch?.({ ...info, result })
      } finally {
        await scan.dispose()
      }
    }
  } finally {
    if (engine instanceof LazyEngine) await engine.release()
  }

  return results
}

/** A side as one document: an array of pages is merged here, once, rather than by every batch. */
async function asDocument (side: ScanmateDocument, options: ScanmateOptions): Promise<ScanmateDocument> {
  if (!Array.isArray(side)) return side
  const { mergeDocuments } = await loadMerge()

  const merged = await mergeDocuments(side as readonly ScanmateSource[], options.merge)

  return merged.pdf
}

/** The original's selected pages, in runs of `size`; one batch of everything when the pair is not two PDFs. */
async function batchesOf (original: ScanmateDocument, scanned: ScanmateDocument, size: number, options: ScanmateOptions): Promise<Array<number[] | null>> {
  const both = await Promise.all([isPdfSource(original as ScanmateSource), isPdfSource(scanned as ScanmateSource)])
  if (!both.every(Boolean)) return [null]

  const { inspectDocument, selectPages } = await loadExtract()
  // Reads the page tree and renders nothing.
  const { pageCount } = await inspectDocument(original as ScanmateBinarySource)
  const pages = selectPages(options.extract?.pages, pageCount)
  const ranges: number[][] = []
  for (let start = 0; start < pages.length; start += size) ranges.push(pages.slice(start, start + size))

  return ranges
}
