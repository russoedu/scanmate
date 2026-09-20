import { diffPages } from '@scanmate/diff'
import { findContent } from '@scanmate/find'
import type { ContentResult } from '@scanmate/find'
import { encodeImage } from '@scanmate/ink'
import { ocrPages } from '@scanmate/ocr'
import type { ReadablePage } from '@scanmate/ocr'

import { renderEvidence } from '../audit-evidence'
import { correlateFindings } from '../finding-correlation'
import type { FindingKind } from '../finding-correlation'
import type { AuditOptions, AuditReport, PageAudit } from './audit-report.contract'

/**
 * The final audit: every aligned page read in full and compared pixel by
 * pixel, the two answers merged, and a verdict with its evidence.
 *
 * The reading (`@scanmate/ocr`) catches what changes the words - a digit, a
 * name, a clause - and says where. The pixel comparison (`@scanmate/diff`)
 * catches what changes the ink - a signature, a stamp, a mark, a paragraph gone
 * - and checks each expected region was filled in. Neither sees what the other
 * does, so both run, and their findings are merged by place: a stray mark that
 * also reads as words is one finding, corroborated. Required content
 * (`@scanmate/find`) is checked on top when given.
 *
 * A page passes when there is nothing to look at: every expected region filled
 * in, nothing unexpected, the text as printed, the required content in place,
 * and a text score high enough to trust that silence. Everything else is for
 * review, with the reasons and the side-by-side page to check them against.
 */
export async function auditPages<Page extends ReadablePage> (pages: readonly Page[], options: AuditOptions = {}): Promise<AuditReport> {
  const { expected = [], content, minTextScore = 0.85, output = 'png', onProgress } = options

  const reading = await ocrPages(pages, { ...options.ocr, onProgress })

  // Every text difference is also a place to measure the ink at: identical ink
  // under a word settles that the print is identical, whatever was read there.
  const probes = pages.flatMap((page, position) => reading.pages[position].differences.map(difference => ({
    page:   page.page,
    x:      difference.x,
    y:      difference.y,
    width:  difference.width,
    height: difference.height,
  })))
  const pixels = await diffPages(pages, expected, { ...options.diff, units: 'points', output, sideBySide: false, probes, onProgress })
  const found = content === undefined ? null : findContent(reading, content, options.find)

  const audits: PageAudit[] = []
  for (const [position, page] of pages.entries()) {
    const started = Date.now()
    onProgress?.({ stage: 'audit', phase: 'start', page: page.page, index: position + 1, total: pages.length })

    const text = reading.pages[position]
    const diff = pixels[position]
    const required: ContentResult[] = found?.pages.filter(p => p.page === page.page).flatMap(p => p.content) ?? []
    const { findings, explained, noise } = correlateFindings({ text: text.differences, pixels: diff, content: required, probes: diff.probes })

    const reasons = findings.map(f => f.summary)
    if (text.score < minTextScore)
      reasons.push(`the text reads too poorly to trust (score ${text.score.toFixed(2)} below ${minTextScore}): changes may have gone unseen`)

    const evidenceRaster = renderEvidence(page.original.raster, page.aligned.raster, {
      dpi:            page.original.dpi ?? 150,
      expected:       diff.expected,
      findings,
      content:        required,
      overlay:        diff.diffRaster,
      expectedMargin: options.diff?.expectedMargin,
    })
    audits.push({
      page:          page.page,
      verdict:       reasons.length === 0 ? 'pass' : 'review',
      reasons,
      findings,
      explained,
      noise,
      text,
      pixels:        diff,
      content:       required,
      evidenceRaster,
      evidenceImage: output === 'none' ? null : await encodeImage(evidenceRaster, { format: output }),
    })

    onProgress?.({
      stage:      'audit',
      phase:      'done',
      page:       page.page,
      index:      position + 1,
      total:      pages.length,
      durationMs: Date.now() - started,
      detail:     { verdict: audits.at(-1)?.verdict, findings: findings.length },
    })
  }

  const counts: Partial<Record<FindingKind, number>> = {}
  const every = audits.flatMap(a => a.findings)
  for (const finding of every) counts[finding.kind] = (counts[finding.kind] ?? 0) + 1

  return {
    verdict:   audits.every(a => a.verdict === 'pass') ? 'pass' : 'review',
    textScore: reading.score,
    pages:     audits,
    summary:   {
      pages:        audits.length,
      passed:       audits.filter(a => a.verdict === 'pass').length,
      findings:     counts,
      corroborated: every.filter(f => f.corroborated).length,
    },
  }
}
