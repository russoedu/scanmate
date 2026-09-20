import { alignPages } from '@scanmate/align'
import { createSyntheticPdf, extractPages, extractPair } from '@scanmate/extract'
import { createGray, simulateScan, toGrayscale } from '@scanmate/ink'
import type { GrayImage } from '@scanmate/ink'

import { glyphCells } from './glyph-cells.use-case'
import { collectTemplates } from './glyph-templates.use-case'
import { printPolarity } from './print-polarity.policy'
import { verifyPrintedRun } from './verify-print.use-case'
import type { PrintVerification } from './verify-print.use-case'

/** A page printed at 72 dpi, where one point is one pixel. */
function page (draw: (set: (x: number, y: number, value: number) => void) => void): GrayImage {
  const image = createGray(200, 40)
  image.data.fill(1)
  draw((x, y, value) => {
    image.data[y * image.width + x] = value
  })

  return image
}

/** Three bars, each `width` wide, `gap` apart, starting at `x`. */
function bars (x: number, width: number, gap: number, value = 0) {
  return (set: (x: number, y: number, value: number) => void) => {
    for (let bar = 0; bar < 3; bar++) {
      const left = x + bar * (width + gap)
      for (let column = left; column < left + width; column++)
        for (let row = 10; row < 30; row++) set(column, row, value)
    }
  }
}

describe('glyphCells', () => {
  it('finds one box per character, by the paper between them', () => {
    const cells = glyphCells(page(bars(20, 6, 4)), 72, { x: 15, y: 5, width: 60, height: 30 }, 3)

    expect(cells?.map(cell => [Math.round(cell.x), Math.round(cell.width)])).toEqual([[20, 6], [30, 6], [40, 6]])
  })

  it('says nothing rather than guess when the glyphs touch', () => {
    const touching = page(bars(20, 6, 0))

    expect(glyphCells(touching, 72, { x: 15, y: 5, width: 60, height: 30 }, 3)).toBeNull()
  })

  it('reads a run printed light on a dark bar, once told which way round it is', () => {
    const bar = page((set) => {
      for (let x = 10; x < 90; x++) for (let y = 5; y < 35; y++) set(x, y, 0.35)
      bars(20, 6, 4, 1)(set)
    })
    const box = { x: 15, y: 5, width: 60, height: 30 }

    expect(printPolarity(bar, 72, box)).toBe('light-on-dark')
    expect(glyphCells(bar, 72, box, 3, { lightOnDark: true })).toHaveLength(3)
  })
})

describe('verifyPrintedRun', () => {
  const FIGURE = '4412-9087-3355'
  let original: Buffer
  let pages: Awaited<ReturnType<typeof extractPages>>

  beforeAll(async () => {
    // A page that prints the figure, and every digit elsewhere for the rivals to come from.
    original = Buffer.from(await createSyntheticPdf([{
      text: [
        { x: 60, y: 700, size: 12, content: `Account ${FIGURE}` },
        { x: 60, y: 670, size: 12, content: '0 1 2 3 4 5 6 7 8 9' },
        { x: 60, y: 640, size: 12, content: '90 81 72 63 54' },
      ],
    }]))
    pages = await extractPages(original, { dpi: 200, output: 'none' })
  }, 120_000)

  /** The page as a scan of itself: printed, softened, and put back on the original's canvas. */
  async function scanned (forge?: { at: number, from: number }) {
    const paper = pages[0].image.raster
    const item = pages[0].metadata.textItems.find(text => text.text.includes(FIGURE))!
    const gray = toGrayscale(paper)
    const characters = [...item.text].filter(character => character.trim() !== '')
    const cells = glyphCells(gray, 200, item, characters.length)!
    const copy = { ...paper, data: new Uint8ClampedArray(paper.data) }

    if (forge) {
      // One printed digit replaced by another of the same run: the same ink, a few points along.
      const s = 200 / 72
      const to = cells[forge.at]
      const from = cells[forge.from]
      const shift = Math.round((from.x - to.x) * s)
      const top = Math.round(item.y * s)
      const bottom = Math.round((item.y + item.height) * s)
      for (let y = top; y < bottom; y++)
        for (let x = Math.round(to.x * s) - 1; x < Math.round((to.x + Math.max(to.width, from.width)) * s) + 1; x++) {
          const source = (y * paper.width + x + shift) * 4
          const target = (y * paper.width + x) * 4
          for (let channel = 0; channel < 4; channel++) copy.data[target + channel] = paper.data[source + channel]
        }
    }

    const scan = simulateScan(copy, { rotationDeg: 0.8, scale: 0.98, noise: 0.01, blur: 0.5, illumination: 0.1, seed: 3 })
    const pdf = Buffer.from(await createSyntheticPdf([{ images: [{ raster: scan.raster, x: 0, y: 0, width: 595.28, height: 841.89 }] }]))
    const paired = await extractPair({ original, scanned: pdf }, { output: 'none' })
    const [aligned] = await alignPages(paired.pages, { output: 'none' })

    return aligned
  }

  /** What the ink says the figure is, on one aligned page. */
  function verify (aligned: Awaited<ReturnType<typeof scanned>>) {
    const originalGray = toGrayscale(aligned.original.raster)
    const scanGray = toGrayscale(aligned.aligned.raster)
    const items = aligned.metadata.original.textItems
    // The fixture is rendered at a known resolution, so this cannot happen -
    // but narrowing it here beats asserting, which the two tools disagree about.
    const { dpi } = aligned.original
    if (dpi === null) throw new Error('the fixture was extracted without a resolution')
    const templates = collectTemplates(originalGray, dpi, items)
    const run = items.find(item => item.text.includes(FIGURE))!

    return verifyPrintedRun(originalGray, scanGray, dpi, run, templates, {})
  }

  /** The verdict, insisting the run was looked at - and saying why when it was not. */
  function checked (result: ReturnType<typeof verify>): PrintVerification {
    if (!result.verified) throw new Error(`the run was not checked: ${result.because}`)

    return result
  }

  it('confirms a figure the scan did not change, digit by digit', async () => {
    const result = checked(verify(await scanned()))

    expect(result).toMatchObject({ agrees: true, reading: `Account ${FIGURE}` })
    // Most digits are settled; the rest are left undecided rather than guessed at.
    expect(result.checked).toBeGreaterThanOrEqual(4)
    expect(result.cells.filter(cell => cell.read !== null && cell.read !== cell.printed)).toEqual([])
  }, 180_000)

  it('reads a digit replaced by another of the same run as the digit it now is', async () => {
    // "4412-9087-3355" becomes "4412-9987-3355": the 9 written over the 0. The
    // cells count every printed character of the run, "Account" included.
    const result = checked(verify(await scanned({ at: 13, from: 12 })))

    expect(result).toMatchObject({ agrees: false, reading: 'Account 4412-9987-3355' })
    expect(result.confidence).toBeGreaterThan(0.12)
  }, 180_000)

  it('settles a named claim against the print, on two templates rather than eight', async () => {
    const aligned = await scanned()
    const originalGray = toGrayscale(aligned.original.raster)
    const scanGray = toGrayscale(aligned.aligned.raster)
    const { dpi } = aligned.original
    if (dpi === null) throw new Error('the fixture was extracted without a resolution')
    const items = aligned.metadata.original.textItems
    const templates = collectTemplates(originalGray, dpi, items)
    const run = items.find(item => item.text.includes(FIGURE))
    if (run === undefined) throw new Error('the fixture does not print the figure')
    const confirm = (claimed: string): ReturnType<typeof verifyPrintedRun> =>
      verifyPrintedRun(originalGray, scanGray, dpi, run, templates, { scope: 'confirm', claimed })

    // The scan was not altered, so a claim that it was must not be endorsed.
    const lie = checked(confirm(`Account ${FIGURE.replace('9087', '9387')}`))
    expect(lie.agrees).toBe(true)

    // And a claim that lines up with nothing is not a question it can answer.
    expect(confirm('too short')).toEqual({ verified: false, because: 'no-claim' })
    expect(confirm(`Account ${FIGURE}`)).toEqual({ verified: false, because: 'no-claim' })
  }, 180_000)

  it('says why it abstained rather than going silent', async () => {
    const aligned = await scanned()
    const originalGray = toGrayscale(aligned.original.raster)
    const scanGray = toGrayscale(aligned.aligned.raster)
    const { dpi } = aligned.original
    if (dpi === null) throw new Error('the fixture was extracted without a resolution')
    const items = aligned.metadata.original.textItems
    const templates = collectTemplates(originalGray, dpi, items)
    const run = items.find(item => item.text.includes(FIGURE))
    if (run === undefined) throw new Error('the fixture does not print the figure')

    // Nothing to check is not the same as checked and agreed, and neither is
    // "this face is too rare to rule anything out".
    expect(verifyPrintedRun(originalGray, scanGray, dpi, { ...run, text: 'Account' }, templates, {}))
      .toEqual({ verified: false, because: 'no-figure' })
    expect(verifyPrintedRun(originalGray, scanGray, dpi, run, templates, { minRivals: 99 }))
      .toEqual({ verified: false, because: 'few-rivals' })
  }, 180_000)
})
