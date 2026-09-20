import type { PdfTextRun, Raster } from '@scanmate/ink'

import { extractPages } from '../page-extraction'
import { A4, createSyntheticPdf } from '../synthetic-pdf'
import type { SyntheticPdfPage } from '../synthetic-pdf'

const PRINTED: SyntheticPdfPage = {
  text: [{ x: 72, y: 760, size: 18, content: 'ORDER CONFIRMATION' }, { x: 300, y: 500, content: 'Total 1,250.00' }],
}

/** Bounds of the dark pixels near an item, in points - where the glyphs really are. */
function inkBounds (raster: Raster, dpi: number, item: PdfTextRun, margin = 12) {
  const s = dpi / 72
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (let y = Math.max(0, Math.floor((item.y - margin) * s)); y < Math.min(raster.height, (item.y + item.height + margin) * s); y++)
    for (let x = Math.max(0, Math.floor((item.x - margin) * s)); x < Math.min(raster.width, (item.x + item.width + margin) * s); x++) {
      if (raster.data[(y * raster.width + x) * 4] > 128) continue
      left = Math.min(left, x)
      right = Math.max(right, x + 1)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y + 1)
    }

  return { left: left / s, top: top / s, right: right / s, bottom: bottom / s }
}

describe('readTextLayer', () => {
  it('places every run on the page from its top-left, in points, around the ink it prints', async () => {
    const [page] = await extractPages(await createSyntheticPdf([PRINTED]), { dpi: 144, output: 'none' })
    const items = page.metadata.textItems

    expect(items.map(i => i.text)).toEqual(['ORDER CONFIRMATION', 'Total 1,250.00'])
    const [title] = items
    expect(title.baseline.x).toBeCloseTo(72, 1)
    expect(title.baseline.y).toBeCloseTo(A4.height - 760, 1)
    expect(title).toMatchObject({ fontSize: 18, angle: 0 })

    for (const item of items) {
      const ink = inkBounds(page.image.raster, 144, item)
      // Horizontally the box is the advance, so it hugs the ink within side bearings.
      expect(Math.abs(ink.left - item.x)).toBeLessThan(2)
      expect(Math.abs(ink.right - (item.x + item.width))).toBeLessThan(2)
      // Vertically it runs from ascent to descent, so the glyphs sit inside it.
      expect(ink.top).toBeGreaterThanOrEqual(item.y - 0.5)
      expect(ink.bottom).toBeLessThanOrEqual(item.y + item.height + 0.5)
    }
  }, 30_000)

  it('places runs on a rotated page where the rendered page shows them', async () => {
    const [page] = await extractPages(await createSyntheticPdf([{ ...PRINTED, rotate: 90 }]), { dpi: 144, output: 'none' })
    const [title] = page.metadata.textItems

    // Rotated a quarter turn clockwise, the page is landscape and the text runs down it.
    expect(page.image.width).toBeGreaterThan(page.image.height)
    expect(title.angle).toBeCloseTo(90, 5)
    expect(title.height).toBeGreaterThan(title.width)
    const ink = inkBounds(page.image.raster, 144, title)
    expect(Math.abs(ink.top - title.y)).toBeLessThan(2)
    expect(Math.abs(ink.bottom - (title.y + title.height))).toBeLessThan(2)
    expect(ink.left).toBeGreaterThanOrEqual(title.x - 0.5)
    expect(ink.right).toBeLessThanOrEqual(title.x + title.width + 0.5)
  }, 30_000)

  it('has no runs on a page with no text, and none when text is not asked for', async () => {
    const [blank] = await extractPages(await createSyntheticPdf([{ lines: [{ x1: 72, y1: 700, x2: 520, y2: 700 }] }]), { dpi: 72, output: 'none' })
    const [skipped] = await extractPages(await createSyntheticPdf([PRINTED]), { dpi: 72, output: 'none', includeText: false })

    expect(blank.metadata.textItems).toEqual([])
    expect(skipped.metadata).toMatchObject({ text: null, textItems: [] })
  })
})
