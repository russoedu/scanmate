import type { GrayImage } from '@scanmate/ink'

import type { Box } from './glyph-cells.use-case'

/** Which way the original prints a run: dark text on light, or light text on a dark bar. */
export type PrintPolarity = 'dark-on-light' | 'light-on-dark'

/**
 * Which way the original prints a run, read off its own crisp rendering: the
 * glyphs are the pixels far from the background, and the background is most of
 * the box.
 */
export function printPolarity (page: GrayImage, dpi: number, run: Box): PrintPolarity {
  const s = dpi / 72
  const left = Math.max(0, Math.floor(run.x * s))
  const top = Math.max(0, Math.floor(run.y * s))
  const right = Math.min(page.width, Math.ceil((run.x + run.width) * s))
  const bottom = Math.min(page.height, Math.ceil((run.y + run.height) * s))
  const values: number[] = []
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) values.push(page.data[y * page.width + x])
  if (values.length === 0) return 'dark-on-light'

  const background = values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]
  const glyphs = values.filter(v => Math.abs(v - background) > 0.19)
  if (glyphs.length === 0) return 'dark-on-light'

  return glyphs.reduce((a, b) => a + b, 0) / glyphs.length > background ? 'light-on-dark' : 'dark-on-light'
}
