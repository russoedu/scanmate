import { createRaster, fillRect, IDENTITY } from '@scanmate/ink'
import type { Raster, ReadablePage, StageEvent, TextRun } from '@scanmate/ink'

import type { OcrEngine, OcrWord, RecognisedText } from '../ocr-engine'
import { matchWords } from './match-words.use-case'
import { ocrPages } from './ocr-pages.use-case'

/** A two-column page, as the original's text layer places it (points). */
const ITEMS: TextRun[] = [
  { text: 'Customer Details', x: 20, y: 100, width: 90, height: 11 },
  { text: 'Order#', x: 300, y: 100, width: 40, height: 11 },
  { text: 'The Resistance', x: 20, y: 120, width: 80, height: 11 },
  { text: 'Total 1,250.00', x: 300, y: 120, width: 70, height: 11 },
  { text: 'Planet D\'Qar', x: 20, y: 140, width: 70, height: 11 },
]

/** A word read at a place given in points, at 72 dpi, so points and pixels coincide. */
function word (text: string, x: number, y: number, width = 30, confidence = 90): OcrWord {
  return { text, confidence, x, y: y + 1, width, height: 9 }
}

/** An engine that "reads" what it is told, and records how it was used. */
function stub (lines: OcrWord[][]): OcrEngine & { calls: number, terminated: boolean } {
  const engine = {
    name:       'stub',
    version:    '1',
    languages:  ['eng'],
    calls:      0,
    terminated: false,
    async recognise (): Promise<RecognisedText> {
      engine.calls++

      return { text: lines.map(l => l.map(w => w.text).join(' ')).join('\n'), confidence: 88, lines: lines.map(words => ({ text: words.map(w => w.text).join(' '), words })) }
    },
    async terminate (): Promise<void> {
      engine.terminated = true
    },
  }

  return engine
}

/** An engine that reads nothing on the whole page, and `answer(n)` on the n-th crop it is given. */
function rereading (answer: (pass: number) => string): OcrEngine {
  let pass = 0
  const engine = stub([])
  const whole = engine.recognise.bind(engine)
  engine.recognise = async (image, hints) => {
    if (hints?.layout === undefined || hints.layout === 'page') return whole(image, hints)
    const text = answer(pass++)

    return { text, confidence: 90, lines: [{ text, words: [] }] }
  }

  return engine
}

function page (number = 1, items: TextRun[] = ITEMS): ReadablePage {
  const raster: Raster = createRaster(600, 800)
  const side = { raster, image: null, width: 600, height: 800, dpi: 72 }

  return {
    page:     number,
    original: side,
    scanned:  side,
    aligned:  { raster, image: null, dpi: null, width: 600, height: 800, matrix: IDENTITY, inverse: IDENTITY, confidence: 0.95 },
    metadata: { original: { textItems: items } },
  }
}

// Read column by column - the right column first - with the amount altered,
// "Planet D'Qar" not read at all, and a note written in the margin.
const READ = [
  [word('Order#', 301, 100, 38), word('Total', 301, 120, 25), word('7,250.00', 330, 120, 40)],
  [word('Customer', 21, 100, 48), word('Details', 72, 100, 38), word('The', 21, 120, 18), word('Resistance', 42, 120, 58)],
  [word('Approved', 450, 300, 50), word('by', 505, 300, 12)],
]

describe('matchWords', () => {
  it('puts every word back on the run printed where it was read, whatever order it was read in', () => {
    const words = READ.flat()
    const lineOf = READ.flatMap((line, l) => line.map(() => l))
    const match = matchWords(ITEMS, words, lineOf, { normalise: {}, matchThreshold: 0.8, minWordConfidence: 60 })

    expect(match.alignedText.split(/\s+/).slice(0, 7)).toEqual(['Customer', 'Details', 'Order#', 'The', 'Resistance', 'Total', '7,250.00'])
    expect(match.differences.map(d => [d.kind, d.expected, d.found])).toEqual([
      ['changed', 'Total 1,250.00', 'Total 7,250.00'],
      ['missing', 'Planet D\'Qar', null],
      ['added', null, 'Approved by'],
    ])
    // Each difference says where it is, in points.
    expect(match.differences[2]).toMatchObject({ x: 450, width: 67 })
  })

  it('takes a figure read with its separators swapped as the same figure, and nothing else', () => {
    const figure = [{ text: '5,768,700.00', x: 500, y: 200, width: 55, height: 11 }]
    const rules = { normalise: {}, matchThreshold: 0.8, minWordConfidence: 60 }
    const read = (text: string) => matchWords(figure, [word(text, 501, 200, 53)], [0], rules).differences

    expect(read('5.768.700 00')).toEqual([])
    expect(read('5,768,760.00')).toMatchObject([{ kind: 'changed', reason: 'numbers' }])
  })

  it('does not take specks of toner for added words', () => {
    const speck = { ...word('4,', 434, 578, 6), height: 3 }
    const match = matchWords(ITEMS, [speck], [0], { normalise: {}, matchThreshold: 0.8, minWordConfidence: 60 })

    expect(match.differences.filter(d => d.kind === 'added')).toEqual([])
  })

  it('leaves low-confidence stray words out of what was added', () => {
    const match = matchWords(ITEMS, [word('~~~', 450, 300), word('smudge', 450, 330, 30, 20)], [0, 1], { normalise: {}, matchThreshold: 0.8, minWordConfidence: 60 })

    expect(match.differences.filter(d => d.kind === 'added')).toEqual([])
  })
})

describe('ocrPages', () => {
  it('compares the scan with the original’s text layer, run by run, and scores the page', async () => {
    const engine = stub(READ)
    const report = await ocrPages([page()], { engine, targetDpi: null, recheck: false })
    const [{ text: result }] = report.pages

    // Only the scan was read: the original's text came from its text layer.
    expect(engine.calls).toBe(1)
    expect(result.original).toMatchObject({ source: 'text-layer', confidence: null })
    expect(result.original.text).toContain('Customer Details')
    expect(result.scanned).toMatchObject({ source: 'ocr', confidence: 88 })
    expect(result.differences.map(d => d.kind)).toEqual(['changed', 'missing', 'added'])
    expect(result.score).toBe(result.metrics.levenshteinSimilarity)
    expect(result.score).toBeGreaterThan(0.5)
    expect(result.score).toBeLessThan(0.9)
    expect(report.engine).toEqual({ name: 'stub', version: '1', languages: ['eng'] })
    // Every run of the original, with what was read in its place.
    expect(result.runs.map(r => [r.text, r.found, r.agrees])).toEqual([
      ['Customer Details', 'Customer Details', true],
      ['Order#', 'Order#', true],
      ['The Resistance', 'The Resistance', true],
      ['Total 1,250.00', 'Total 7,250.00', false],
      ["Planet D'Qar", '', false],
    ])
  })

  it('re-reads a doubted run on its own, and clears it only when two passes agree with the original', async () => {
    // The page reading finds nothing; read on its own, a line at a time, the run reads correctly.
    const always = await ocrPages([page(1, [ITEMS[4]])], { engine: rereading(() => "Planet D'Qar"), targetDpi: null })
    const once = await ocrPages([page(1, [ITEMS[4]])], { engine: rereading(n => (n === 0 ? "Planet D'Qar" : 'Pianet OQar')), targetDpi: null })

    expect(always.pages[0].text.differences).toEqual([])
    expect(always.pages[0].text.rechecks).toEqual({ attempted: 1, cleared: 1 })
    expect(always.pages[0].text.score).toBe(1)
    // One agreeing reading among six is not enough: that is how a forgery gets through.
    expect(once.pages[0].text.differences.map(d => d.kind)).toEqual(['missing'])
    expect(once.pages[0].text.rechecks).toEqual({ attempted: 1, cleared: 0 })
  })

  it('never clears a figure that keeps reading as a different figure', async () => {
    const engine = stub([[word('Total', 301, 120, 25), word('7,250.00', 330, 120, 40)]])
    const report = await ocrPages([page(1, [ITEMS[3]])], { engine, targetDpi: null })

    expect(report.pages[0].text.differences).toMatchObject([{ kind: 'changed', reason: 'numbers', expected: 'Total 1,250.00' }])
    expect(report.pages[0].text.rechecks.cleared).toBe(0)
  })

  it('reads light text on a bar the scan left pale as the original prints it: light on dark', async () => {
    // White figures on a dark bar in the original; the scan washed the bar out to pale grey.
    const run = { text: '1,250.00', x: 300, y: 120, width: 60, height: 11 }
    const original = createRaster(600, 800)
    fillRect(original, { x: 296, y: 116, width: 70, height: 20 }, 90)
    fillRect(original, { x: 302, y: 122, width: 50, height: 6 }, 255)
    const scan = createRaster(600, 800)
    fillRect(scan, { x: 296, y: 116, width: 70, height: 20 }, 205)
    fillRect(scan, { x: 302, y: 122, width: 50, height: 6 }, 242)
    const readable = page(1, [run])
    readable.original = { ...readable.original, raster: original }
    readable.aligned = { ...readable.aligned, raster: scan }

    // The engine reads a crop only when it is dark text on white paper.
    const engine = rereading(() => '')
    engine.recognise = async (image, hints) => {
      if (hints?.layout === undefined || hints.layout === 'page') return { text: '', confidence: 0, lines: [] }
      const crop = image as Raster
      const values = Array.from({ length: crop.width * crop.height }, (_, p) => crop.data[p * 4])
      const text = Math.min(...values) < 40 && values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] > 215 ? '1,250.00' : ''

      return { text, confidence: 90, lines: [{ text, words: [] }] }
    }
    const report = await ocrPages([readable], { engine, targetDpi: null })

    expect(report.pages[0].text.differences).toEqual([])
    expect(report.pages[0].text.rechecks).toEqual({ attempted: 1, cleared: 1 })
  })

  it('does not call words added where the original printed something that is not text, like a logo', async () => {
    // The margin note of READ lands on a block the original printed as an image.
    const withLogo = page()
    const printed = createRaster(600, 800)
    fillRect(printed, { x: 450, y: 298, width: 70, height: 14 }, 20)
    withLogo.original = { ...withLogo.original, raster: printed }
    const report = await ocrPages([withLogo], { engine: stub(READ), targetDpi: null, recheck: false })

    expect(report.pages[0].text.differences.map(d => d.kind)).toEqual(['changed', 'missing'])
  })

  it('leaves an engine it was given running, for the next call', async () => {
    const engine = stub(READ)
    await ocrPages([page()], { engine, targetDpi: null })

    expect(engine.terminated).toBe(false)
  })

  it('reads the original too when it has no text layer', async () => {
    const engine = stub(READ)
    const report = await ocrPages([page(1, [])], { engine, targetDpi: null })
    const [{ text: result }] = report.pages

    expect(engine.calls).toBe(2)
    expect(result.original.source).toBe('ocr')
    // Read the same both times: nothing differs.
    expect(result.differences).toEqual([])
    expect(result.score).toBe(1)
  })

  it('weights the document score by how much text each page has', async () => {
    const dense = page(1)
    const sparse = page(2, [{ text: 'Order#', x: 301, y: 100, width: 38, height: 11 }])
    const report = await ocrPages([dense, sparse], { engine: stub([[word('Order#', 301, 100, 38)]]), targetDpi: null })
    const [{ text: first }, { text: second }] = report.pages

    expect(second.score).toBe(1)
    expect(report.pageMean).toBeCloseTo((first.score + 1) / 2, 10)
    // The dense page dominates: the weighted score sits far closer to its score than the mean does.
    expect(Math.abs(report.score - first.score)).toBeLessThan(Math.abs(report.pageMean - first.score))
  })

  it('scores by the metric asked for, and reports progress per page', async () => {
    const events: StageEvent[] = []
    const report = await ocrPages([page()], { engine: stub(READ), targetDpi: null, scoreMetric: 'wordRecall', onProgress: e => { events.push(e) } })

    expect(report.pages[0].text.score).toBe(report.pages[0].text.metrics.wordRecall)
    expect(events.map(e => `${e.stage}:${e.phase}:${e.page}`)).toEqual(['ocr:start:1', 'ocr:done:1'])
    expect(events[1].detail).toMatchObject({ original: 'text-layer', differences: 3, rechecked: 2, cleared: 0 })
  })

  it('warns when nothing could be read, or when a text layer was insisted on and missing', async () => {
    const blankReport = await ocrPages([page()], { engine: stub([]), targetDpi: null })
    const noLayerReport = await ocrPages([page(1, [])], { engine: stub(READ), targetDpi: null, original: 'text-layer' })
    const [{ text: blank }] = blankReport.pages
    const [{ text: noLayer }] = noLayerReport.pages

    expect(blank.warnings).toContain('nothing could be read on the scanned page')
    expect(blank.differences.every(d => d.kind === 'missing')).toBe(true)
    expect(noLayer.warnings[0]).toMatch(/no text layer/)
  })
})
