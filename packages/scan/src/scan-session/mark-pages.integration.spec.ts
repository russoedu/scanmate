import { createSyntheticPdf } from '@scanmate/extract'
import type { Raster, ScanmateRect } from '@scanmate/ink'

import { Scanmate } from './scanmate.use-case'

/**
 * Marks drawn where their coordinates say, proven through real pdf.js at both
 * ends rather than asserted.
 *
 * A text item is measured the way a caller would measure a field - by
 * `Scanmate.extract`, which reads it through pdf.js - then marked, and the page
 * rendered again. Where the two renders differ is the box that was drawn, and
 * it has to sit on the text. A helper for checking positions that were wrong on
 * a turned page would give false confidence on exactly the pages that most need
 * checking, so every quarter turn is tried.
 */

/** Where two renders of the same page differ. */
function changed (before: Raster, after: Raster): ScanmateRect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let y = 0; y < before.height; y++)
    for (let x = 0; x < before.width; x++) {
      const i = (y * before.width + x) * 4
      const difference = Math.abs(before.data[i] - after.data[i]) + Math.abs(before.data[i + 1] - after.data[i + 1]) + Math.abs(before.data[i + 2] - after.data[i + 2])
      if (difference > 60) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }

  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** How far the drawn box's furthest edge lies from where it was meant to be. */
function worstEdge (drawn: ScanmateRect, meant: ScanmateRect): number {
  return Math.max(
    Math.abs(drawn.x - meant.x),
    Math.abs(drawn.y - meant.y),
    Math.abs(drawn.x + drawn.width - (meant.x + meant.width)),
    Math.abs(drawn.y + drawn.height - (meant.y + meant.height)),
  )
}

async function measured (rotation: 0 | 90 | 180 | 270): Promise<{ pdf: Uint8Array, text: ScanmateRect }> {
  const pdf = await createSyntheticPdf([{ rotate: rotation, text: [{ x: 120, y: 520, size: 18, content: 'Signature here' }] }])
  const [page] = await Scanmate.extract(pdf, { dpi: 72, output: 'none', includeText: true })
  const [text] = page.metadata.textItems ?? []
  if (text === undefined) throw new Error('the fixture printed no text')

  return { pdf, text }
}

async function drawnBox (original: Uint8Array, marked: Uint8Array): Promise<ScanmateRect> {
  const [before] = await Scanmate.extract(original, { dpi: 72, output: 'none' })
  const [after] = await Scanmate.extract(marked, { dpi: 72, output: 'none' })

  return changed(before.image.raster, after.image.raster)
}

describe('Scanmate.mark', () => {
  it.each([0, 90, 180, 270] as const)('draws the mark on the text it was measured from, on a page turned %i degrees', async (rotation) => {
    const { pdf, text } = await measured(rotation)
    const { pdf: marked, drawn, warnings } = await Scanmate.mark(pdf, [{ page: 1, ...text }], { bleed: 0, labels: false })

    expect(drawn).toBe(1)
    expect(warnings).toEqual([])
    // Within the width of the stroke, which straddles the edge it draws.
    expect(worstEdge(await drawnBox(pdf, marked), text)).toBeLessThanOrEqual(2)
  }, 60_000)

  it('draws the bleed side by side, each side overriding the generic', async () => {
    const { pdf, text } = await measured(0)
    const { pdf: marked } = await Scanmate.mark(pdf, [{ page: 1, ...text }], { bleed: 4, bleedBottom: 20, labels: false })
    const box = await drawnBox(pdf, marked)

    // Four points of room above and to the sides, twenty below.
    const bled = { x: text.x - 4, y: text.y - 4, width: text.width + 8, height: text.height + 24 }
    expect(worstEdge(box, bled)).toBeLessThanOrEqual(2)
  }, 60_000)

  it('says when a mark is on a page the document does not have, or runs off its page', async () => {
    const { pdf, text } = await measured(0)
    const { drawn, warnings } = await Scanmate.mark(pdf, [
      { page: 3, id: 'signature', ...text },
      { page: 1, id: 'date', x: 560, y: 100, width: 80, height: 20 },
    ])

    expect(drawn).toBe(1)
    expect(warnings).toEqual([
      'signature is on page 3, and the document has 1',
      'date reaches past the edge of page 1, which is 595.3 x 841.9 pt',
    ])
  }, 60_000)

  it('refuses something that is not a PDF', async () => {
    await expect(Scanmate.mark(new Uint8Array([1, 2, 3, 4, 5]), [])).rejects.toThrow(TypeError)
  })
})
