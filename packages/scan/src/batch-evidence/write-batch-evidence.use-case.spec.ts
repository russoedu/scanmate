import { PDFDocument } from '@cantoo/pdf-lib'
import type { AuditReport } from '@scanmate/audit'
import { createSyntheticPdf, inspectDocument } from '@scanmate/extract'
import { createRaster } from '@scanmate/ink'
import type { ReadablePage } from '@scanmate/ink'

import type { ScanmateOptions } from '../session-contract'
import { writeBatchEvidence } from './write-batch-evidence.use-case'

/** An audit of the given pages; page 4 has an altered amount. */
function audit (pages: readonly number[]): AuditReport<ReadablePage> {
  const evidenceRaster = createRaster(600, 260)
  evidenceRaster.data.fill(255)
  const audited = pages.map((page) => {
    const reasons = page === 4 ? ['Printed "Total 1,250.00" reads "Total 7,250.00" - its figures differ'] : []

    return {
      audit: {
        page,
        verdict:       reasons.length === 0 ? 'pass' : 'review',
        reasons,
        findings:      [],
        noise:         [],
        explained:     [],
        checkboxes:    [],
        settled:       [],
        text:          { score: 0.97, metrics: { characters: 100 } },
        pixels:        {},
        evidenceRaster,
        evidenceImage: null,
      },
    }
  })
  const review = audited.some(p => p.audit.verdict === 'review')

  return {
    verdict:   review ? 'review' : 'pass',
    textScore: 0.97,
    pages:     audited,
    summary:   { pages: audited.length, passed: audited.filter(p => p.audit.verdict === 'pass').length, findings: review ? { 'text-changed': 1 } : {}, corroborated: 0 },
  } as unknown as AuditReport<ReadablePage>
}

async function document (count: number): Promise<Uint8Array> {
  return await createSyntheticPdf(Array.from({ length: count }, (_, i) => ({ text: [{ x: 72, y: 700, content: `Page ${i + 1}` }] })))
}

/** A session that audits exactly the pages its batch was given. */
function sessions () {
  const given: ScanmateOptions[] = []
  const open = (_one: unknown, _two: unknown, options: ScanmateOptions) => {
    given.push(options)

    return { audit: async () => audit(options.extract?.pages as number[]), dispose: async () => {} }
  }

  return { given, open }
}

/** Every page's text, in order. */
async function texts (pdf: Uint8Array): Promise<string[]> {
  const { pages } = await inspectDocument(pdf, { metadata: true })

  return pages.map(page => (page.metadata?.textItems ?? []).map(item => item.text).join(' '))
}

describe('writeBatchEvidence', () => {
  it('writes one cover for the whole document, then every batch\'s sheets in page order', async () => {
    const pdf = await document(5)
    const { given, open } = sessions()
    const { pdf: evidence, summary } = await writeBatchEvidence(pdf, pdf, { batch: 2, evidence: { title: 'Agreement 2291' } }, open)
    const [cover, ...sheets] = await texts(evidence)

    expect(given.map(o => o.extract?.pages)).toStrictEqual([[1, 2], [3, 4], [5]])
    expect(given.every(o => o.audit?.output === 'none')).toBe(true)
    expect(summary.verdict).toBe('review')
    expect(summary.pages.map(p => p.page)).toStrictEqual([1, 2, 3, 4, 5])
    expect(cover).toContain('Verdict: REVIEW - 1 of 5 pages need a look')
    expect(sheets.map(sheet => /Page (\d) - /.exec(sheet)?.[1])).toStrictEqual(['1', '2', '3', '4', '5'])
    const written = await PDFDocument.load(evidence, { updateMetadata: false })
    expect(written.getTitle()).toBe('Agreement 2291')
  }, 120_000)

  it('gives only the pages needing review a sheet, and still lists every page on the cover', async () => {
    const pdf = await document(5)
    const { open } = sessions()
    const { pdf: evidence } = await writeBatchEvidence(pdf, pdf, { batch: 2, evidence: { pages: 'review' } }, open)
    const [cover, ...sheets] = await texts(evidence)

    expect(sheets).toHaveLength(1)
    expect(sheets[0]).toContain('Page 4 - REVIEW')
    expect(cover).toContain('Page 5')
  }, 120_000)

  it('is the cover alone when nothing needs a sheet', async () => {
    const pdf = await document(2)
    const { open } = sessions()
    const { pdf: evidence, summary } = await writeBatchEvidence(pdf, pdf, { batch: 1, evidence: { pages: 'review' } }, open)

    expect(summary.verdict).toBe('pass')
    expect(await texts(evidence)).toHaveLength(1)
  }, 120_000)
})
