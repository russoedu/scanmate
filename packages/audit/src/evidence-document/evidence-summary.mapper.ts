import type { ReadablePage } from '@scanmate/ink'

import type { FindingKind } from '../finding-correlation'
import type { AuditReport } from '../page-audit'
import type { EvidenceSummary, SummarisedPage } from './evidence-summary.contract'

/** An audit, reduced to what its evidence cover says. */
export function summariseAudit (report: AuditReport<ReadablePage>): EvidenceSummary {
  return {
    verdict:      report.verdict,
    textScore:    report.textScore,
    findings:     { ...report.summary.findings },
    corroborated: report.summary.corroborated,
    pages:        report.pages.map(({ audit }) => ({
      page:       audit.page,
      verdict:    audit.verdict,
      reasons:    [...audit.reasons],
      textScore:  audit.text.score,
      characters: audit.text.metrics.characters,
    })),
  }
}

/**
 * Several summaries - the batches of one long document - as one.
 *
 * The verdict passes only if every page does, pages come in page order,
 * findings are counted across all of them, and the text score is weighted by
 * each page's characters - the same rule the audit uses for one report.
 */
export function combineSummaries (summaries: readonly EvidenceSummary[]): EvidenceSummary {
  const pages = summaries.flatMap(summary => summary.pages).toSorted((a, b) => a.page - b.page)
  const findings: Partial<Record<FindingKind, number>> = {}
  for (const summary of summaries)
    for (const [kind, count] of Object.entries(summary.findings) as Array<[FindingKind, number]>) findings[kind] = (findings[kind] ?? 0) + count

  return {
    verdict:      pages.every(page => page.verdict === 'pass') ? 'pass' : 'review',
    textScore:    weightedScore(pages),
    findings,
    corroborated: summaries.reduce((sum, summary) => sum + summary.corroborated, 0),
    pages,
  }
}

function weightedScore (pages: readonly SummarisedPage[]): number {
  if (pages.length === 0) return 1
  const characters = pages.reduce((sum, page) => sum + page.characters, 0)
  if (characters === 0) return pages.reduce((sum, page) => sum + page.textScore, 0) / pages.length

  return pages.reduce((sum, page) => sum + page.textScore * page.characters, 0) / characters
}
