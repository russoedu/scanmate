import type { AuditReport } from '../page-audit'
import type { EvidencePdfOptions, EvidenceSummary } from '../evidence-document'
import type { ReadablePage } from '@scanmate/ink'

import type { BatchOptions, BatchSession } from '../batch-running'

export interface BatchEvidenceOptions extends BatchOptions {
  /** How the PDF is written: `title`, `pages`, `format`, `dpi`, `quality`, `createdAt`. */
  evidence?: Omit<EvidencePdfOptions, 'cover'>
}

export interface BatchEvidence {
  /** One PDF for the whole document: one cover, then every page's sheets, in page order. */
  pdf:     Uint8Array
  /** What the cover says, as data: the verdict, the text score, and each page's reasons. */
  summary: EvidenceSummary
}

/** What writing batch evidence needs from a session. */
export interface AuditingBatchSession extends BatchSession {
  audit: () => Promise<AuditReport<ReadablePage>>
}
