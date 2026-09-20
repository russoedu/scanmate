import type { GrayImage, ScanmateOrientedRect, TextRun } from '@scanmate/ink'

import { placeGlyphs } from './glyph-cells.use-case'
import { printPolarity } from './print-polarity.policy'

/**
 * What each character looks like in print, taken from the original itself.
 *
 * The original is the only place a rival glyph can honestly come from: it is
 * the document's own face, at the document's own size, rendered by whatever
 * rendered the page. Every run whose characters can be told apart contributes
 * its glyphs, filed by face and size, and a run is then verified against the
 * ones that share its face and size. A run printed light on a dark bar is
 * turned dark on light first, so a figure on a shaded total line is matched
 * against the same digits as one on paper. Nothing is rendered, no font is embedded,
 * and a face the page never prints has no templates - so nothing is claimed
 * about it.
 */

/** A run of the original's text layer, where it sits and how it is set. */

/** Glyph images by face, size and character. */
export type Templates = ReadonlyMap<string, GrayImage[]>

/** A store still being filled. Readers take {@link Templates}; only the collector writes. */
export type TemplateStore = Map<string, GrayImage[]>

/** Most glyphs kept per character - more is slower and adds nothing. */
const PER_CHARACTER = 4

/** The key a run's glyphs are filed under. */
export function templateKey (run: TextRun, character: string): string {
  // The turn belongs in the key: a glyph printed up the margin and the same
  // glyph printed across the page are different pictures, and matching one
  // against the other would compare a letter with its own rotation.
  const turn = ((Math.round((run.angle ?? 0) / 90) % 4) + 4) % 4

  return `${run.fontName ?? ''}|${Math.round((run.fontSize ?? run.height) * 2) / 2}|${turn}|${character}`
}

/**
 * Collects a glyph image for every character the page prints and can place.
 *
 * @param page - The original page, greyscale.
 * @param dpi - What it was rendered at.
 * @param runs - Its text layer.
 * @returns Glyph images, by {@link templateKey}.
 */
/**
 * Folds one page's glyphs into a store that already holds others.
 *
 * Templates are filed by face, size and turn, and a PDF renders those
 * identically wherever they appear - so a glyph from page 4 is as good a
 * template as one from page 1, and on many documents it is the only one there
 * is. Measured on a real order confirmation: the face its page-1 total is set
 * in carries six distinct digits on that page and nine across the document, and
 * six is below the bar for checking anything at all.
 *
 * The per-character cap applies to the store as a whole, so a long document
 * costs no more memory than a short one.
 */
export function collectInto (templates: TemplateStore, page: GrayImage, dpi: number, runs: readonly TextRun[]): Templates {
  for (const run of runs) {
    const characters = [...run.text].filter(character => character.trim() !== '')
    const lightOnDark = printPolarity(page, dpi, run) === 'light-on-dark'
    const cells = placeGlyphs(page, dpi, run, run.text, { lightOnDark })
    if (cells === null) continue

    for (const [index, character] of characters.entries()) {
      const cell = cells[index]
      if (cell !== null) keep(templates, templateKey(run, character), cut(page, dpi, cell, lightOnDark))
    }
  }

  return templates
}

export function collectTemplates (page: GrayImage, dpi: number, runs: readonly TextRun[]): Templates {
  return collectInto(new Map(), page, dpi, runs)
}

/** Files one glyph under its key, up to the few that are worth keeping. */
function keep (templates: Map<string, GrayImage[]>, key: string, glyph: GrayImage | null): void {
  if (glyph === null) return
  const kept = templates.get(key) ?? []
  if (kept.length >= PER_CHARACTER) return

  kept.push(glyph)
  templates.set(key, kept)
}

/**
 * The greyscale of one box of the page, or `null` when it lies outside it;
 * inverted when the run it belongs to is printed light on dark.
 */
export function cut (page: GrayImage, dpi: number, box: ScanmateOrientedRect, invert = false): GrayImage | null {
  const s = dpi / 72
  const left = Math.max(0, Math.floor(box.x * s))
  const top = Math.max(0, Math.floor(box.y * s))
  const right = Math.min(page.width, Math.ceil((box.x + box.width) * s))
  const bottom = Math.min(page.height, Math.ceil((box.y + box.height) * s))
  const width = right - left
  const height = bottom - top
  if (width < 1 || height < 1) return null

  const data = new Float32Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const value = page.data[(top + y) * page.width + left + x]
      data[y * width + x] = invert ? 1 - value : value
    }

  return { width, height, data }
}
