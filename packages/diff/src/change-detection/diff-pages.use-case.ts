import { encodeImage } from '@scanmate/ink'
import type { AlignedPage, BinaryImage, Rect } from '@scanmate/ink'

import { buildMasks, measureRegion, paintOverlay } from '../region-comparison'
import type { Masks } from '../region-comparison'
import { annotateOverlay, EXPECTED_MARGIN, IDENTIFIED, MISSING, NOT_IDENTIFIED, REFERENCE, UNEXPECTED } from './annotate-overlay.use-case'
import type { Annotation } from './annotate-overlay.use-case'
import { connectedComponents } from './connected-components.use-case'
import { mergeBoxes } from './merge-boxes.use-case'
import type { MergedBox } from './merge-boxes.use-case'
import { probeInk } from './probe-ink.use-case'
import type { Change, DiffOptions, ExpectedChange, ExpectedResult, InkProbe, PageDiff } from './page-diff.contract'
import { measureRegionInk } from './region-ink.use-case'
import { composeSideBySide } from './side-by-side.use-case'

/**
 * What changed on each page, and whether it was supposed to.
 *
 * The overlay is the detection: the original's ink, fattened by a tolerance band,
 * subtracted from the aligned scan, leaves the ink the scan added. What this adds
 * is the reporting. What changed is grouped into changes - labelled, merged
 * across small gaps, filtered below a physical size. A change whose ink lies
 * mostly in an expected region belongs to that region; every other change is
 * unexpected. Each region is also analysed on its own - its new ink grouped,
 * its printed rules discarded, the rest measured - and is identified once that
 * ink adds up to `minFillArea` without covering more than `maxFill` of it. The
 * same grouping is done for ink the scan lost.
 *
 * Masks are built once per page and read four ways: the overlay, the expected
 * regions, the added changes and the missing ones.
 */
export async function diffPages (
  pages: readonly AlignedPage[],
  expected: readonly ExpectedChange[] = [],
  options: DiffOptions = {},
): Promise<PageDiff[]> {
  const { onProgress } = options
  const results: PageDiff[] = []

  for (const [position, page] of pages.entries()) {
    const index = position + 1
    const started = Date.now()
    onProgress?.({ stage: 'diff', phase: 'start', page: page.page, index, total: pages.length })

    const result = await diffPage(page, expected.filter(e => e.page === page.page), {
      ...options,
      probes: (options.probes ?? []).filter(probe => probe.page === undefined || probe.page === page.page),
    })
    results.push(result)

    onProgress?.({
      stage:      'diff',
      phase:      'done',
      page:       page.page,
      index,
      total:      pages.length,
      durationMs: Date.now() - started,
      detail:     { ...result.summary, truncated: result.truncated },
    })
  }

  return results
}

/** One page. `expected` should already be the regions for this page. */
export async function diffPage (
  page: AlignedPage,
  expected: readonly ExpectedChange[] = [],
  options: DiffOptions = {},
): Promise<PageDiff> {
  const {
    units = 'points',
    tolerance = 2,
    minFillArea = 2,
    maxFill = 0.5,
    formLineSpan = 0.9,
    formLineThickness = 0.6,
    minChangeArea = 1,
    minMissingArea = 4,
    faintInk,
    mergeGap = 3,
    assumeDpi = 150,
    regionOverlap = 0.5,
    expectedMargin = 6,
    maxChanges = 50,
    probes = [],
    keepMasks = false,
    output = 'png',
    annotate = false,
    sideBySide = false,
    ink,
  } = options

  const dpi = page.original.dpi ?? assumeDpi
  const toPixels = units === 'points' ? dpi / 72 : 1
  const pixelsPerMm = dpi / 25.4
  const mm2PerPixel = 1 / (pixelsPerMm * pixelsPerMm)

  const masks = await buildMasks(page.original.raster, page.aligned.raster, ink, tolerance, faintInk)

  // People sign past the box they are given, so each region claims the ink a little
  // way outside it too; what it reports is still the region it was given.
  const regions = expected.map(e => ({ id: e.id, rect: scaleRect(e, toPixels), claim: scaleRect(grow(e, expectedMargin), toPixels) }))

  const findChanges = (mask: BinaryImage, minArea: number): MergedBox[] => {
    const components = connectedComponents(mask).filter(c => c.pixels >= 2)
    const merged = mergeBoxes(components, Math.round(mergeGap * pixelsPerMm))

    return merged
      .filter(box => box.pixels * mm2PerPixel >= minArea)
      .toSorted((a, b) => b.pixels - a.pixels)
  }

  const addedMask = difference(masks.scan, masks.originalDilated)
  const added = findChanges(addedMask, minChangeArea)
  // Taken together, since one stroke can run through two fields at once.
  const outside = added.filter(box => inkShareInside(box, regions.map(r => r.claim), masks) < regionOverlap)
  const lost = findChanges(difference(masks.original, masks.scanDilated), minMissingArea)

  const expectedResults: ExpectedResult[] = regions.map((region, i) => {
    const measured = measureRegionInk(addedMask, region.claim, {
      mergeGap:           Math.round(mergeGap * pixelsPerMm),
      minChangePixels:    minChangeArea / mm2PerPixel,
      lineSpan:           formLineSpan,
      lineThickness:      formLineThickness * pixelsPerMm,
      lineThicknessRatio: 0.04,
      edgeBand:           0.03,
    })
    const addedInk = measured.pixels * mm2PerPixel
    const overfilled = measured.fill > maxFill
    const { removed } = measureRegion(region, masks, 0)
    const bounds = measured.bounds && scaleRect(measured.bounds, 1 / toPixels)

    return {
      id:         region.id,
      identified: addedInk >= minFillArea && !overfilled,
      x:          expected[i].x,
      y:          expected[i].y,
      width:      expected[i].width,
      height:     expected[i].height,
      addedInk,
      removedInk: removed * pixelArea(region.rect, masks) * mm2PerPixel,
      score:      minFillArea > 0 ? Math.min(1, addedInk / minFillArea) : 1,
      overfilled,
      ink:        {
        changes:     measured.changes,
        largestArea: measured.largest * mm2PerPixel,
        bounds,
        widthRatio:  bounds ? bounds.width / expected[i].width : 0,
        heightRatio: bounds ? bounds.height / expected[i].height : 0,
        edgeTouch:   measured.edgeTouch,
        fill:        measured.fill,
        formLines:   measured.formLines,
      },
    }
  })

  // What the ink does where the caller asked, changed or not.
  const measured: InkProbe[] = probeInk(masks, probes, { dpi, units })

  const truncated = outside.length > maxChanges || lost.length > maxChanges
  const toChange = (box: MergedBox): Change => ({
    x:       box.x / toPixels,
    y:       box.y / toPixels,
    width:   box.width / toPixels,
    height:  box.height / toPixels,
    inkArea: box.pixels * mm2PerPixel,
    pixels:  box.pixels,
  })
  const unexpected = outside.slice(0, maxChanges).map(box => toChange(box))
  const missing = lost.slice(0, maxChanges).map(box => toChange(box))

  // The band first, so a region's own outline draws over it where they meet.
  const margins: Annotation[] = expectedMargin > 0 ? regions.map(region => ({ rect: region.claim, color: EXPECTED_MARGIN })) : []
  const verdicts: Annotation[] = regions.map((region, i) => ({
    rect:  grow(region.rect, 2),
    color: expectedResults[i].identified ? IDENTIFIED : NOT_IDENTIFIED,
  }))
  const reported: Annotation[] = [
    ...margins,
    ...verdicts,
    ...outside.slice(0, maxChanges).map(box => ({ rect: grow(box, 4), color: UNEXPECTED })),
  ]
  // On the original, every region is simply the area in question; the answers belong to the scan.
  const asAsked: Annotation[] = regions.map(region => ({ rect: grow(region.rect, 2), color: REFERENCE }))

  const diffRaster = paintOverlay(masks)
  if (annotate) annotateOverlay(diffRaster, reported)

  // Lines about a point thick at any dpi, so the boxes read the same on every page.
  const losses: Annotation[] = lost.slice(0, maxChanges).map(box => ({ rect: grow(box, 4), color: MISSING }))
  const sideBySideRaster = sideBySide
    ? composeSideBySide(page.original.raster, page.aligned.raster, {
        // Left: where the questions are, and the ink the scan lost, which is the original's.
        original: [...asAsked, ...losses],
        // Right: the answers.
        scanned:  [...reported, ...losses],
      }, Math.max(2, Math.round(dpi / 72)), Math.max(4, Math.round(dpi / 12)))
    : null

  const whole = measureRegion({ id: '__page__', rect: { x: 0, y: 0, width: masks.width, height: masks.height } }, masks, 0)
  const identified = expectedResults.filter(r => r.identified).length

  return {
    page:            page.page,
    diffRaster,
    diffImage:       output === 'none' ? null : await encodeImage(diffRaster, { format: output }),
    sideBySideRaster,
    sideBySideImage: sideBySideRaster === null || output === 'none' ? null : await encodeImage(sideBySideRaster, { format: output }),
    expected:        expectedResults,
    probes:          measured,
    masks:           keepMasks ? masks : null,
    unexpected,
    missing,
    truncated,
    summary:         {
      addedInk:      whole.added,
      removedInk:    whole.removed,
      identified,
      notIdentified: expectedResults.length - identified,
      unexpected:    unexpected.length,
      missing:       missing.length,
    },
  }
}

/** Set where `a` is set and `b` is not. */
function difference (a: BinaryImage, b: BinaryImage): BinaryImage {
  const data = new Uint8Array(a.data.length)
  for (let p = 0; p < data.length; p++) data[p] = a.data[p] === 1 && b.data[p] === 0 ? 1 : 0

  return { width: a.width, height: a.height, data }
}

/**
 * Share of a change's new ink that falls inside a region.
 *
 * Measured on ink, not on box area: a signature that overflows its box by a
 * flourish is still mostly inside it, while its bounding box may not be.
 */
function inkShareInside (box: MergedBox, regions: readonly Rect[], masks: Masks): number {
  let inside = 0
  const counted = new Set<number>()
  for (const region of regions) {
    const left = Math.max(box.x, Math.floor(region.x))
    const top = Math.max(box.y, Math.floor(region.y))
    const right = Math.min(box.x + box.width, Math.ceil(region.x + region.width))
    const bottom = Math.min(box.y + box.height, Math.ceil(region.y + region.height))
    if (right <= left || bottom <= top) continue

    for (let y = top; y < bottom; y++) {
      const row = y * masks.width
      for (let x = left; x < right; x++) {
        // Regions may overlap once grown, and a pixel belongs to the box only once.
        if (masks.scan.data[row + x] !== 1 || masks.originalDilated.data[row + x] !== 0 || counted.has(row + x)) continue
        counted.add(row + x)
        inside++
      }
    }
  }

  // The count here includes isolated pixels the component filter dropped from
  // box.pixels, so it can nudge past one.
  return box.pixels > 0 ? Math.min(1, inside / box.pixels) : 0
}

/** Pixels of a region that lie on the page - what `measureRegion`'s shares are shares of. */
function pixelArea (rect: Rect, masks: Masks): number {
  const width = Math.min(masks.width, Math.ceil(rect.x + rect.width)) - Math.max(0, Math.floor(rect.x))
  const height = Math.min(masks.height, Math.ceil(rect.y + rect.height)) - Math.max(0, Math.floor(rect.y))

  return Math.max(0, width) * Math.max(0, height)
}

function scaleRect (rect: Rect, factor: number): Rect {
  return { x: rect.x * factor, y: rect.y * factor, width: rect.width * factor, height: rect.height * factor }
}

function grow (rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, width: rect.width + 2 * by, height: rect.height + 2 * by }
}
