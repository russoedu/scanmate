import type { AlignedPage } from '@scanmate/ink'

import type { EnhancedPage, EnhancePagesOptions } from './enhance-result.contract'
import { enhanceScan } from './enhance-scan.use-case'

/**
 * The pipeline stage: every aligned page with a cleaned copy alongside.
 *
 * The cleaned image is the image it came from, enlarged to `targetDpi` (300)
 * when below it. With the default `source: 'aligned'` that is still the
 * original's canvas, at a finer grid: a region in points lands at
 * `points * dpi / 72`. Pages run one after another; each reports a `start` and a
 * `done` event carrying what the `'auto'` settings resolved to.
 */
export async function enhancePages<Page extends AlignedPage> (
  pages: readonly Page[],
  options: EnhancePagesOptions = {},
): Promise<Array<EnhancedPage<Page>>> {
  const { source = 'aligned', onProgress, ...enhance } = options
  const results: Array<EnhancedPage<Page>> = []

  for (const [position, page] of pages.entries()) {
    const index = position + 1
    const started = Date.now()
    onProgress?.({ stage: 'enhance', phase: 'start', page: page.page, index, total: pages.length })

    const raster = source === 'aligned' ? page.aligned.raster : page.scanned.raster
    const dpi = source === 'aligned' ? page.original.dpi : page.scanned.dpi
    const result = await enhanceScan(raster, { ...enhance, dpi })
    results.push({ ...page, enhanced: result })

    onProgress?.({
      stage:      'enhance',
      phase:      'done',
      page:       page.page,
      index,
      total:      pages.length,
      durationMs: Date.now() - started,
      detail:     { ...result.applied, dpi: result.dpi, scale: result.scale },
    })
  }

  return results
}
