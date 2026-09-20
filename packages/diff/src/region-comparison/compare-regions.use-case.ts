import { coverage } from '@scanmate/ink'
import type { ScanmateSource, ScanmateRect } from '@scanmate/ink'
import { buildMasks } from './ink-masks.use-case'
import type { Masks } from './ink-masks.use-case'
import type { DocumentDiff, Region, RegionOptions, RegionReport } from './region.model'

/**
 * What changed, and where.
 *
 * Once the scan sits on the original's canvas, "was this box signed?" stops
 * being an image problem and becomes arithmetic: count the ink inside the
 * rectangle that is present in the scan and absent from the original.
 *
 * The one subtlety is the tolerance band. Alignment is good to a pixel or so,
 * never to zero, and printed text is mostly edges — so a half-pixel shift
 * lights up the outline of every character as "new ink". Dilating the
 * original's mask first (fattening every stroke by a couple of pixels) absorbs
 * that, the way a proofreader ignores a letter sitting a hair off the baseline.
 * What it cannot absorb is a signature, which is ink in places the original has
 * none.
 */

/**
 * Compare an aligned scan against its original over a set of known rectangles.
 *
 * `aligned` must be the output of `alignScan` - or anything else already on the
 * original's canvas. Feeding a raw scan in produces confident nonsense, because
 * every rectangle then names a different part of the page in each image.
 */
export async function compareRegions (
  original: ScanmateSource,
  aligned: ScanmateSource,
  regions: readonly Region[],
  options: RegionOptions = {},
): Promise<RegionReport[]> {
  const { tolerance = 2, threshold = 0.02, ink, faintInk } = options
  const masks = await buildMasks(original, aligned, ink, tolerance, faintInk)

  return regions.map(region => measureRegion(region, masks, threshold))
}

/** Page-wide added/removed ink, plus per-region detail for any regions supplied. */
export async function diffDocument (
  original: ScanmateSource,
  aligned: ScanmateSource,
  regions: readonly Region[] = [],
  options: RegionOptions = {},
): Promise<DocumentDiff> {
  const { tolerance = 2, threshold = 0.02, ink, faintInk } = options
  const masks = await buildMasks(original, aligned, ink, tolerance, faintInk)
  const full: ScanmateRect = { x: 0, y: 0, width: masks.width, height: masks.height }
  const whole = measureRegion({ id: '__document__', rect: full }, masks, threshold)

  return {
    added:   whole.added,
    removed: whole.removed,
    regions: regions.map(region => measureRegion(region, masks, threshold)),
  }
}

/** One region's added and removed ink, from masks already built. */
export function measureRegion (region: Region, masks: Masks, defaultThreshold: number): RegionReport {
  const { x, y, width, height } = region.rect
  const left = Math.max(0, Math.floor(x))
  const top = Math.max(0, Math.floor(y))
  const right = Math.min(masks.width, Math.ceil(x + width))
  const bottom = Math.min(masks.height, Math.ceil(y + height))

  if (right <= left || bottom <= top)
    return {
      id:          region.id,
      rect:        region.rect,
      originalInk: 0,
      scanInk:     0,
      added:       0,
      removed:     0,
      filled:      false,
      score:       0,
    }

  const threshold = region.threshold ?? defaultThreshold
  let added = 0
  let removed = 0
  for (let row = top; row < bottom; row++) {
    const offset = row * masks.width
    for (let column = left; column < right; column++) {
      const p = offset + column
      if (masks.scan.data[p] === 1 && masks.originalDilated.data[p] === 0) added++
      if (masks.original.data[p] === 1 && masks.scanDilated.data[p] === 0) removed++
    }
  }

  const area = (right - left) * (bottom - top)
  const addedRatio = added / area

  return {
    id:          region.id,
    rect:        region.rect,
    originalInk: coverage(masks.original, left, top, right, bottom),
    scanInk:     coverage(masks.scan, left, top, right, bottom),
    added:       addedRatio,
    removed:     removed / area,
    filled:      addedRatio >= threshold,
    score:       threshold > 0 ? Math.min(1, addedRatio / threshold) : 0,
  }
}
