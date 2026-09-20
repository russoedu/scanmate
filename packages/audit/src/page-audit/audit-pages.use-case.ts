import { diffPage, probeInk } from '@scanmate/diff'
import { encodeImage } from '@scanmate/ink'
import { createTesseractEngine, DEFAULT_NORMALISE, ocrPages } from '@scanmate/ocr'
import type { OcrEngine, PageOcr } from '@scanmate/ocr'

import { renderEvidence } from '../audit-evidence'
import { settleDisputes } from '../dispute-settlement'
import { correlateFindings } from '../finding-correlation'
import type { FindingKind } from '../finding-correlation'
import type { AuditOptions, AuditReport, PageAudit } from './audit-report.contract'
import type { ReadablePage } from '@scanmate/ink'

/**
 * The final audit: every aligned page read in full and compared pixel by
 * pixel, the two answers merged, and a verdict with its evidence.
 *
 * The reading (`@scanmate/ocr`) catches what changes the words - a digit, a
 * name, a clause - and says where. The pixel comparison (`@scanmate/diff`)
 * catches what changes the ink - a signature, a stamp, a mark, a paragraph gone
 * - and checks each expected region was filled in. Neither sees what the other
 * does, so the two run **alongside each other** on every page: the engine reads
 * in its own worker while the masks are built here, which is wall-clock this
 * pipeline used to spend twice.
 *
 * They are not merely merged afterwards. Where both saw something at the same
 * place it becomes one finding, corroborated - but where they *disagree*, the
 * disagreement is settled rather than decided by precedence. The reading says a
 * run changed and the ink at that run says nothing moved: `settleDisputes` then
 * reads both crops the same way and compares the two readings to each other,
 * which cancels the systematic misreadings that make OCR disagree with a page
 * it is looking straight at. See `../dispute-settlement`.
 *
 * Required content is not part of this. `@scanmate/find` answers a different
 * question - whether the *original* says what it was supposed to say, which no
 * comparison of the two copies can - and a caller who wants it asks it directly,
 * of the reading this returns.
 *
 * A page passes when there is nothing to look at: every expected region filled
 * in, nothing unexpected, the text as printed or settled as a misreading, and a
 * text score high enough to trust that silence. Everything else is for review,
 * with the reasons and the evidence page to check them against.
 */
export async function auditPages<Page extends ReadablePage> (pages: readonly Page[], options: AuditOptions = {}): Promise<AuditReport> {
  const { expected = [], minTextScore = 0.85, output = 'png', onProgress } = options
  // One engine for the whole run: the page readings and every disputed re-read.
  const engine: OcrEngine = options.ocr?.engine ?? await createTesseractEngine(options.ocr?.tesseract)

  const audits: PageAudit[] = []
  const readings: PageOcr[] = []
  try {
    for (const [position, page] of pages.entries()) {
      // Both comparisons of the same page at once: tesseract works in its own
      // worker while the masks are built here, so the two cost about one.
      const [reading, diff] = await Promise.all([
        ocrPages([page], { ...options.ocr, engine, onProgress }),
        (async () => {
          const begun = Date.now()
          onProgress?.({ stage: 'diff', phase: 'start', page: page.page, index: position + 1, total: pages.length })
          const result = await diffPage(page, expected.filter(region => region.page === page.page), {
            ...options.diff, units: 'points', output, sideBySide: false, keepMasks: true,
          })
          onProgress?.({
            stage:      'diff',
            phase:      'done',
            page:       page.page,
            index:      position + 1,
            total:      pages.length,
            durationMs: Date.now() - begun,
            detail:     { unexpected: result.unexpected.length, missing: result.missing.length, identified: result.expected.filter(region => region.identified).length },
          })

          return result
        })(),
      ])
      const text = reading.pages[0]
      readings.push(text)

      const started = Date.now()
      onProgress?.({ stage: 'audit', phase: 'start', page: page.page, index: position + 1, total: pages.length })

      // Where the two disagree: ask the ink at that very run, and if the ink says
      // nothing moved, read both sides again and compare them with each other.
      const dpi = page.original.dpi ?? 150
      const probes = diff.masks === null ? [] : probeInk(diff.masks, text.differences, { dpi, units: 'points' })
      const settled = await settleDisputes({
        differences: text.differences,
        probes,
        original:    { raster: page.original.raster, dpi },
        scanned:     { raster: page.aligned.raster, dpi },
        engine,
        runs:        page.metadata?.original?.textItems ?? [],
        rules:       {
          normalise:         options.ocr?.normalise ?? DEFAULT_NORMALISE,
          matchThreshold:    options.ocr?.matchThreshold ?? 0.8,
          minWordConfidence: options.ocr?.minWordConfidence ?? 60,
        },
        ...options.settle,
      })
      // Four binary images the size of the page; nothing needs them now.
      diff.masks = null

      const { findings, explained, noise } = correlateFindings({ text: text.differences, pixels: diff, settled })

      const reasons = findings.map(f => f.summary)
      if (text.score < minTextScore)
        reasons.push(`the text reads too poorly to trust (score ${text.score.toFixed(2)} below ${minTextScore}): changes may have gone unseen`)

      const evidenceRaster = renderEvidence(page.original.raster, page.aligned.raster, {
        dpi,
        expected:       diff.expected,
        findings,
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
        settled,
        text,
        pixels:        diff,
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
  } finally {
    if (options.ocr?.engine === undefined) await engine.terminate()
  }

  const counts: Partial<Record<FindingKind, number>> = {}
  const every = audits.flatMap(a => a.findings)
  for (const finding of every) counts[finding.kind] = (counts[finding.kind] ?? 0) + 1

  return {
    verdict:   audits.every(a => a.verdict === 'pass') ? 'pass' : 'review',
    textScore: documentScore(readings),
    pages:     audits,
    summary:   {
      pages:        audits.length,
      passed:       audits.filter(a => a.verdict === 'pass').length,
      findings:     counts,
      corroborated: every.filter(f => f.corroborated).length,
    },
  }
}

/**
 * The document's reading score: the mean of the pages', weighted by how much
 * text each carries, so a three-word page does not outvote a dense one.
 */
function documentScore (pages: readonly PageOcr[]): number {
  if (pages.length === 0) return 1
  const characters = pages.reduce((sum, page) => sum + page.metrics.characters, 0)
  if (characters === 0) return pages.reduce((sum, page) => sum + page.score, 0) / pages.length

  return pages.reduce((sum, page) => sum + page.score * page.metrics.characters, 0) / characters
}
