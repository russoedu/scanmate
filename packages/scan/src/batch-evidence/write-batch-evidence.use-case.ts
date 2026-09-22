import type { ScanmateDocument } from '../document-input'
import { runInBatches } from '../batch-running'
import type { ScanmateOptions } from '../session-contract'
import { loadAudit, loadMerge } from '../stage-loading'
import type { AuditingBatchSession, BatchEvidence, BatchEvidenceOptions } from './batch-evidence.contract'

type OpenSession = (original: ScanmateDocument, scanned: ScanmateDocument, options: ScanmateOptions) => AuditingBatchSession

/**
 * A long document's evidence as one PDF, audited a few pages at a time.
 *
 * Each batch is audited and reduced to its summary and its sheets - bytes, not
 * pixels - before the next is opened. Then one cover is written for the whole
 * document, from the batches' summaries joined, and the cover and every batch's
 * sheets are put together into one PDF, pages copied rather than redrawn.
 */
export async function writeBatchEvidence (
  original: ScanmateDocument,
  scanned: ScanmateDocument,
  options: BatchEvidenceOptions,
  open: OpenSession,
): Promise<BatchEvidence> {
  const { evidence = {}, ...batch } = options
  const { combineSummaries, summariseAudit, writeEvidenceCover, writeEvidencePdf } = await loadAudit()

  const parts = await runInBatches(original, scanned, async (scan) => {
    const report = await scan.audit()
    const sheeted = evidence.pages === 'review' ? report.pages.some(page => page.audit.verdict === 'review') : report.pages.length > 0

    return { summary: summariseAudit(report), sheets: sheeted ? await writeEvidencePdf(report, { ...evidence, cover: false }) : null }
  }, {
    ...batch,
    // Nothing reads the evidence images as files: the sheets embed the rasters.
    audit: { ...batch.audit, output: 'none' },
  }, open)

  const summary = combineSummaries(parts.map(part => part.summary))
  const cover = await writeEvidenceCover(summary, evidence)
  const sheets = parts.flatMap(part => (part.sheets === null ? [] : [part.sheets]))
  if (sheets.length === 0) return { pdf: cover, summary }

  const { mergeDocuments } = await loadMerge()
  const merged = await mergeDocuments([cover, ...sheets], { metadata: { title: evidence.title ?? 'Audit evidence', subject: `Verdict: ${summary.verdict}` } })

  return { pdf: merged.pdf, summary }
}
