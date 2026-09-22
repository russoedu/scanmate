import { PDFDocument } from '@cantoo/pdf-lib'
import { inspectDocument } from '@scanmate/extract'
import { createRaster } from '@scanmate/ink'
import type { Raster, ReadablePage } from '@scanmate/ink'

import type { AuditReport, PageAudit } from '../page-audit'
import type { SummarisedPage } from './evidence-summary.contract'
import { combineSummaries, summariseAudit } from './evidence-summary.mapper'
import { writeEvidenceCover, writeEvidencePdf } from './write-evidence-pdf.use-case'

function evidence (): Raster {
  const raster = createRaster(1200, 520)
  raster.data.fill(255)

  return raster
}

function audited (page: number, reasons: string[], extra: Partial<PageAudit> = {}): { audit: PageAudit } {
  return {
    audit: {
      page,
      verdict:        reasons.length === 0 ? 'pass' : 'review',
      reasons,
      findings:       [],
      noise:          [],
      explained:      [],
      checkboxes:     [],
      settled:        [],
      text:           { score: 0.97, metrics: { characters: 100 } },
      pixels:         {},
      evidenceRaster: evidence(),
      evidenceImage:  null,
      ...extra,
    } as unknown as PageAudit,
  }
}

function report (pages: Array<{ audit: PageAudit }>): AuditReport<ReadablePage> {
  const review = pages.some(p => p.audit.verdict === 'review')

  return {
    verdict:   review ? 'review' : 'pass',
    textScore: 0.97,
    pages,
    summary:   { pages: pages.length, passed: pages.filter(p => p.audit.verdict === 'pass').length, findings: review ? { 'text-changed': 1 } : {}, corroborated: 0 },
  } as unknown as AuditReport<ReadablePage>
}

/** Every word the PDF's text layer holds, page by page. */
async function words (pdf: Uint8Array): Promise<string[]> {
  const { pages } = await inspectDocument(pdf, { metadata: true })

  return pages.map(page => (page.metadata?.textItems ?? []).map(item => item.text).join(' '))
}

describe('writeEvidencePdf', () => {
  const REASON = 'Printed "Total 1,250.00" reads "Total 7,250.00" - its figures differ'

  it('writes a cover and a sheet per page, the findings as text that can be searched', async () => {
    const pdf = await writeEvidencePdf(report([audited(1, []), audited(2, [REASON])]), { title: 'Order 118', createdAt: new Date('2026-09-21T10:00:00Z') })
    const [cover, first, second] = await words(pdf)
    // Loaded without updating its metadata, or pdf-lib stamps its own name over the producer.
    const document = await PDFDocument.load(pdf, { updateMetadata: false })

    expect(document.getPageCount()).toBe(3)
    expect(document.getTitle()).toBe('Order 118')
    expect(document.getProducer()).toBe('@scanmate/scan')
    expect(cover).toContain('Verdict: REVIEW - 1 of 2 pages need a look')
    expect(cover).toContain('Findings: 1 text changed.')
    expect(cover).toContain('2026-09-21 10:00 UTC')
    expect(first).toContain('Nothing to look at on this page.')
    expect(second).toContain(REASON)
  }, 60_000)

  it('can leave out the pages that passed', async () => {
    const pdf = await writeEvidencePdf(report([audited(1, []), audited(2, [REASON]), audited(3, [])]), { pages: 'review' })

    const document = await PDFDocument.load(pdf)

    expect(document.getPageCount()).toBe(2)
  }, 60_000)

  it('runs a long list of findings on to another sheet rather than off the page', async () => {
    const many = Array.from({ length: 40 }, (_, i) => `Ink added where nothing was expected (${i + 1}.0 mm2)`)
    const pdf = await writeEvidencePdf(report([audited(1, many)]))
    const sheets = await words(pdf)

    expect(sheets.length).toBeGreaterThan(2)
    expect(sheets.at(-1)).toContain('Page 1 (continued)')
    expect(sheets.join(' ')).toContain('(40.0 mm2)')
  }, 60_000)

  it('says what each checkbox shows, and survives characters the standard font cannot draw', async () => {
    const box = { id: 'consent', page: 1, box: { x: 0, y: 0, width: 10, height: 10 }, original: { state: 'empty' }, scanned: { state: 'ticked' }, changed: true, expect: 'ticked', satisfied: true }
    const pdf = await writeEvidencePdf(report([audited(1, ['Printed “Иван” reads “Ivan”'], { checkboxes: [box] } as unknown as Partial<PageAudit>)]))
    const [, sheet] = await words(pdf)

    expect(sheet).toContain('consent: ticked, empty on the original, must be ticked')
    expect(sheet).toContain('Printed "????" reads "Ivan"')
  }, 60_000)

  it('writes the sheets alone, to follow a cover written for the whole document', async () => {
    const pdf = await writeEvidencePdf(report([audited(3, []), audited(4, [REASON])]), { cover: false })
    const sheets = await words(pdf)

    expect(sheets).toHaveLength(2)
    expect(sheets[0]).toContain('Page 3 - pass')
    expect(sheets.join(' ')).not.toContain('Verdict:')
  }, 60_000)

  it('writes one cover for batches audited apart', async () => {
    const first = summariseAudit(report([audited(1, []), audited(2, [])]))
    const second = summariseAudit(report([audited(3, [REASON])]))
    const pdf = await writeEvidenceCover(combineSummaries([second, first]), { title: 'A long agreement' })
    const [cover, ...rest] = await words(pdf)

    expect(rest).toHaveLength(0)
    expect(cover).toContain('Verdict: REVIEW - 1 of 3 pages need a look')
    expect(cover.indexOf('Page 1')).toBeLessThan(cover.indexOf('Page 3'))
  }, 60_000)
})

/** One page as a summary lists it. */
function page (number: number, verdict: 'pass' | 'review', textScore: number, characters: number): SummarisedPage {
  return { page: number, verdict, reasons: verdict === 'pass' ? [] : ['x'], textScore, characters }
}

describe('combineSummaries', () => {
  it('passes only when every page does, counts every finding, and weights the score by text', () => {
    const combined = combineSummaries([
      { verdict: 'review', textScore: 0.5, findings: { 'text-changed': 1 }, corroborated: 1, pages: [page(3, 'review', 0.5, 100)] },
      { verdict: 'pass', textScore: 1, findings: { 'text-changed': 2, 'missing-ink': 1 }, corroborated: 0, pages: [page(1, 'pass', 1, 300), page(2, 'pass', 1, 0)] },
    ])

    expect(combined.verdict).toBe('review')
    expect(combined.pages.map(p => p.page)).toStrictEqual([1, 2, 3])
    expect(combined.findings).toStrictEqual({ 'text-changed': 3, 'missing-ink': 1 })
    expect(combined.corroborated).toBe(1)
    // (1 x 300 + 1 x 0 + 0.5 x 100) / 400: a page with no text does not vote.
    expect(combined.textScore).toBeCloseTo(0.875, 9)
  })
})
