import type { EnhancePagesOptions } from '../scan-enhancement'

/**
 * The ways a page can be made readable, in the order they are tried.
 *
 * There is deliberately no default among these, because measurement says there
 * cannot be one. Three scans of the same order confirmation, each scored by
 * what the reading agreed with:
 *
 * | scan | as scanned | levelled | levelled and sharpened |
 * |---|---|---|---|
 * | 93 dpi | 0.6603 | 0.6485 | **0.8047** |
 * | 120 dpi | **0.9362** | 0.9220 | 0.9222 |
 * | 144 dpi | 0.9968 | **0.9984** | 0.9848 |
 *
 * Three documents, three different winners. Sharpening rescues a soft scan -
 * a 39% fall in character error rate on the 93 dpi one - and costs a good scan
 * about a point, so applying it to everything would help one caller and hurt
 * two. Hence a choice, made per document, against that document's own original.
 */
export interface Recipe {
  /** What this does, for `preparation.chosen` and for a progress event. */
  id:      'as-scanned' | 'levelled' | 'levelled-sharpened'
  /** `null` reads the aligned page as it is. */
  enhance: Omit<EnhancePagesOptions, 'onProgress'> | null
}

/**
 * The radius, as a share of how far the page is enlarged.
 *
 * Sharpening happens after the page is taken to the reading resolution, so a
 * stroke is as many times wider as the page was enlarged, and the radius has
 * to follow. Measured on the 93 dpi scan, enlarged 3.2 times: a radius of 0.6
 * changed the reading not at all, 2 gained 0.025, 4 gained 0.188 and 6 gave
 * most of it back. The optimum tracked the enlargement rather than the page.
 */
const RADIUS_PER_ENLARGEMENT = 1.24

export function recipesFor (dpi: number | null, targetDpi: number | null): Recipe[] {
  const enlargement = dpi === null || targetDpi === null || dpi >= targetDpi ? 1 : targetDpi / dpi
  const sigma = RADIUS_PER_ENLARGEMENT * enlargement

  return [
    { id: 'as-scanned', enhance: null },
    { id: 'levelled', enhance: { output: 'none', sharpen: false } },
    { id: 'levelled-sharpened', enhance: { output: 'none', sharpen: { sigma, amount: 1.5 } } },
  ]
}
