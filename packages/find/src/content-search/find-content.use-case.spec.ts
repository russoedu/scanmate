import { createRaster, IDENTITY } from '@scanmate/ink'
import { compareTexts } from '@scanmate/ocr'
import type { PageOcr, ReadPage, RunReading } from '@scanmate/ocr'

import { findContent } from './find-content.use-case'

/** A run of the original and what the scan read there: [text, found, y]. */
type Run = [string, string, number]

/** An OCR report page, as `@scanmate/ocr` would build it from these runs, plus any words added. */
function page (number: number, runs: readonly Run[], added = ''): PageOcr {
  const readings: RunReading[] = runs.map(([text, found, y]) => ({ text, found, agrees: text === found, rechecked: false, x: 30, y, width: 200, height: 11 }))
  const expected = runs.map(([text]) => text).join(' ')
  const alignedText = [...runs.map(([, found]) => found), added].join(' ').trim()
  const side = { source: 'ocr' as const, text: alignedText, confidence: 90, lines: [], words: [] }

  return {
    page:        number,
    original:    { ...side, source: 'text-layer', text: expected, confidence: null },
    scanned:     side,
    runs:        readings,
    alignedText,
    score:       1,
    metrics:     compareTexts(expected, alignedText),
    differences: [],
    rechecks:    { attempted: 0, cleared: 0 },
    printChecks: { checked: 0, different: 0, skipped: { 'no-figure': 0, 'unplaceable': 0, 'few-rivals': 0, 'too-coarse': 0, 'undecided': 0 } },
    warnings:    [],
  }
}

/** The readings as pages, which is what the search takes: the picture is never looked at. */
function report (...readings: PageOcr[]): ReadPage[] {
  const raster = createRaster(4, 4)
  const image = { raster, image: null, dpi: 72, width: 4, height: 4 }

  return readings.map(text => ({
    page:     text.page,
    original: image,
    scanned:  image,
    aligned:  { ...image, matrix: IDENTITY, inverse: IDENTITY, confidence: 1 },
    text,
  }))
}

const TERMS = page(1, [
  ['Order# 10231', 'Order# 10231', 100],
  ['Initial Subscription Term', 'lnitial Subscription Terrn', 120],
  ['Total 1,250.00', 'Total 7,250.00', 140],
  ['Company Name The Resistance', 'Company Name The Resistance', 160],
], 'Approved by Leia')

describe('findContent', () => {
  it('finds content where the original prints it - present and identifiable - forgiving OCR’s slips in words', () => {
    const result = findContent(report(TERMS), [{ page: 1, content: ['Initial Subscription Term', 'Order# 10231'] }])
    const [term, order] = result.pages[0].find.content

    expect(result.allFound).toBe(true)
    expect(result.allIdentifiable).toBe(true)
    expect(term).toMatchObject({ found: true, identifiable: true, foundBy: 'in-place', printedInOriginal: true, excerpt: 'lnitial subscription terrn', box: { x: 30, y: 120, width: 200, height: 11 } })
    expect(term.score).toBeGreaterThan(0.85)
    expect(order).toMatchObject({ foundBy: 'in-place', score: 1, foundOnPages: [1] })
  })

  it('does not find a figure the scan changed, and says how close the page came', () => {
    const [total] = findContent(report(TERMS), [{ page: 1, content: ['Total 1,250.00'] }]).pages[0].find.content

    expect(total).toMatchObject({ found: false, identifiable: false, foundBy: 'none', printedInOriginal: true, excerpt: null })
    expect(total.box).toEqual({ x: 30, y: 140, width: 200, height: 11 })
  })

  it('holds content the original prints twice to both places: one altered copy is found, not identifiable', () => {
    const twice = page(1, [
      ['Belgium new 5,768,700.00', 'Belgium new 5,768,700.00', 100],
      ['Canada new 5,768,700.00', 'Canada new 5,568,700.00', 120],
    ])
    const [amount] = findContent(report(twice), [{ page: 1, content: ['5,768,700.00'] }]).pages[0].find.content

    expect(amount).toMatchObject({ found: true, identifiable: false, foundBy: 'in-place' })
    expect(amount.occurrences.map(o => [o.box.y, o.intact])).toEqual([[100, true], [120, false]])
  })

  it('finds part of a run, and content spanning runs', () => {
    const result = findContent(report(TERMS), [{ page: 1, content: ['The Resistance', 'Subscription Term Total'] }])

    expect(result.pages[0].find.content[0]).toMatchObject({ foundBy: 'in-place', excerpt: 'the resistance' })
    // "Initial Subscription Term" and "Total ..." are separate runs: the box covers both.
    expect(result.pages[0].find.content[1].box).toEqual({ x: 30, y: 120, width: 200, height: 31 })
  })

  it('finds on the page what the original never printed, and says so', () => {
    const [note] = findContent(report(TERMS), [{ page: 1, content: ['Approved by Leia'] }]).pages[0].find.content

    expect(note).toMatchObject({ found: true, identifiable: false, foundBy: 'on-page', printedInOriginal: false, box: null })
  })

  it('says which pages a clause is on, so a swapped page shows', () => {
    const first = page(1, [['Schedule A', 'Schedule B', 100]])
    const second = page(2, [['Schedule B', 'Schedule A', 100]])
    const [clause] = findContent(report(first, second), [{ page: 1, content: ['Schedule A'] }]).pages[0].find.content

    expect(clause).toMatchObject({ found: false, printedInOriginal: true, foundOnPages: [2] })
  })

  it('reports a page it was not given rather than guessing', () => {
    const result = findContent(report(TERMS), [{ page: 9, content: ['Anything'] }])

    // There is no page 9 to hang the result on, so it is said once, at the top,
    // rather than by inventing a page that was never handed over.
    expect(result.allFound).toBe(false)
    expect(result.warnings).toEqual(['content was expected on page 9, which is not among the pages given'])
    expect(result.pages[0].find.content).toEqual([])
  })

  it('refuses content that normalises to nothing', () => {
    expect(() => findContent(report(TERMS), [{ page: 1, content: [' | '] }])).toThrow(RangeError)
  })
})
