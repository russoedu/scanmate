/**
 * `@scanmate/audit` - the final audit of a returned document: read in full,
 * compared pixel by pixel, one verdict.
 *
 * ```ts
 * import { extractPair } from '@scanmate/extract'
 * import { alignPages } from '@scanmate/align'
 * import { auditPages } from '@scanmate/audit'
 *
 * const { pages } = await extractPair({ original: 'fw9-issued.pdf', scanned: 'fw9-returned.pdf' })
 * const audit = await auditPages(await alignPages(pages), {
 *   expected: [{ page: 1, id: 'signature', x: 120, y: 577, width: 262, height: 22 }],
 * })
 * audit.verdict                    // 'pass' | 'review'
 * audit.pages[0].reasons           // why, one sentence each
 * audit.pages[0].findings          // text and pixel findings, merged by place
 * audit.pages[0].noise             // read differently, printed identically
 * audit.pages[0].evidenceImage     // original, scan and overlay, findings drawn
 * ```
 *
 * The reading (`@scanmate/ocr`) sees what changes the words; the pixel
 * comparison (`@scanmate/diff`) sees what changes the ink. A substituted digit
 * stays inside the pixel tolerance; a signature is not text. So both run, on
 * each page at the same time, and what both saw at one place is one finding,
 * corroborated.
 *
 * `writeEvidencePdf` puts the whole audit in one file for whoever reviews it:
 * the verdict, and every page's evidence image with what to look at in words.
 *
 * `calibrateAudit` measures the verdict itself: over a corpus someone has
 * labelled by hand, how often a set of thresholds would pass an altered
 * document, and how often it would hold up a genuine one.
 *
 * Where they disagree, the argument is settled rather than decided by
 * precedence: both crops are read again the same way and the two readings are
 * compared with each other, which cancels the misreadings that make OCR
 * disagree with a page nothing has happened to.
 */

export { auditPages, DEFAULT_MIN_TEXT_SCORE } from './page-audit'
export type { AuditedPage, AuditOptions, AuditReport, PageAudit, Verdict } from './page-audit'
export type { AuditFinding, ExplainedDifference, FindingKind } from './finding-correlation'
export { combineSummaries, summariseAudit, writeEvidenceCover, writeEvidencePdf } from './evidence-document'
export type { EvidencePdfOptions, EvidenceSummary, SummarisedPage } from './evidence-document'
export { calibrateAudit, DEFAULT_CALIBRATION_GRID, documentPasses, sampleAudit } from './audit-calibration'
export type { CalibrationGrid, CalibrationLabel, CalibrationPoint, CalibrationReport, CalibrationSample, CalibrationThresholds, SampledFinding, SampledPage } from './audit-calibration'

// --- Building blocks ---

export { correlateFindings } from './finding-correlation'
export type { Correlation, CorrelationInput } from './finding-correlation'
export { INK_EVIDENCE, QUORUM, SETTLEMENT_PASSES, settleDisputes } from './dispute-settlement'
export type { Settlement, SettlementInput } from './dispute-settlement'
export { renderEvidence, TEXT_DIFFERENCE } from './audit-evidence'
