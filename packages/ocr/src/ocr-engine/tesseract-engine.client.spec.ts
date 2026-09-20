import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { alignPages } from '@scanmate/align'
import { A4, createSyntheticPdf, extractPages, extractPair } from '@scanmate/extract'
import type { SyntheticPdfPage } from '@scanmate/extract'
import { simulateScan } from '@scanmate/ink'

import { ocrPages } from '../page-reading'
import { createTesseractEngine, DEFAULT_TESSERACT_OPTIONS } from './tesseract-engine.client'

const PRINTED = (total: string): SyntheticPdfPage => ({
  text: [
    { x: 72, y: 760, size: 20, content: 'ORDER CONFIRMATION' },
    { x: 72, y: 700, size: 14, content: 'Customer: The Resistance' },
    { x: 72, y: 670, size: 14, content: `Total ${total}` },
    { x: 72, y: 640, size: 14, content: 'Term: 3 years from 17 September 2026' },
  ],
})

describe('createTesseractEngine', () => {
  it('reads English from the bundled data, writing nothing, and says what it resolved', async () => {
    const engine = await createTesseractEngine()
    try {
      expect(engine.settings).toMatchObject({ languages: ['eng'], model: 'best', cacheMethod: 'none', pageSegmentation: 3 })
      expect(engine.settings.languageData.replaceAll('\\', '/')).toMatch(/@tesseract\.js-data\/eng\/4\.0\.0_best_int$/)
      expect(engine.settings.cachePath).toBe(join(tmpdir(), 'scanmate-ocr'))
      expect(DEFAULT_TESSERACT_OPTIONS.cache.method).toBe('none')

      const [page] = await extractPages(await createSyntheticPdf([PRINTED('1,250.00')]), { dpi: 300, output: 'none' })
      const read = await engine.recognise(page.image.raster)

      expect(read.text).toContain('ORDER CONFIRMATION')
      expect(read.text).toContain('1,250.00')
      expect(read.confidence).toBeGreaterThan(80)
      // Words carry boxes in the image's pixels: the title sits about an inch and a bit from the top at 300 dpi.
      const title = read.lines[0].words[0]
      expect(title.text).toBe('ORDER')
      expect(title.y).toBeGreaterThan(200)
      expect(title.y).toBeLessThan(400)
    } finally {
      await engine.terminate()
    }
  }, 120_000)

  it('names the package to install for a language it has no data for', async () => {
    await expect(createTesseractEngine({ languages: ['xx_not_a_language'] })).rejects.toThrow(/npm install @tesseract\.js-data\/xx_not_a_language/)
  })
})

describe('ocrPages, end to end', () => {
  it('finds the one amount a crooked scan changed, and where it is', async () => {
    const original = await createSyntheticPdf([PRINTED('1,250.00')])
    const altered = await extractPages(await createSyntheticPdf([PRINTED('7,250.00')]), { dpi: 150, output: 'none' })
    const scan = simulateScan(altered[0].image.raster, { rotationDeg: 1.2, scale: 1, noise: 0.01, blur: 0.5, illumination: 0.1, seed: 3 })
    const scanned = await createSyntheticPdf([{ images: [{ raster: scan.raster, x: 0, y: 0, width: A4.width, height: A4.height }] }])

    const { pages } = await extractPair({ original, scanned }, { output: 'none' })
    const aligned = await alignPages(pages, { output: 'none' })
    const report = await ocrPages(aligned)
    const [{ text: result }] = report.pages

    expect(result.original.source).toBe('text-layer')
    const changed = result.differences.filter(d => d.kind === 'changed')
    expect(changed).toHaveLength(1)
    expect(changed[0].expected).toBe('Total 1,250.00')
    expect(changed[0].found).toContain('7,250.00')
    // Where the original printed it: 72 pt in, about 170 pt down.
    expect(changed[0].x).toBeCloseTo(72, -1)
    expect(changed[0].y).toBeGreaterThan(155)
    expect(changed[0].y).toBeLessThan(175)
    expect(result.score).toBeGreaterThan(0.9)
    expect(result.score).toBeLessThan(1)
  }, 180_000)
})
