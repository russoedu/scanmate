import type { PageMetadata } from '../page-inspection'
import { DEFAULT_DPI_LIMITS, nativeDpi, pageDpi, pairDpi } from './render-dpi.policy'

function page (effectiveDpi: number | null, pointWidth = 595.28, pointHeight = 841.89): PageMetadata {
  return {
    page:           1,
    pointWidth,
    pointHeight,
    rotation:       0,
    mediaBox:       { x: 0, y: 0, width: pointWidth, height: pointHeight },
    kind:           effectiveDpi === null ? 'vector' : 'scanned',
    imageCoverage:  effectiveDpi === null ? 0 : 1,
    hasTextLayer:   effectiveDpi === null,
    text:           null,
    textItems:      [],
    characterCount: 0,
    embeddedImages: [],
    effectiveDpi,
  }
}

const BORN_DIGITAL = page(null)
const LIMITS = DEFAULT_DPI_LIMITS

describe('nativeDpi', () => {
  it('uses a scan at the resolution it was scanned at', () => {
    expect(nativeDpi(page(93), LIMITS)).toBe(93)
  })

  it('falls back for a page that is not a scan', () => {
    expect(nativeDpi(BORN_DIGITAL, LIMITS)).toBe(200)
  })

  it('clamps an absurd resolution read from the file', () => {
    expect(nativeDpi(page(12), LIMITS)).toBe(72)
    expect(nativeDpi(page(2400), LIMITS)).toBe(400)
  })
})

describe('pairDpi', () => {
  it("renders both sides at the scan's resolution when matching", () => {
    expect(pairDpi(BORN_DIGITAL, page(120), 'match', LIMITS)).toEqual({ original: 120, scanned: 120 })
  })

  it("measures a photo stored at one pixel per point on the original's paper, and leaves its pixels alone", () => {
    // 3024 x 4032 pixels of an A4 sheet, on a 3024 x 4032 point page: 72 dpi of itself, 345 on the sheet it fits.
    const photo = page(72, 3024, 4032)

    expect(pairDpi(BORN_DIGITAL, photo, 'match', LIMITS)).toEqual({ original: expect.closeTo(344.8, 1), scanned: 72 })
  })

  it('reads the scan on its paper whichever way round it was stored', () => {
    expect(pairDpi(BORN_DIGITAL, page(72, 4032, 3024), 'match', LIMITS).original).toBeCloseTo(344.8, 1)
  })

  it('takes a scan of a Letter page on an A4 page for what it says, not a different resolution', () => {
    expect(pairDpi(page(null, 612, 792), page(150), 'match', LIMITS)).toEqual({ original: 150, scanned: 150 })
  })

  it('renders each side at its own resolution when native', () => {
    expect(pairDpi(BORN_DIGITAL, page(120), 'native', LIMITS)).toEqual({ original: 200, scanned: 120 })
  })

  it('renders both at a fixed resolution when given one', () => {
    expect(pairDpi(BORN_DIGITAL, page(120), 150, LIMITS)).toEqual({ original: 150, scanned: 150 })
  })

  it('falls back on both sides when neither is a scan', () => {
    expect(pairDpi(BORN_DIGITAL, BORN_DIGITAL, 'match', LIMITS)).toEqual({ original: 200, scanned: 200 })
  })
})

describe('pageDpi', () => {
  it("treats 'match' as 'native' for a single document, having nothing to match", () => {
    expect(pageDpi(page(144), 'match', LIMITS)).toBe(144)
  })

  it('refuses a resolution that is not a positive number', () => {
    expect(() => pageDpi(BORN_DIGITAL, 0, LIMITS)).toThrow(/positive/)
    expect(() => pageDpi(BORN_DIGITAL, NaN, LIMITS)).toThrow(/positive/)
  })
})
