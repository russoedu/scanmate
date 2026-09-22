import type { Raster } from '@scanmate/ink'
import type { Region } from './region.model'
import { alignScan } from '@scanmate/align'
import { cloneRaster, createRaster, createSyntheticDocument, drawSignature, drawTick, simulateScan } from '@scanmate/ink'
import { compareRegions, diffDocument } from './compare-regions.use-case'

const BLANK = createSyntheticDocument({ width: 520, height: 680, seed: 3 })

const REGIONS: Region[] = [
  { id: 'signature', rect: BLANK.regions.signature },
  { id: 'tick-1', rect: BLANK.regions['tick-1'] },
  { id: 'tick-2', rect: BLANK.regions['tick-2'] },
  { id: 'stamp', rect: BLANK.regions.stamp },
]

/** The same form, filled in: signed, with the first box ticked. */
function filledForm (): Raster {
  const page = cloneRaster(BLANK.raster)
  drawSignature(page, BLANK.regions.signature, 5)
  drawTick(page, BLANK.regions['tick-1'])

  return page
}

function byId (reports: Awaited<ReturnType<typeof compareRegions>>) {
  return Object.fromEntries(reports.map(r => [r.id, r]))
}

describe('compareRegions', () => {
  it('finds no new ink when the scan is the original', async () => {
    const reports = await compareRegions(BLANK.raster, BLANK.raster, REGIONS)
    for (const report of reports) {
      expect(report.added).toBeCloseTo(0, 4)
      expect(report.filled).toBe(false)
    }
  })

  it('spots a signature and a tick, and leaves the empty boxes alone', async () => {
    const reports = byId(await compareRegions(BLANK.raster, filledForm(), REGIONS))

    expect(reports.signature.filled).toBe(true)
    expect(reports['tick-1'].filled).toBe(true)
    expect(reports['tick-2'].filled).toBe(false)
    expect(reports.stamp.filled).toBe(false)
    expect(reports.signature.added).toBeGreaterThan(reports['tick-2'].added)
  })

  it('works end to end through a rotated, rescaled, noisy scan', async () => {
    const scan = simulateScan(filledForm(), {
      rotationDeg:  -2.6,
      scale:        1.4,
      translateX:   18,
      translateY:   -22,
      noise:        0.015,
      illumination: 0.3,
      canvas:       { width: 820, height: 1050 },
      seed:         21,
    })

    const aligned = await alignScan(BLANK.raster, scan.raster, { output: 'none' })
    expect(aligned.confidence).toBeGreaterThan(0.5)

    const reports = byId(await compareRegions(BLANK.raster, aligned.raster, REGIONS))

    expect(reports.signature.filled).toBe(true)
    expect(reports['tick-1'].filled).toBe(true)
    expect(reports['tick-2'].filled).toBe(false)
  }, 60_000)

  it('does not call the printed text itself a change, at any sane tolerance', async () => {
    const scan = simulateScan(BLANK.raster, {
      rotationDeg: 1.1,
      scale:       1.25,
      noise:       0.01,
      canvas:      { width: 720, height: 920 },
    })
    const aligned = await alignScan(BLANK.raster, scan.raster, { output: 'none' })

    const wholePage: Region[] = [{ id: 'page', rect: { x: 0, y: 0, width: BLANK.raster.width, height: BLANK.raster.height } }]
    const [report] = await compareRegions(BLANK.raster, aligned.raster, wholePage)

    expect(report.added).toBeLessThan(0.02)
  }, 60_000)

  it('honours a per-region threshold', async () => {
    const page = cloneRaster(BLANK.raster)
    drawTick(page, BLANK.regions['tick-3'])

    const strict = await compareRegions(BLANK.raster, page, [
      { id: 'tick-3', rect: BLANK.regions['tick-3'], threshold: 0.9 },
    ])
    const lenient = await compareRegions(BLANK.raster, page, [
      { id: 'tick-3', rect: BLANK.regions['tick-3'], threshold: 0.01 },
    ])

    expect(strict[0].filled).toBe(false)
    expect(lenient[0].filled).toBe(true)
  })

  it('clamps a region that hangs off the page', async () => {
    const [report] = await compareRegions(BLANK.raster, BLANK.raster, [
      { id: 'edge', rect: { x: -50, y: -50, width: 80, height: 80 } },
    ])

    expect(report.added).toBe(0)
    expect(Number.isFinite(report.originalInk)).toBe(true)
  })

  it('returns zeros for a region entirely off the page', async () => {
    const [report] = await compareRegions(BLANK.raster, BLANK.raster, [
      { id: 'gone', rect: { x: 9000, y: 9000, width: 10, height: 10 } },
    ])

    expect(report).toMatchObject({ added: 0, removed: 0, filled: false, score: 0 })
  })

  it('refuses two images on different canvases, because the coordinates would be lies', async () => {
    await expect(compareRegions(BLANK.raster, createRaster(100, 100), REGIONS)).rejects.toThrow(/same canvas/)
  })

  it('reports removed ink when the scan lost something the original had', async () => {
    const erased = cloneRaster(BLANK.raster)
    const box = BLANK.regions.signature
    for (let y = box.y; y < box.y + box.height; y++)
      for (let x = box.x; x < box.x + box.width; x++) {
        const i = (Math.round(y) * erased.width + Math.round(x)) * 4
        erased.data[i] = 255
        erased.data[i + 1] = 255
        erased.data[i + 2] = 255
      }

    const [report] = await compareRegions(BLANK.raster, erased, [{ id: 'signature', rect: box }])

    expect(report.removed).toBeGreaterThan(0)
    expect(report.added).toBeCloseTo(0, 4)
  })
})

describe('diffDocument', () => {
  it('summarises the page and the regions in one pass', async () => {
    const diff = await diffDocument(BLANK.raster, filledForm(), REGIONS)

    expect(diff.added).toBeGreaterThan(0)
    expect(diff.regions).toHaveLength(4)
    expect(diff.regions.find(r => r.id === 'signature')?.filled).toBe(true)
  })

  it('reports nothing changed for an identical pair', async () => {
    const diff = await diffDocument(BLANK.raster, BLANK.raster)

    expect(diff.added).toBeCloseTo(0, 5)
    expect(diff.removed).toBeCloseTo(0, 5)
    expect(diff.regions).toHaveLength(0)
  })
})
