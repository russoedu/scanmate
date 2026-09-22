import type { BinaryImage, ScanmateRect } from '@scanmate/ink'

import { measureRegionInk } from './region-ink.algorithm'
import type { RegionInkOptions } from './region-ink.algorithm'

const OPTIONS: RegionInkOptions = { mergeGap: 6, minChangePixels: 8, lineSpan: 0.9, lineThickness: 2, lineThicknessRatio: 0.04, edgeBand: 0.03 }
const REGION: ScanmateRect = { x: 20, y: 20, width: 200, height: 60 }

function mask (paint: (set: (x: number, y: number) => void) => void): BinaryImage {
  const width = 260
  const height = 120
  const data = new Uint8Array(width * height)
  paint((x, y) => {
    data[y * width + x] = 1
  })

  return { width, height, data }
}

const block = (x0: number, y0: number, w: number, h: number) => (set: (x: number, y: number) => void): void => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y)
}

describe('measureRegionInk', () => {
  it('measures writing inside the box: one change, off the border, a small share of the box', () => {
    // Three strokes a few pixels apart: one signature.
    const ink = measureRegionInk(mask(set => {
      block(80, 40, 20, 3)(set)
      block(104, 38, 3, 12)(set)
      block(110, 44, 25, 3)(set)
    }), REGION, OPTIONS)

    expect(ink.changes).toBe(1)
    expect(ink.pixels).toBe(60 + 36 + 75)
    expect(ink.bounds).toEqual({ x: 80, y: 38, width: 55, height: 12 })
    expect(ink.edgeTouch).toBe(0)
    expect(ink.fill).toBeCloseTo(171 / 12_000, 5)
    expect(ink.formLines).toBe(0)
  })

  it('discards the box’s own rule, a thin sliver the length of a side', () => {
    const ink = measureRegionInk(mask(block(20, 78, 200, 2)), REGION, OPTIONS)

    expect(ink).toMatchObject({ pixels: 0, changes: 0, bounds: null, formLines: 1 })
  })

  it('keeps a stroke that is long but not thin: a line drawn through the field is writing', () => {
    const ink = measureRegionInk(mask(block(20, 45, 200, 6)), REGION, OPTIONS)

    expect(ink.formLines).toBe(0)
    expect(ink.pixels).toBe(1200)
  })

  it('reports how much of a blacked-out box is ink', () => {
    const ink = measureRegionInk(mask(block(30, 25, 180, 50)), REGION, OPTIONS)

    expect(ink.fill).toBeCloseTo(9000 / 12_000, 5)
  })

  it('reports ink crowding the border, as ink that came in from outside does', () => {
    const ink = measureRegionInk(mask(block(20, 20, 30, 4)), REGION, OPTIONS)

    expect(ink.edgeTouch).toBeGreaterThan(0.3)
  })

  it('ignores specks below the smallest change, and ink outside the region', () => {
    const ink = measureRegionInk(mask(set => {
      block(100, 50, 2, 2)(set)
      block(230, 100, 20, 10)(set)
    }), REGION, OPTIONS)

    expect(ink).toMatchObject({ pixels: 0, changes: 0 })
  })

  it('measures nothing for a region off the page', () => {
    expect(measureRegionInk(mask(() => {}), { x: 500, y: 500, width: 10, height: 10 }, OPTIONS)).toMatchObject({ pixels: 0, bounds: null })
  })
})
