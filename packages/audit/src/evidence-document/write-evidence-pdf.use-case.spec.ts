import { PDFDocument } from '@cantoo/pdf-lib'
import { inspectDocument } from '@scanmate/extract'
import { createRaster } from '@scanmate/ink'
import type { Raster, ReadablePage } from '@scanmate/ink'

import type { AuditReport, PageAudit } from '../page-audit'
import { writeEvidencePdf } from './write-evidence-pdf.use-case'

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
      text:           { score: 0.97 },
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
    expect(document.getProducer()).toBe('@scanmate/audit')
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
})
