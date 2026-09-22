import type { OcrEngine } from '@scanmate/ocr'

import type { CalibrationSample } from '../audit-calibration'

import type { ScanmateDocument } from '../document-input'
import { SharedEngine } from '../reading-engine'
import type { ScanmateOptions } from '../session-contract'
import { calibrateAudit, sampleAudit } from '../audit-calibration'
import type { AuditingSession, CalibrateOptions, CalibrationCase, CorpusCalibration } from './corpus-calibration.contract'

type OpenSession = (original: ScanmateDocument, scanned: ScanmateDocument, options: ScanmateOptions) => AuditingSession

/** One case's settings: the run's, with the case's own over them, each stage's bag merged rather than replaced. */
function forCase (session: ScanmateOptions, item: CalibrationCase, engine: OcrEngine): ScanmateOptions {
  const own = item.options ?? {}
  const bags = ['merge', 'extract', 'align', 'enhance', 'ocr', 'diff', 'find', 'audit'] as const
  const merged: ScanmateOptions = { ...session, ...own, engine, expected: item.expected ?? own.expected ?? session.expected }
  for (const bag of bags) {
    const both = { ...session[bag], ...own[bag] }
    if (Object.keys(both).length > 0) Object.assign(merged, { [bag]: both })
  }

  // Nothing here reads the evidence images, and they are most of an audit's bytes.
  return { ...merged, audit: { ...merged.audit, output: 'none' } }
}

/**
 * Audit every document of a labelled corpus, then measure the thresholds on it.
 *
 * One document at a time, each in its own session disposed before the next is
 * opened, so a corpus of any size costs the memory of its largest document.
 * One OCR engine serves them all. The audit keeps no evidence images - nothing
 * here looks at them - and each document is reduced to its sample as soon as
 * it is done.
 */
export async function calibrateCorpus (
  corpus: Iterable<CalibrationCase> | AsyncIterable<CalibrationCase>,
  options: CalibrateOptions,
  open: OpenSession,
): Promise<CorpusCalibration> {
  const { grid, onCase, ...session } = options
  const engine = new SharedEngine(session.engine, () => session.ocr?.tesseract)
  const samples: CalibrationSample[] = []

  try {
    let index = 0
    for await (const item of corpus) {
      index++
      const { engine: leased } = await engine.lease()
      const scan = open(item.original, item.scanned, forCase(session, item, leased))
      try {
        const sample = sampleAudit(await scan.audit(), item, { diff: session.diff })
        samples.push(sample)
        await onCase?.({ index, id: item.id, sample })
      } finally {
        await scan.dispose()
      }
    }
  } finally {
    await engine.dispose()
  }

  return { samples, report: calibrateAudit(samples, grid) }
}
