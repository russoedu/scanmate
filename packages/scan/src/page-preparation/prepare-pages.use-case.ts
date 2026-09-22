import type { OcrEngine, OcrOptions } from '@scanmate/ocr'
import type { ProgressCallback } from '@scanmate/ink'

import { loadEnhance, loadOcr } from '../stage-loading'
import { recipesFor } from './enhancement-recipes.policy'
import type { Recipe } from './enhancement-recipes.policy'
import type { AlignedScanmatePage, ReadableScanmatePage } from '../session-contract'

/** Pages the trial reads. Two is enough on the documents measured; three is the margin. */
const SAMPLE_PAGES = 3

export interface Preparation {
  /** Which recipe the document chose. */
  chosen: Recipe
  /** What each recipe scored on the page it was tried on, best first. */
  tried:  Array<{ id: Recipe['id'], score: number }>
  /** The pages the trial ran on. */
  on:     number[]
  /** The pages, prepared with the winner. */
  pages:  ReadableScanmatePage[]
}

/**
 * Reads one page three ways and keeps the treatment that agreed with the
 * original most.
 *
 * **Scored against the original's own text layer**, which is the whole reason
 * this is safe to do automatically. The comparison is a page-level score over
 * every run, and the choice is between three fixed treatments - about two bits
 * of freedom spread across millions of pixels. It cannot encode "make this
 * figure read as the original"; it can only decide whether the page as a whole
 * comes out sharper or softer. A per-run choice would be a different matter
 * entirely, and is deliberately not offered.
 *
 * It also cannot reach the evidence. `diffPages` and the glyph check read the
 * aligned page, never this one, so whatever is chosen here changes what the
 * reading proposes and never what the ink is measured against.
 *
 * A few pages, not one and not all. Softness is a property of the scan rather
 * than the page, so the whole document need not be tried - but one page is not
 * enough, and that is measured rather than assumed. On a 93 dpi scan where
 * sharpening wins the document by 0.14, page 2 is the single page where it
 * loses; on a 120 dpi scan where sharpening loses, page 1 is the single page
 * where levelling wins. Either would have chosen wrongly on its own. Any two
 * pages chose correctly on both, so three spread across the document is one
 * page of margin.
 */
export async function preparePages (
  pages: readonly AlignedScanmatePage[],
  options: {
    engine:      OcrEngine
    ocr?:        Omit<OcrOptions, 'onProgress' | 'engine'>
    onProgress?: ProgressCallback
  },
): Promise<Preparation> {
  const first = pages[0]
  if (first === undefined) return { chosen: { id: 'as-scanned', enhance: null }, tried: [], on: [], pages: [] }

  const sample = spread(pages, SAMPLE_PAGES)
  const recipes = recipesFor(first.original.dpi, options.ocr?.targetDpi ?? 300)
  const { ocrPages } = await loadOcr()
  const tried: Array<{ id: Recipe['id'], score: number }> = []

  for (const [index, recipe] of recipes.entries()) {
    const at = sample[0]?.page ?? first.page
    options.onProgress?.({ stage: 'enhance', phase: 'start', page: at, index: index + 1, total: recipes.length })
    const candidate = await applyRecipe(sample, recipe)
    // One call for the whole sample, so the score is weighted by how much each
    // page had to say rather than treating a sparse page as an equal vote.
    const { score } = await ocrPages(candidate, { ...options.ocr, engine: options.engine })
    tried.push({ id: recipe.id, score })
    options.onProgress?.({ stage: 'enhance', phase: 'done', page: at, index: index + 1, total: recipes.length, detail: { recipe: recipe.id, score } })
  }

  tried.sort((a, b) => b.score - a.score)
  const winner = recipes.find(recipe => recipe.id === tried[0]?.id) ?? recipes[0]

  return { chosen: winner, tried, on: sample.map(page => page.page), pages: await applyRecipe(pages, winner, options.onProgress) }
}

/** Up to `count` pages, spread across the document rather than taken from the front. */
function spread<Page> (pages: readonly Page[], count: number): Page[] {
  if (pages.length <= count) return [...pages]
  const step = (pages.length - 1) / (count - 1)

  return Array.from({ length: count }, (_, i) => pages[Math.round(i * step)])
}

/** The pages as that recipe would have them - the aligned pages themselves when it asks for nothing. */
export async function applyRecipe (
  pages: readonly AlignedScanmatePage[],
  recipe: Recipe,
  onProgress?: ProgressCallback,
): Promise<ReadableScanmatePage[]> {
  if (recipe.enhance === null) return [...pages]
  const { enhancePages } = await loadEnhance()

  return await enhancePages(pages, { ...recipe.enhance, onProgress })
}
