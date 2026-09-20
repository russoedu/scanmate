import { alignScan } from '@scanmate/align'
import { cloneRaster, createSyntheticDocument, decodeImage, drawSignature, drawTick, fillRect, IDENTITY, simulateScan } from '@scanmate/ink'
import type { AlignedPage, Raster, ScanmateRect, StageEvent } from '@scanmate/ink'

import { IDENTIFIED, NOT_IDENTIFIED, REFERENCE, UNEXPECTED } from './annotate-overlay.use-case'
import { diffPage, diffPages } from './diff-pages.use-case'
import type { ExpectedChange } from './page-diff.contract'

const FORM = createSyntheticDocument({ width: 600, height: 780, seed: 5 })
const SIGNATURE = FORM.regions.signature
const TICK = FORM.regions['tick-1']

/**
 * A page already on the original's canvas. At 72 dpi one point is one pixel,
 * which keeps the rectangles in these tests readable; units have their own test.
 */
function page (aligned: Raster, dpi = 72, number = 1): AlignedPage {
  const side = { raster: FORM.raster, image: null, width: FORM.raster.width, height: FORM.raster.height, dpi }

  return {
    page:     number,
    original: side,
    scanned:  { ...side, raster: aligned },
    aligned:  { raster: aligned, image: null, dpi: null, width: aligned.width, height: aligned.height, matrix: IDENTITY, inverse: IDENTITY, confidence: 1 },
  }
}

function expect_ (id: string, rect: ScanmateRect, pageNumber = 1): ExpectedChange {
  return { page: pageNumber, id, ...rect }
}

function signed (): Raster {
  const raster = cloneRaster(FORM.raster)
  drawSignature(raster, SIGNATURE, 4)

  return raster
}

function hasColour (raster: Raster, color: readonly number[]): boolean {
  for (let i = 0; i < raster.data.length; i += 4)
    if (raster.data[i] === color[0] && raster.data[i + 1] === color[1] && raster.data[i + 2] === color[2]) return true

  return false
}

describe('diffPage', () => {
  it('reports nothing on an unchanged page', async () => {
    const diff = await diffPage(page(cloneRaster(FORM.raster)), [], { output: 'none' })

    expect(diff.unexpected).toEqual([])
    expect(diff.missing).toEqual([])
    expect(diff.summary.addedInk).toBe(0)
  })

  it('identifies a signature where one was expected, and calls nothing unexpected', async () => {
    const diff = await diffPage(page(signed()), [expect_('signature', SIGNATURE)], { output: 'none' })

    expect(diff.expected).toEqual([expect.objectContaining({ id: 'signature', identified: true })])
    expect(diff.unexpected).toEqual([])
  })

  it('takes a signature written past its box for the signature it is', async () => {
    // Signed across a box drawn a little too small for the hand that filled it.
    const raster = cloneRaster(FORM.raster)
    drawSignature(raster, SIGNATURE, 4)
    const tight = { x: SIGNATURE.x + 30, y: SIGNATURE.y + 6, width: SIGNATURE.width - 60, height: SIGNATURE.height - 12 }
    const diff = await diffPage(page(raster), [expect_('signature', tight)], { output: 'none' })

    expect(diff.expected[0].identified).toBe(true)
    expect(diff.unexpected).toEqual([])
  })

  it('still reports a mark made beyond the margin of every expected region', async () => {
    const raster = signed()
    drawTick(raster, TICK)
    const diff = await diffPage(page(raster), [expect_('signature', SIGNATURE)], { output: 'none' })

    expect(diff.expected[0].identified).toBe(true)
    expect(diff.unexpected).toHaveLength(1)
  })

  it('claims a stroke running through two fields at once, rather than leaving it over', async () => {
    // One line written across both boxes, as a hurried signature crosses a rule.
    const raster = cloneRaster(FORM.raster)
    const across = { x: SIGNATURE.x, y: SIGNATURE.y, width: TICK.x + TICK.width - SIGNATURE.x, height: 3 }
    fillRect(raster, across, 20)
    const diff = await diffPage(page(raster), [expect_('signature', SIGNATURE), expect_('tick', TICK)], { output: 'none' })

    expect(diff.unexpected).toEqual([])
  })

  it('does not identify an expected region that was left empty', async () => {
    const diff = await diffPage(page(signed()), [expect_('signature', SIGNATURE), expect_('tick', TICK)], { output: 'none' })

    expect(diff.expected.map(region => [region.id, region.identified])).toEqual([['signature', true], ['tick', false]])
    expect(diff.summary).toMatchObject({ identified: 1, notIdentified: 1 })
  })

  it('identifies a signature by its ink, however much of a wide box it leaves empty', async () => {
    // A box the width of the page: the signature covers well under 2% of it,
    // which a share-of-the-box rule would call empty.
    const wide = { x: 20, y: SIGNATURE.y - 40, width: 560, height: SIGNATURE.height + 80 }
    const diff = await diffPage(page(signed()), [expect_('signature', wide)], { output: 'none' })
    const boxArea = wide.width * wide.height * (25.4 / 72) ** 2

    expect(diff.expected[0].identified).toBe(true)
    expect(diff.expected[0].addedInk / boxArea).toBeLessThan(0.02)
    expect(diff.expected[0].score).toBe(1)
  })

  it('does not identify a region on a speck of dust', async () => {
    const raster = cloneRaster(FORM.raster)
    fillRect(raster, { x: SIGNATURE.x + 20, y: SIGNATURE.y + 10, width: 2, height: 2 }, 0)
    const diff = await diffPage(page(raster), [expect_('signature', SIGNATURE)], { output: 'none' })

    expect(diff.expected[0]).toMatchObject({ identified: false, addedInk: 0 })
  })

  it('describes the shape of a signature: one change, inside its box, clear of the border', async () => {
    const diff = await diffPage(page(signed()), [expect_('signature', SIGNATURE)], { output: 'none' })
    const { ink, overfilled } = diff.expected[0]

    expect(overfilled).toBe(false)
    expect(ink.changes).toBe(1)
    expect(ink.largestArea).toBeCloseTo(diff.expected[0].addedInk, 5)
    expect(ink.bounds!.x).toBeGreaterThanOrEqual(SIGNATURE.x)
    expect(ink.bounds!.x + ink.bounds!.width).toBeLessThanOrEqual(SIGNATURE.x + SIGNATURE.width)
    expect(ink.widthRatio).toBeGreaterThan(0.3)
    expect(ink.widthRatio).toBeLessThanOrEqual(1)
    expect(ink.edgeTouch).toBeLessThan(0.2)
  })

  it('does not call a blacked-out box signed', async () => {
    const raster = cloneRaster(FORM.raster)
    fillRect(raster, { x: SIGNATURE.x + 2, y: SIGNATURE.y + 2, width: SIGNATURE.width - 4, height: SIGNATURE.height - 4 }, 0)
    const diff = await diffPage(page(raster), [expect_('signature', SIGNATURE)], { output: 'none' })

    expect(diff.expected[0]).toMatchObject({ identified: false, overfilled: true })
    expect(diff.expected[0].ink.fill).toBeGreaterThan(0.5)
  })

  it('does not take a sliver of the printed border for a filled-in field', async () => {
    // What a border left out of place looks like: a thin rule the length of the
    // region - clear of the printed frame's tolerance band, so new ink by
    // position - that no one wrote.
    const raster = cloneRaster(FORM.raster)
    fillRect(raster, { x: SIGNATURE.x, y: SIGNATURE.y + SIGNATURE.height - 9, width: SIGNATURE.width, height: 1 }, 0)
    const diff = await diffPage(page(raster), [expect_('signature', SIGNATURE)], { output: 'none' })

    expect(diff.expected[0].identified).toBe(false)
    expect(diff.expected[0].ink.formLines).toBe(1)
  })

  it('reports a mark nobody expected as one merged box, where it was made', async () => {
    const diff = await diffPage(page(signed()), [], { output: 'none' })

    expect(diff.unexpected).toHaveLength(1)
    const [change] = diff.unexpected
    expect(change.x).toBeGreaterThanOrEqual(SIGNATURE.x - 2)
    expect(change.x + change.width).toBeLessThanOrEqual(SIGNATURE.x + SIGNATURE.width + 2)
    expect(change.inkArea).toBeGreaterThan(1)
  })

  it('keeps an expected mark and an unexpected one apart', async () => {
    const raster = signed()
    drawTick(raster, TICK)
    const diff = await diffPage(page(raster), [expect_('signature', SIGNATURE)], { output: 'none' })

    expect(diff.expected[0].identified).toBe(true)
    expect(diff.unexpected).toHaveLength(1)
    expect(diff.unexpected[0].x).toBeGreaterThanOrEqual(TICK.x - 2)
  })

  it('ignores specks smaller than the smallest change worth reporting', async () => {
    const raster = cloneRaster(FORM.raster)
    // A 2x2 px speck at 72 dpi is about 0.5 mm2: dust, not a mark.
    fillRect(raster, { x: 300, y: 700, width: 2, height: 2 }, 0)
    const diff = await diffPage(page(raster), [], { output: 'none' })

    expect(diff.unexpected).toEqual([])
  })

  it('reports ink the scan lost', async () => {
    const raster = cloneRaster(FORM.raster)
    // White out a band of printed lines: a dropped paragraph.
    fillRect(raster, { x: 40, y: 120, width: 520, height: 60 }, 255)
    const diff = await diffPage(page(raster), [], { output: 'none' })

    expect(diff.missing.length).toBeGreaterThan(0)
    expect(diff.missing[0].inkArea).toBeGreaterThan(4)
    expect(diff.summary.removedInk).toBeGreaterThan(0)
  })

  it('does not call faded ink missing: lighter is not gone', async () => {
    // Wash the whole scan halfway towards white, as a scanner washes out colour.
    const faded = cloneRaster(FORM.raster)
    for (let i = 0; i < faded.data.length; i += 4)
      for (let c = 0; c < 3; c++) faded.data[i + c] = Math.round(faded.data[i + c] + (255 - faded.data[i + c]) * 0.55)
    const diff = await diffPage(page(faded), [], { output: 'none' })

    expect(diff.missing).toEqual([])
  })

  it('takes and reports rectangles in PDF points, converting through the page dpi', async () => {
    // At 144 dpi a point is two pixels: the signature box in points is half its pixel size.
    // The stray tick goes in the stamp box, far from the signature: at 144 dpi this
    // small form is physically half size, and tick-1 would fall inside the 3 mm merge gap.
    const inPoints = { x: SIGNATURE.x / 2, y: SIGNATURE.y / 2, width: SIGNATURE.width / 2, height: SIGNATURE.height / 2 }
    const stray = FORM.regions.stamp
    const raster = signed()
    drawTick(raster, stray)
    const diff = await diffPage(page(raster, 144), [expect_('signature', inPoints)], { output: 'none' })

    expect(diff.expected[0].identified).toBe(true)
    expect(diff.expected[0].x).toBe(inPoints.x)
    expect(diff.unexpected).toHaveLength(1)
    expect(Math.abs(diff.unexpected[0].x - stray.x / 2)).toBeLessThan(stray.width / 2)
  })

  it('takes rectangles in pixels when asked', async () => {
    const diff = await diffPage(page(signed(), 144), [expect_('signature', SIGNATURE)], { output: 'none', units: 'pixels' })

    expect(diff.expected[0].identified).toBe(true)
  })

  it('says a page was truncated rather than listing every fragment', async () => {
    const raster = cloneRaster(FORM.raster)
    for (let i = 0; i < 12; i++) fillRect(raster, { x: 40 + i * 45, y: 740, width: 20, height: 20 }, 0)
    const diff = await diffPage(page(raster), [], { output: 'none', maxChanges: 5 })

    expect(diff.truncated).toBe(true)
    expect(diff.unexpected).toHaveLength(5)
  })

  it('draws the report onto the overlay when asked to annotate', async () => {
    const raster = signed()
    drawTick(raster, TICK)
    const expected = [expect_('signature', SIGNATURE), expect_('stamp', FORM.regions.stamp)]
    const plain = await diffPage(page(raster), expected, { output: 'none' })
    const annotated = await diffPage(page(raster), expected, { output: 'none', annotate: true })

    expect(hasColour(plain.diffRaster, IDENTIFIED)).toBe(false)
    expect(hasColour(annotated.diffRaster, IDENTIFIED)).toBe(true)
    expect(hasColour(annotated.diffRaster, NOT_IDENTIFIED)).toBe(true)
    expect(hasColour(annotated.diffRaster, UNEXPECTED)).toBe(true)
  })

  it('puts the original and the aligned scan side by side: where on the left, what on the right', async () => {
    const raster = signed()
    drawTick(raster, TICK)
    const expected = [expect_('signature', SIGNATURE), expect_('stamp', FORM.regions.stamp)]
    const plain = await diffPage(page(raster), expected, { output: 'none' })
    const diff = await diffPage(page(raster), expected, { output: 'none', sideBySide: true })
    const { sideBySideRaster: pair } = diff
    const half = FORM.raster.width
    const at = (x: number, y: number): number[] => [...pair!.data.slice((y * pair!.width + x) * 4, (y * pair!.width + x) * 4 + 3)]

    expect(plain.sideBySideRaster).toBeNull()
    expect(pair!.height).toBe(FORM.raster.height)
    expect(pair!.width).toBeGreaterThan(2 * half)
    const gutter = pair!.width - 2 * half
    // The same box on both halves: on the original it is the area in question,
    // on the scan it is the answer - this one was signed.
    const corner = { x: Math.round(SIGNATURE.x - 2), y: Math.round(SIGNATURE.y - 2) }
    expect(at(corner.x, corner.y)).toEqual(REFERENCE.slice(0, 3))
    expect(at(corner.x + half + gutter, corner.y)).toEqual(IDENTIFIED.slice(0, 3))
    expect(hasColour(pair!, NOT_IDENTIFIED)).toBe(true)
    expect(hasColour(pair!, UNEXPECTED)).toBe(true)
    // The right half is the scan: the signature's ink is there and not on the left.
    const inkIn = (x0: number): number => {
      let dark = 0
      for (let y = Math.round(SIGNATURE.y) + 3; y < SIGNATURE.y + SIGNATURE.height - 3; y++)
        for (let x = x0 + Math.round(SIGNATURE.x) + 3; x < x0 + SIGNATURE.x + SIGNATURE.width - 3; x++) if (pair!.data[(y * pair!.width + x) * 4] < 100) dark++

      return dark
    }
    expect(inkIn(half + gutter)).toBeGreaterThan(inkIn(0) + 50)
  })

  it('encodes the overlay as PNG by default', async () => {
    const diff = await diffPage(page(signed()))
    const decoded = await decodeImage(diff.diffImage!)

    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: FORM.raster.width, height: FORM.raster.height })
  })
})

describe('diffPages', () => {
  it('gives each page only its own expected regions, and reports progress per page', async () => {
    const events: StageEvent[] = []
    const diffs = await diffPages(
      [page(signed(), 72, 1), page(cloneRaster(FORM.raster), 72, 2)],
      [expect_('signature', SIGNATURE, 1), expect_('witness', SIGNATURE, 2)],
      { output: 'none', onProgress: e => { events.push(e) } },
    )

    expect(diffs.map(compared => compared.diff.expected.map(region => [region.id, region.identified]))).toEqual([[['signature', true]], [['witness', false]]])
    expect(events.map(e => `${e.stage}:${e.phase}:${e.page}`)).toEqual(['diff:start:1', 'diff:done:1', 'diff:start:2', 'diff:done:2'])
  })

  it('works end to end on a crooked, noisy scan that align has put back in place', async () => {
    const scan = simulateScan(signed(), { rotationDeg: -2.2, scale: 1.3, noise: 0.01, blur: 0.8, illumination: 0.2, seed: 8 })
    const aligned = await alignScan(FORM.raster, scan.raster, { output: 'none' })
    const side = { raster: FORM.raster, image: null, width: FORM.raster.width, height: FORM.raster.height, dpi: 72 }
    const [compared] = await diffPages(
      [{ page: 1, original: side, scanned: { ...side, raster: scan.raster }, aligned }],
      [expect_('signature', SIGNATURE), expect_('tick', TICK)],
      { output: 'none' },
    )

    expect(compared.diff.expected.map(region => [region.id, region.identified])).toEqual([['signature', true], ['tick', false]])
    expect(compared.diff.unexpected).toEqual([])
    // This scan's blur washes the form's 1-pixel rules down to 5% ink - below
    // the faint threshold and at the ink map's own noise floor - so a hairline
    // really is gone from the image, and missing says so. Nothing thicker is.
    for (const lost of compared.diff.missing) expect(Math.min(lost.width, lost.height)).toBeLessThanOrEqual(2)
  }, 60_000)
})
