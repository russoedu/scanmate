import type { CalibrationSample } from '@scanmate/audit'

import type { ScanmateDocument } from '../document-input'
import { SharedEngine } from '../reading-engine'
import type { ScanmateOptions } from '../session-contract'
import { loadAudit } from '../stage-loading'
import type { AuditingSession, CalibrateOptions, CalibrationCase, CorpusCalibration } from './corpus-calibration.contract'

type OpenSession = (original: ScanmateDocument, scanned: ScanmateDocument, options: ScanmateOptions) => AuditingSession

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
  const { calibrateAudit, sampleAudit } = await loadAudit()
  const engine = new SharedEngine(session.engine, () => session.ocr?.tesseract)
  const samples: CalibrationSample[] = []

  try {
    let index = 0
    for await (const item of corpus) {
      index++
      const { engine: leased } = await engine.lease()
      const scan = open(item.original, item.scanned, {
        ...session,
        engine:   leased,
        expected: item.expected ?? session.expected,
        audit:    { ...session.audit, output: 'none' },
      })
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
