import { alignPages } from '@scanmate/align'
import { A4, createSyntheticPdf, extractPages, extractPair } from '@scanmate/extract'
import type { SyntheticPdfPage } from '@scanmate/extract'
import { cloneRaster, createSyntheticDocument, drawLabel, drawLine, drawSignature, drawTick, IDENTITY, labelSize, simulateScan } from '@scanmate/ink'
import type { Raster, ReadablePage, StageEvent, TextRun } from '@scanmate/ink'
import type { OcrEngine, OcrWord, RecognisedText } from '@scanmate/ocr'

import { auditPages } from './audit-pages.use-case'

const LABEL = { scale: 2, color: [20, 20, 20, 255] } as const
const FORM = createSyntheticDocument({ width: 600, height: 780, seed: 5 })
const SIGNATURE = FORM.regions.signature
const TICK = FORM.regions['tick-1']

/** The form's printed text, as its text layer would place it. At 72 dpi points and pixels coincide. */
const ITEMS: TextRun[] = [
  { text: 'Order Confirmation', x: 40, y: 30, width: labelSize('Order Confirmation', LABEL).width, height: 14 },
  { text: 'Total 1,250.00', x: 400, y: 30, width: labelSize('Total 1,250.00', LABEL).width, height: 14 },
]

/**
 * The form with its text actually printed on it, the total as given.
 *
 * The text has to be on the paper, not only in the text layer: a difference is
 * only a finding once the ink agrees, so a fixture that alters an amount has to
 * alter the ink that prints it.
 */
function printedForm (total: string): Raster {
  const raster = cloneRaster(FORM.raster)
  drawLabel(raster, ITEMS[0].text, { x: ITEMS[0].x, y: ITEMS[0].y + 2 }, LABEL)
  drawLabel(raster, `Total ${total}`, { x: ITEMS[1].x, y: ITEMS[1].y + 2 }, LABEL)

  return raster
}

function word (text: string, x: number, y: number, width: number): OcrWord {
  return { text, confidence: 92, x, y: y + 2, width, height: 10 }
}

/** An engine that reads the given words off any page. */
function reads (words: OcrWord[]): OcrEngine {
  return {
    name:      'stub',
    version:   '1',
    languages: ['eng'],
    async recognise (): Promise<RecognisedText> {
      return { text: words.map(w => w.text).join(' '), confidence: 90, lines: words.map(w => ({ text: w.text, words: [w] })) }
    },
    async terminate (): Promise<void> {},
  }
}

const AS_PRINTED = [word('Order', 41, 30, 45), word('Confirmation', 90, 30, 95), word('Total', 401, 30, 35), word('1,250.00', 440, 30, 48)]

function page (aligned: Raster): ReadablePage {
  const side = { raster: PRINTED, image: null, width: 600, height: 780, dpi: 72 }

  return {
    page:     1,
    original: side,
    scanned:  { ...side, raster: aligned },
    aligned:  { raster: aligned, image: null, dpi: null, width: 600, height: 780, matrix: IDENTITY, inverse: IDENTITY, confidence: 0.95 },
    metadata: { original: { textItems: ITEMS } },
  }
}

const PRINTED = printedForm('1,250.00')

/** The returned copy with the total overwritten, digit for digit, in place. */
function altered (): Raster {
  return printedForm('7,250.00')
}

function signed (base: Raster = PRINTED): Raster {
  const raster = cloneRaster(base)
  drawSignature(raster, SIGNATURE, 4)

  return raster
}

const EXPECTED = [{ page: 1, id: 'signature', ...SIGNATURE }]

/** A one-page order form, printed with the given total. */
function printed (total: string): SyntheticPdfPage {
  return {
    text: [
      { x: 72, y: 760, size: 20, content: 'ORDER CONFIRMATION' },
      { x: 72, y: 700, size: 14, content: 'Customer: The Resistance' },
      { x: 72, y: 670, size: 14, content: `Total ${total}` },
      { x: 72, y: 560, size: 14, content: 'Signature' },
    ],
  }
}

/** A fine pen tick - a third of a millimetre at 72 dpi - through a box. */
function fine (raster: Raster, box: { x: number, y: number }): void {
  drawLine(raster, box.x + 3, box.y + 7, box.x + 6, box.y + 10, 1, 20)
  drawLine(raster, box.x + 6, box.y + 10, box.x + 11, box.y + 3, 1, 20)
}

describe('auditPages', () => {
  it('passes a page signed where expected, reading as printed', async () => {
    const audit = await auditPages([page(signed())], { expected: EXPECTED, ocr: { engine: reads(AS_PRINTED), targetDpi: null, recheck: false }, output: 'none' })
    const [{ audit: result }] = audit.pages

    expect(audit.verdict).toBe('pass')
    expect(result).toMatchObject({ verdict: 'pass', reasons: [], findings: [] })
    expect(result.pixels.expected[0].identified).toBe(true)
    expect(result.text.score).toBe(1)
    expect(audit.summary).toMatchObject({ pages: 1, passed: 1, corroborated: 0 })
  })

  it('merges what each comparison saw: an altered amount from the text, a stray tick from both', async () => {
    const raster = signed(altered())
    drawTick(raster, TICK)
    // The amount reads differently; the tick reads as a word where the original has none.
    const read = [...AS_PRINTED.slice(0, 3), word('7,250.00', 440, 30, 48), word('X', TICK.x + TICK.width / 2 - 3, TICK.y + TICK.height / 2 - 7, 6)]
    const audit = await auditPages([page(raster)], { expected: EXPECTED, ocr: { engine: reads(read), targetDpi: null, recheck: false }, output: 'none' })
    const [{ audit: result }] = audit.pages

    expect(audit.verdict).toBe('review')
    expect(result.findings.map(f => [f.kind, f.corroborated])).toEqual([['unexpected-mark', true], ['text-changed', false]])
    expect(result.reasons).toContain('Printed "Total 1,250.00" reads "Total 7,250.00" - its figures differ')
    expect(audit.summary).toMatchObject({ passed: 0, corroborated: 1, findings: { 'unexpected-mark': 1, 'text-changed': 1 } })
  })

  it('reads checkboxes instead of calling a tick unexpected, or an unticked box empty', async () => {
    const raster = signed()
    // A fine pen - a third of a millimetre at 72 dpi - through the first box.
    drawLine(raster, TICK.x + 3, TICK.y + 7, TICK.x + 6, TICK.y + 10, 1, 20)
    drawLine(raster, TICK.x + 6, TICK.y + 10, TICK.x + 11, TICK.y + 3, 1, 20)
    const second = FORM.regions['tick-2']
    const checkboxes = [{ page: 1, id: 'consent', ...TICK, expect: 'ticked' as const }, { page: 1, id: 'newsletter', ...second }]
    const audit = await auditPages([page(raster)], { expected: EXPECTED, checkboxes, ocr: { engine: reads(AS_PRINTED), targetDpi: null, recheck: false }, output: 'none' })
    const [{ audit: result }] = audit.pages

    expect(result.findings).toStrictEqual([])
    expect(audit.verdict).toBe('pass')
    expect(result.checkboxes.map(box => [box.id, box.scanned.state, box.satisfied])).toStrictEqual([['consent', 'ticked', true], ['newsletter', 'empty', null]])

    // The same boxes, the consent now required to stay empty.
    const refused = await auditPages([page(raster)], {
      expected:   EXPECTED,
      checkboxes: [{ ...checkboxes[0], expect: 'empty' }, checkboxes[1]],
      ocr:        { engine: reads(AS_PRINTED), targetDpi: null, recheck: false },
      output:     'none',
    })

    expect(refused.verdict).toBe('review')
    expect(refused.pages[0].audit.findings).toMatchObject([{ kind: 'checkbox-mismatch', subject: 'consent', summary: '"consent" must be empty, and is ticked' }])
  })

  it('judges a group of boxes across the page: one of these, and only one', async () => {
    const second = FORM.regions['tick-2']
    const checkboxes = [{ page: 1, id: 'individual', ...TICK }, { page: 1, id: 'c-corporation', ...second }]
    const checkboxGroups = [{ id: 'classification', boxes: ['individual', 'c-corporation'], ticked: 'exactly-one' as const }]
    const run = async (raster: Raster) => await auditPages([page(raster)], {
      expected: EXPECTED, checkboxes, checkboxGroups, ocr: { engine: reads(AS_PRINTED), targetDpi: null, recheck: false }, output: 'none',
    })

    const one = signed()
    fine(one, TICK)
    const answered = await run(one)
    expect(answered.verdict).toBe('pass')
    expect(answered.groups).toMatchObject([{ id: 'classification', ticked: ['individual'], satisfied: true }])

    const both = signed()
    fine(both, TICK)
    fine(both, second)
    const doubled = await run(both)
    expect(doubled.verdict).toBe('review')
    expect(doubled.groups[0]).toMatchObject({ ticked: ['individual', 'c-corporation'], satisfied: false })
    expect(doubled.pages[0].audit.findings).toMatchObject([
      { kind: 'checkbox-group', subject: 'classification', summary: '"classification" must have exactly one box ticked, and 2 are: individual, c-corporation' },
    ])
    expect(doubled.summary.findings).toStrictEqual({ 'checkbox-group': 1 })
  })

  it('reports an expected region left empty, and the amount that was altered', async () => {
    const read = [...AS_PRINTED.slice(0, 3), word('7,250.00', 440, 30, 48)]
    const audit = await auditPages([page(altered())], {
      expected: EXPECTED,
      ocr:      { engine: reads(read), targetDpi: null, recheck: false },
      output:   'none',
    })
    const kinds = audit.pages[0].audit.findings.map(f => f.kind)

    expect(kinds).toEqual(['text-changed', 'expected-empty'])
    expect(audit.pages[0].audit.findings[0]).toMatchObject({ summary: 'Printed "Total 1,250.00" reads "Total 7,250.00" - its figures differ' })
    // The ink moved where the reading says it did, so nothing had to be settled by re-reading.
    expect(audit.pages[0].audit.settled.map(settlement => [settlement.verdict, settlement.because])).toEqual([['changed', 'ink']])
  })

  it('does not pass a page that reads too poorly to trust, even with nothing found', async () => {
    const audit = await auditPages([page(signed())], { expected: EXPECTED, ocr: { engine: reads(AS_PRINTED), targetDpi: null, recheck: false, scoreMetric: 'wordRecall' }, minTextScore: 1.01, output: 'none' })

    expect(audit.pages[0].audit.verdict).toBe('review')
    expect(audit.pages[0].audit.reasons[0]).toMatch(/too poorly to trust/)
  })

  it('draws the original, the scan and the overlay side by side with the findings, and encodes it', async () => {
    const raster = signed()
    drawTick(raster, TICK)
    const audit = await auditPages([page(raster)], { expected: EXPECTED, ocr: { engine: reads(AS_PRINTED), targetDpi: null, recheck: false } })
    const [{ audit: result }] = audit.pages

    // Three panels - the original, the scan, the overlay - and a legend along the foot.
    expect(result.evidenceRaster.width).toBeGreaterThan(600 * 3)
    expect(result.evidenceRaster.height).toBeGreaterThan(780)
    expect(result.evidenceImage).toBeInstanceOf(Uint8Array)
    expect(result.pixels.diffImage).toBeInstanceOf(Uint8Array)
  })

  it('audits a real reading end to end: the signature found, the altered amount and the stray mark reported', async () => {
    // The returned copy: the amount altered, signed, a mark in the margin, scanned crooked.
    const [returned] = await extractPages(await createSyntheticPdf([printed('7,250.00')]), { dpi: 150, output: 'none' })
    const paper = returned.image.raster
    const s = 150 / 72
    drawSignature(paper, { x: Math.round(160 * s), y: Math.round(262 * s), width: Math.round(200 * s), height: Math.round(40 * s) }, 3)
    drawTick(paper, { x: Math.round(470 * s), y: Math.round(420 * s), width: Math.round(20 * s), height: Math.round(20 * s) })
    const scan = simulateScan(paper, { rotationDeg: 1.1, scale: 1, noise: 0.01, blur: 0.5, illumination: 0.1, seed: 9 })
    const scanned = await createSyntheticPdf([{ images: [{ raster: scan.raster, x: 0, y: 0, width: A4.width, height: A4.height }] }])

    const { pages } = await extractPair({ original: await createSyntheticPdf([printed('1,250.00')]), scanned }, { output: 'none' })
    const audit = await auditPages(await alignPages(pages, { output: 'none' }), {
      expected: [{ page: 1, id: 'signature', x: 150, y: 255, width: 300, height: 55 }],
      output:   'none',
    })
    const [{ audit: result }] = audit.pages

    expect(result.pixels.expected[0].identified).toBe(true)
    expect(result.findings.map(f => f.kind).toSorted((a, b) => a.localeCompare(b))).toEqual(['text-changed', 'unexpected-mark'])
    expect(result.findings.find(f => f.kind === 'text-changed')?.text[0].expected).toBe('Total 1,250.00')
    expect(audit.verdict).toBe('review')
  }, 180_000)

  it('reports progress from every stage it runs', async () => {
    const events: StageEvent[] = []
    await auditPages([page(signed())], { expected: EXPECTED, ocr: { engine: reads(AS_PRINTED), targetDpi: null, recheck: false }, output: 'none', onProgress: e => { events.push(e) } })

    // The reading and the pixel comparison of a page are started together, so the
    // two 'start' events interleave; both finish before the audit of that page.
    expect(events.map(e => `${e.stage}:${e.phase}`).toSorted((a, b) => a.localeCompare(b))).toEqual(
      ['audit:done', 'audit:start', 'diff:done', 'diff:start', 'ocr:done', 'ocr:start'],
    )
    expect(events.at(0)).toMatchObject({ stage: 'ocr', phase: 'start' })
    expect(events.at(-1)).toMatchObject({ stage: 'audit', phase: 'done' })
  })
})
