/** The audit as one PDF: the verdict, and each page's evidence image with what to look at in words. */

export type { EvidencePdfOptions } from './evidence-document.contract'
export type { EvidenceSummary, SummarisedPage } from './evidence-summary.contract'
export { combineSummaries, summariseAudit } from './evidence-summary.mapper'
export { writeEvidenceCover, writeEvidencePdf } from './write-evidence-pdf.use-case'
