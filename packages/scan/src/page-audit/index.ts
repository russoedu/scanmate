/** The final audit of a document: full reading and pixel comparison, merged into one verdict per page. */

export { auditPages, DEFAULT_MIN_TEXT_SCORE } from './audit-pages.use-case'
export type { AuditedPage, AuditOptions, AuditReport, PageAudit, Verdict } from './audit-report.contract'
