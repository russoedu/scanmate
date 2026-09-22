import { cloneRaster, createSyntheticDocument, drawLine, drawTick, fillRect, IDENTITY, simulateScan } from '@scanmate/ink'
import type { AlignedPage, Raster, ScanmateRect } from '@scanmate/ink'

import { readCheckboxes } from './read-checkboxes.use-case'
import type { Checkbox } from './checkbox.contract'

const FORM = createSyntheticDocument({ width: 1240, height: 1754, seed: 5 })
const [FIRST, SECOND, THIRD] = ['tick-1', 'tick-2', 'tick-3'].map(id => FORM.regions[id])

/** The pair on one canvas: an A4 page at 150 dpi, whose boxes are 4.6 mm and whose pen is half a millimetre. */
function page (original: Raster, scanned: Raster): AlignedPage {
  const side = (raster: Raster) => ({ raster, image: null, width: raster.width, height: raster.height, dpi: 150 })

  return {
    page:     1,
    original: side(original),
    scanned:  side(scanned),
    aligned:  { raster: scanned, image: null, dpi: null, width: scanned.width, height: scanned.height, matrix: IDENTITY, inverse: IDENTITY, confidence: 1 },
  }
}

/** A box in points, from a region in pixels. */
function box (id: string, rect: ScanmateRect, expect?: 'ticked' | 'empty'): Checkbox {
  const points = 72 / 150

  return { page: 1, id, x: rect.x * points, y: rect.y * points, width: rect.width * points, height: rect.height * points, ...(expect && { expect }) }
}

function withInk (draw: (raster: Raster) => void, from = FORM.raster): Raster {
  const raster = cloneRaster(from)
  draw(raster)

  return raster
}

/** A fine pen cross: two strokes corner to corner, 0.34 mm wide. */
function cross (raster: Raster, rect: ScanmateRect): void {
  drawLine(raster, rect.x + 4, rect.y + 4, rect.x + rect.width - 4, rect.y + rect.height - 4, 2, 20)
  drawLine(raster, rect.x + rect.width - 4, rect.y + 4, rect.x + 4, rect.y + rect.height - 4, 2, 20)
}

describe('readCheckboxes', () => {
  it('reads an empty box as empty, however noisy the scan, and ignores its printed frame', async () => {
    // Sensor noise well past a real scanner's, and a lamp falling off to one side.
    for (const seed of [1, 2, 3, 4]) {
      const noisy = simulateScan(FORM.raster, { noise: 0.2, blur: 1, illumination: 0.3, seed }).raster
      const readings = await readCheckboxes([page(FORM.raster, noisy)], [box('a', FIRST), box('b', SECOND), box('c', THIRD)])

      for (const reading of readings) {
        expect(reading).toMatchObject({ original: { state: 'empty' }, scanned: { state: 'empty' }, changed: false })
        expect(reading.scanned.ink).toBeLessThan(0.3)
      }
    }
  }, 60_000)

  it('does not read its own frame as a mark when the alignment is a little out', async () => {
    for (const [translateX, translateY] of [[2, 0], [0, -2], [2, 2]]) {
      const shifted = simulateScan(FORM.raster, { translateX, translateY, seed: 1 }).raster
      const readings = await readCheckboxes([page(FORM.raster, shifted)], [box('a', FIRST), box('b', SECOND), box('c', THIRD)])

      expect(readings.map(r => r.scanned.state)).toStrictEqual(['empty', 'empty', 'empty'])
    }
  }, 60_000)

  it('tells a tick and a cross from a box inked over', async () => {
    const scanned = withInk((r) => {
      drawTick(r, FIRST)
      cross(r, SECOND)
      fillRect(r, THIRD, 20)
    })
    const readings = await readCheckboxes([page(FORM.raster, scanned)], [box('tick', FIRST), box('cross', SECOND), box('blacked', THIRD)])

    expect(readings.map(r => [r.id, r.original.state, r.scanned.state, r.changed])).toStrictEqual([
      ['tick', 'empty', 'ticked', true],
      ['cross', 'empty', 'ticked', true],
      ['blacked', 'empty', 'struck', true],
    ])
    expect(readings[0].scanned.ink).toBeGreaterThan(1.5)
    expect(readings[1].scanned.ink).toBeGreaterThan(0.6)
  }, 60_000)

  it('sees a thin grey pen tick through a noisy scan', async () => {
    const ticked = withInk((r) => {
      drawLine(r, FIRST.x + FIRST.width * 0.2, FIRST.y + FIRST.height * 0.55, FIRST.x + FIRST.width * 0.42, FIRST.y + FIRST.height * 0.8, 2, 120)
      drawLine(r, FIRST.x + FIRST.width * 0.42, FIRST.y + FIRST.height * 0.8, FIRST.x + FIRST.width * 0.85, FIRST.y + FIRST.height * 0.15, 2, 120)
    })
    for (const seed of [1, 2]) {
      const [reading] = await readCheckboxes([page(FORM.raster, simulateScan(ticked, { noise: 0.12, blur: 1, illumination: 0.3, seed }).raster)], [box('tick', FIRST)])

      expect(reading.scanned.state).toBe('ticked')
    }
  }, 60_000)

  it('reads a tick in a box as small as the W-9 prints, and still knows one inked over', async () => {
    // 3 mm - 8.5 points - is the W-9's tax-classification box, and two 0.5 mm
    // strokes fill half of it, so a tick used to be read as a box inked over.
    // What separates them is solid ink: a stroke does not survive erosion.
    const small = { x: 40, y: 40, width: 3 / 25.4 * 150, height: 3 / 25.4 * 150 }
    const pen = Math.max(1, Math.round(0.5 / 25.4 * 150))
    const ticked = withInk((r) => {
      drawLine(r, small.x + small.width * 0.2, small.y + small.height * 0.55, small.x + small.width * 0.42, small.y + small.height * 0.8, pen, 30)
      drawLine(r, small.x + small.width * 0.42, small.y + small.height * 0.8, small.x + small.width * 0.85, small.y + small.height * 0.15, pen, 30)
    })
    const blacked = withInk(r => fillRect(r, small, 20))
    const read = async (scanned: Raster) => {
      const [reading] = await readCheckboxes([page(FORM.raster, scanned)], [box('classification', small)])

      return reading
    }

    const marked = await read(ticked)
    expect(marked.scanned.state).toBe('ticked')
    expect(marked.scanned.fill).toBeGreaterThan(0.4)
    expect(marked.scanned.solid).toBeLessThan(0.2)
    const inkedOver = await read(blacked)
    expect(inkedOver.scanned).toMatchObject({ state: 'struck' })
  }, 60_000)

  it('reads each side on its own: a box ticked before issue is not a change, one cleared is', async () => {
    const issued = withInk(r => drawTick(r, FIRST))
    const kept = withInk(r => drawTick(r, FIRST))
    const [same] = await readCheckboxes([page(issued, kept)], [box('pre-ticked', FIRST)])
    const [cleared] = await readCheckboxes([page(issued, FORM.raster)], [box('pre-ticked', FIRST)])

    expect(same).toMatchObject({ original: { state: 'ticked' }, scanned: { state: 'ticked' }, changed: false })
    expect(cleared).toMatchObject({ original: { state: 'ticked' }, scanned: { state: 'empty' }, changed: true })
  }, 60_000)

  it('says whether each box shows what it must', async () => {
    const scanned = withInk(r => drawTick(r, FIRST))
    const readings = await readCheckboxes([page(FORM.raster, scanned)], [
      box('agreed', FIRST, 'ticked'),
      box('declined', SECOND, 'empty'),
      box('required', THIRD, 'ticked'),
      box('optional', { ...THIRD, x: THIRD.x + 120 }),
    ])

    expect(readings.map(r => [r.id, r.satisfied])).toStrictEqual([['agreed', true], ['declined', true], ['required', false], ['optional', null]])
  }, 60_000)

  it('reads only the pages it has boxes for', async () => {
    const readings = await readCheckboxes([page(FORM.raster, FORM.raster)], [{ ...box('elsewhere', FIRST), page: 2 }])

    expect(readings).toStrictEqual([])
  }, 60_000)
})
