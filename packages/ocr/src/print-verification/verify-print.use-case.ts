import { resizeGray } from '@scanmate/ink'
import type { GrayImage, TextRun } from '@scanmate/ink'

import { placeGlyphs } from './glyph-cells.use-case'
import { cut, templateKey } from './glyph-templates.use-case'
import type { Templates } from './glyph-templates.use-case'
import { printPolarity } from './print-polarity.policy'

/**
 * Whether a printed figure is still the figure that was printed, decided by
 * matching its ink rather than by reading it.
 *
 * OCR asks an open question - what does this say? - and at the resolution of a
 * returned scan it answers badly: a 0 on a shaded bar at 120 dpi comes back as
 * a 9, and a digit written over another comes back as whatever the language
 * model prefers. The closed question is far easier: is this still the glyph the
 * original printed here, or does it look more like a different one?
 *
 * The print is crisp and the scan is not, so the print is first softened to the
 * scan's own sharpness - the amount that makes the scan's glyphs sit best on
 * the original's, measured on the run itself - and every glyph is compared at
 * that sharpness. Without it a blurred 0 matches a crisp 8 as well as it
 * matches a crisp 0.
 *
 * Each character of a figure is matched twice over. Once against the original's
 * own ink at that very place - same face, same size, same position, so a scan
 * of it correlates highly however grey or grainy it is - and once against every
 * other character the page prints in that face and size. The printed glyph has
 * to win by a margin to pass, and a rival has to win by a margin to count as a
 * change; anything in between is left undecided rather than guessed at.
 *
 * A run whose glyphs cannot be told apart is left to the reading, and so is a
 * run on a page that prints too few characters in that face for the rivals to
 * be represented - a glyph whose own template is missing could otherwise be
 * confirmed as the one it replaced, simply for lacking anything better to
 * match.
 *
 * **Two scopes.** `'figures'` checks the digits of a figure against the ten
 * digits, and nothing else: a full stop read as a comma is how a figure is
 * written, not what it says. It is cheap enough to run over every printed run
 * of a page, which is how a changed amount is caught even when the reading
 * never noticed.
 *
 * `'text'` checks every character against letters and digits alike. The rival
 * set is six times larger and the work grows with it, so this is not for a
 * whole page - it is for one run somebody is already arguing about, where the
 * reading disagrees and the ink at that run says nothing moved. There it
 * answers the question the reading could not: are these the same glyphs?
 *
 * Its two answers are not worth the same. Swept over 327 runs of four real
 * documents, `'text'` called four unchanged runs changed - a `t` read as a `k`,
 * a `g` as a `t` - where `'figures'` has never made a false call on any scan
 * measured here. Letters at 8 pt through a scanner are simply more confusable
 * than digits, and the margin that separates the ten does not separate the
 * sixty-two. So `agrees === true` is good evidence that a run is untouched, and
 * `agrees === false` is a reason to look closer rather than a verdict; callers
 * are expected to use it to clear a dispute, not to open one.
 */

/** What a figure's characters are checked against: the ten digits, and only those. */
export const FIGURE_CHARACTERS = '0123456789'
/**
 * What a run of text is checked against, under `scope: 'text'`: letters and
 * digits. Punctuation is left out deliberately - a comma and a full stop differ
 * by a few pixels at these sizes, and telling them apart is neither reliable
 * nor worth reporting.
 */
export const TEXT_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
/**
 * How much better the winner must correlate than the runner-up for the cell to
 * be decided either way.
 *
 * Measured on real returned scans, matching every printed digit of pages 1 and
 * 2 against the ten the page prints: on a genuine scan the printed glyph wins
 * by 0.13 or more at 125 dpi, and where a badly scanned digit loses at 90 dpi
 * it loses by 0.03 or less. A digit replaced by another - the same ink, a few
 * points along - was won by its rival by 0.17.
 */
const MIN_MARGIN = 0.12
/** A rival has to match this well before it can overturn what the original prints. */
const MIN_SCORE = 0.5
/**
 * ...and the printed glyph has to match at least this well before the ink can be
 * called unchanged. A digit that genuinely changed may still beat the rivals the
 * page happens to print, and confirming it on that basis would be the one error
 * this check must never make.
 */
const MIN_PRINTED_SCORE = 0.7
/**
 * Distinct characters the page must print in this face and size before a run is
 * checked at all. Fewer than this and the character actually on the scan may
 * have no template to win with, which turns a change into a confirmation.
 *
 * Eight of the ten digits for a figure. For text the alphabet is far larger and
 * no page prints all of it, so the bar is what a page of ordinary prose prints
 * comfortably and a lone heading in a display face does not.
 */
const MIN_RIVALS = 8
const MIN_TEXT_RIVALS = 24
/** ...and the printed glyph has to match no better than this: a near-perfect match is not a forgery. */
const MAX_PRINTED_SCORE = 0.85
/**
 * Each cell is matched at this height, in pixels: the shape of a digit survives,
 * the scanner's grain does not.
 */
const MATCH_HEIGHT = 16
/** The template is slid this far, in match pixels, to absorb a cell landing half a pixel out. */
const SHIFT = 1
/** How much the print may be softened by to meet the scan, in match pixels. */
const SOFTENING = [0, 0.5, 1, 1.5, 2] as const

export interface VerifyOptions {
  /** How far the winner must correlate ahead of the loser, `0` to `1`. Default `0.12`. */
  minMargin?:  number
  /** How well a rival must match before a character counts as changed. Default `0.5`. */
  minScore?:   number
  /** How well the printed glyph must match before the ink counts as unchanged. Default `0.7`. */
  minPrinted?: number
  /** Characters the page must print in this face and size for the run to be checked. Default `8`, or `24` for text. */
  minRivals?:  number
  /**
   * What to check: the digits of a figure (`'figures'`, the default, cheap
   * enough for a whole page), or every letter and digit of the run (`'text'`,
   * for a single run under dispute).
   */
  scope?:      'figures' | 'text'
  /** How badly the printed glyph must match for a character to count as changed. Default `0.85`. */
  maxPrinted?: number
  /** Digits in a row before a group is treated as a figure. Default `2`. */
  minDigits?:  number
  /** The characters a figure's glyphs are matched against. Default {@link FIGURE_CHARACTERS}. */
  characters?: string
}

/** One character of a figure, and how its ink matched. */
export interface CellVerification {
  /** Position in the run's text. */
  at:           number
  /** What the original prints there. */
  printed:      string
  /** How well the scan's ink matches the original's own ink there. */
  printedScore: number
  /** The best any other character managed. */
  rival:        string
  rivalScore:   number
  /** What this cell was taken to be, or `null` when it was too close to call. */
  read:         string | null
}

export interface PrintVerification {
  /** The run as its ink reads, printed characters kept where nothing was checked. */
  reading:    string
  /** The ink says what the original printed. */
  agrees:     boolean
  /** Cells decided, one way or the other. */
  checked:    number
  /** The smallest margin any decided cell was decided by. */
  confidence: number
  /** Every character checked, with the scores behind the verdict. */
  cells:      CellVerification[]
}

/**
 * Checks the figures of one run against the original's print.
 *
 * @param original - The original page, greyscale.
 * @param scan - The scan, aligned onto the original's canvas, greyscale.
 * @param dpi - What the original was rendered at.
 * @param run - The run to check, from the original's text layer.
 * @param templates - Glyphs collected from the original by `collectTemplates`.
 * @param options - Margin, figure length and the characters figures use.
 * @returns What the ink says, or `null` when the run could not be checked.
 */
export function verifyPrintedRun (
  original: GrayImage,
  scan: GrayImage,
  dpi: number,
  run: TextRun,
  templates: Templates,
  options: VerifyOptions = {},
): PrintVerification | null {
  const {
    scope = 'figures',
    minMargin = MIN_MARGIN,
    minScore = MIN_SCORE,
    maxPrinted = MAX_PRINTED_SCORE,
    minPrinted = MIN_PRINTED_SCORE,
    minRivals = scope === 'text' ? MIN_TEXT_RIVALS : MIN_RIVALS,
    minDigits = 2,
    characters = scope === 'text' ? TEXT_CHARACTERS : FIGURE_CHARACTERS,
  } = options
  const printed = [...run.text].filter(character => character.trim() !== '')
  const wanted = scope === 'text' ? textCells(printed, characters) : figureCells(printed, minDigits)
  if (wanted.size === 0) return null

  // A total on a shaded bar is printed light on dark; turned round, it is a figure like any other.
  const lightOnDark = printPolarity(original, dpi, run) === 'light-on-dark'
  const cells = placeGlyphs(original, dpi, run, run.text, { lightOnDark })
  if (cells === null) return null

  // Rivals: every character the page prints in this face and size that a figure could use.
  const rivals = [...characters].filter(character => templates.has(templateKey(run, character)))
  if (rivals.length < minRivals) return null

  // How soft this scan's print is, measured where the answer is known: each cell
  // against the very glyph the original prints there.
  const pairs = [...wanted]
    .flatMap((index) => {
      const cell = cells[index]

      return cell === null ? [] : [{ glyph: cut(scan, dpi, cell, lightOnDark), printed: cut(original, dpi, cell, lightOnDark) }]
    })
    .filter((pair): pair is { glyph: GrayImage, printed: GrayImage } => pair.glyph !== null && pair.printed !== null)
  const softening = softeningFor(pairs)

  const reading = [...printed]
  const scored: CellVerification[] = []
  let confidence = 1
  let checked = 0

  for (const index of wanted) {
    // The cell exactly: a margin would bring in the neighbouring glyphs, which
    // both crops share, and shared ink correlates whatever the character is.
    const cell = cells[index]
    if (cell === null) continue
    const glyph = cut(scan, dpi, cell, lightOnDark)
    // The original's own ink here: the same glyph, at the same size, in the same place.
    const asPrinted = cut(original, dpi, cell, lightOnDark)
    if (glyph === null || asPrinted === null) continue

    const printedScore = correlate(glyph, asPrinted, softening)
    const others = rivals
      .filter(character => character !== printed[index])
      .map(character => ({ character, score: bestMatch(glyph, templates.get(templateKey(run, character)) ?? [], softening) }))
      .toSorted((a, b) => b.score - a.score)
    const rival = others[0]
    if (rival === undefined) continue

    // Undecided unless one of the two wins clearly, and a change has to look like
    // the character it is being read as, not merely less like the printed one.
    const changed = rival.score >= printedScore + minMargin && rival.score >= minScore && printedScore <= maxPrinted
    const unchanged = printedScore >= rival.score + minMargin && printedScore >= minPrinted
    scored.push({
      at:         index,
      printed:    printed[index],
      printedScore,
      rival:      rival.character,
      rivalScore: rival.score,
      read:       changed ? rival.character : (unchanged ? printed[index] : null),
    })
    if (!changed && !unchanged) continue

    checked++
    if (changed) reading[index] = rival.character
    confidence = Math.min(confidence, Math.abs(printedScore - rival.score))
  }

  // Nothing decided is not an answer: say nothing rather than guess a digit.
  if (checked === 0) return null

  // Put the spaces back, so the reading reads like the run it is about.
  let cell = 0
  const text = [...run.text].map(character => (character.trim() === '' ? character : reading[cell++])).join('')

  return { reading: text, agrees: text === run.text, checked, confidence, cells: scored }
}

/**
 * The digits of every figure of at least `minDigits` digits.
 *
 * Only digits: a full stop read as a comma is how a figure is written, not what
 * it says, and at the size these are printed the two are a pixel apart.
 */
/** Every cell the character set covers: under `'text'`, the letters and digits of the run. */
function textCells (printed: readonly string[], characters: string): Set<number> {
  const wanted = new Set<number>()
  for (const [index, character] of printed.entries()) if (characters.includes(character)) wanted.add(index)

  return wanted
}

function figureCells (printed: readonly string[], minDigits: number): Set<number> {
  const wanted = new Set<number>()
  let group: number[] = []

  const close = (): void => {
    if (group.length >= minDigits) for (const index of group) wanted.add(index)
    group = []
  }

  for (const [index, character] of printed.entries()) {
    if (/\d/.test(character)) group.push(index)
    // A separator inside a figure carries on the group; anything else ends it.
    else if (!/[.,\-/\s]/.test(character) || group.length === 0) close()
  }
  close()

  return wanted
}

/** How soft the print has to be drawn to sit best on the scan's own glyphs. */
function softeningFor (pairs: readonly { glyph: GrayImage, printed: GrayImage }[]): number {
  let best: { softening: number, score: number } = { softening: 0, score: -Infinity }
  for (const softening of SOFTENING) {
    const score = pairs.reduce((sum, pair) => sum + correlate(pair.glyph, pair.printed, softening), 0)
    if (score > best.score) best = { softening, score }
  }

  return best.softening
}

/** The best correlation between one glyph and a character's templates. */
function bestMatch (glyph: GrayImage, templates: readonly GrayImage[], softening: number): number {
  let best = -1
  for (const template of templates) best = Math.max(best, correlate(glyph, template, softening))

  return best
}

/**
 * How alike two glyphs are, each scaled to the same small box, and the template
 * slid a pixel each way to allow for a cell that landed a fraction out.
 *
 * Correlation, rather than a difference of pixels, because a scan is darker or
 * lighter than the print it came from and that must not decide anything.
 */
function correlate (glyph: GrayImage, template: GrayImage, softening = 0): number {
  const height = MATCH_HEIGHT
  const width = Math.max(2, Math.round(height * ((glyph.width / glyph.height + template.width / template.height) / 2)))
  const a = resizeGray(glyph, width, height)
  const b = soften(resizeGray(template, width, height), softening)

  let best = -1
  for (let dy = -SHIFT; dy <= SHIFT; dy++)
    for (let dx = -SHIFT; dx <= SHIFT; dx++) best = Math.max(best, pearson(a, b, dx, dy))

  return best
}

/** A Gaussian blur of `sigma` match pixels, which is how print looks once it has been scanned. */
function soften (image: GrayImage, sigma: number): GrayImage {
  if (sigma <= 0) return image

  const radius = Math.max(1, Math.ceil(sigma * 2))
  const kernel: number[] = []
  for (let i = -radius; i <= radius; i++) kernel.push(Math.exp(-(i * i) / (2 * sigma * sigma)))
  const total = kernel.reduce((a, b) => a + b, 0)
  const weights = kernel.map(value => value / total)

  const { width, height } = image
  const horizontal = new Float32Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (const [k, weight] of weights.entries()) {
        const sx = Math.min(width - 1, Math.max(0, x + k - radius))
        sum += image.data[y * width + sx] * weight
      }
      horizontal[y * width + x] = sum
    }

  const data = new Float32Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (const [k, weight] of weights.entries()) {
        const sy = Math.min(height - 1, Math.max(0, y + k - radius))
        sum += horizontal[sy * width + x] * weight
      }
      data[y * width + x] = sum
    }

  return { width, height, data }
}

/** Pearson correlation of two images of one size, the second shifted by `dx`, `dy`. */
function pearson (a: GrayImage, b: GrayImage, dx: number, dy: number): number {
  let count = 0
  let sumA = 0
  let sumB = 0
  for (let y = Math.max(0, -dy); y < Math.min(a.height, a.height - dy); y++)
    for (let x = Math.max(0, -dx); x < Math.min(a.width, a.width - dx); x++) {
      sumA += a.data[y * a.width + x]
      sumB += b.data[(y + dy) * b.width + x + dx]
      count++
    }
  if (count === 0) return 0

  const meanA = sumA / count
  const meanB = sumB / count
  let covariance = 0
  let varianceA = 0
  let varianceB = 0
  for (let y = Math.max(0, -dy); y < Math.min(a.height, a.height - dy); y++)
    for (let x = Math.max(0, -dx); x < Math.min(a.width, a.width - dx); x++) {
      const da = a.data[y * a.width + x] - meanA
      const db = b.data[(y + dy) * b.width + x + dx] - meanB
      covariance += da * db
      varianceA += da * da
      varianceB += db * db
    }
  const spread = Math.sqrt(varianceA * varianceB)

  return spread === 0 ? 0 : covariance / spread
}
