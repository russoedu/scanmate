import { normaliseText } from '../text-normalisation'
import type { NormaliseOptions } from '../text-normalisation'
import { levenshteinSimilarity } from '../text-similarity'
import type { PlacedText, TextDifference } from './ocr-report.contract'

/**
 * Put the scan's words back where the original printed them, then judge each
 * run of the original by what was read in its place.
 *
 * After alignment the scan sits on the original's canvas, so a word read at
 * some place belongs to the run of the original printed at that place. Each
 * word goes to the run whose box - grown a little, since OCR boxes hug ink and
 * alignment is good to a pixel or two - holds the word's centre; where boxes
 * overlap, the smallest wins. Words no run claims were added. Runs no word
 * reached are missing, and runs whose words read differently changed.
 *
 * Figures are held to a stricter standard than words. A run whose digits read
 * back differently has changed, however alike the rest is: "Total 1,250.00"
 * read as "Total 7,250.00" is 93% similar, and exactly the alteration a check
 * exists to catch. Words keep the fuzzy tolerance OCR needs.
 *
 * Nothing here depends on reading order, which is the point: a two-column
 * page read down one column and then the other is still matched run for run.
 */

export interface Reference extends PlacedText {
  endsLine?: boolean
}

export interface MatchOptions {
  normalise:         NormaliseOptions
  matchThreshold:    number
  minWordConfidence: number
}

/** Each run's reading, in the order of `references`, and the words no run claimed, grouped by line. */
export interface Claims {
  found: string[]
  added: PlacedText[][]
}

export interface WordMatch {
  /** The original's runs, each followed by what was read there, then added words. */
  alignedText:  string
  /** The original's runs in order, as one text. */
  expectedText: string
  differences:  TextDifference[]
}

/** How one run reads back: agreeing, or which difference it is. */
export type Verdict = { agrees: true } | { agrees: false, kind: 'changed' | 'missing', reason: 'numbers' | 'text', similarity: number }

/** A run that is only a figure: digits and the marks figures are written with. */
export const FIGURE = /^[\d\s.,:/%()+-]+$/u

/**
 * Words shorter than this, in points, are specks, not writing - OCR reads a
 * dot of toner as a comma or a `4`. Body text is 7 pt and up; its capitals
 * stand about 5 pt tall.
 */
const MIN_WORD_HEIGHT = 4

export function claimWords (references: readonly Reference[], words: readonly PlacedText[], lineOf: readonly number[], options: MatchOptions): Claims {
  const claimed: PlacedText[][] = references.map(() => [])
  const groups = new Map<number, PlacedText[]>()

  for (const [i, word] of words.entries()) {
    const owner = claimant(word, references)
    if (owner !== -1) claimed[owner].push(word)
    else if (isWriting(word, options)) groups.set(lineOf[i], [...(groups.get(lineOf[i]) ?? []), word])
  }

  return { found: claimed.map(run => inReadingOrder(run).map(w => w.text).join(' ')), added: [...groups.values()] }
}

/**
 * The rule every run is held to - on the page, and again when it is re-read on
 * its own. A run that is only a figure agrees when its digits do, in order:
 * OCR trades commas for full stops constantly, and `5,768,700.00` read as
 * `5.768.700 00` is the same amount. Any other run must also keep its digits,
 * and read within the similarity threshold.
 */
export function judgeRun (expected: string, found: string, options: MatchOptions): Verdict {
  const want = normaliseText(expected, options.normalise)
  if (want === '') return { agrees: true }

  const read = normaliseText(found, options.normalise)
  if (read === '') return { agrees: false, kind: 'missing', reason: 'text', similarity: 0 }

  const similarity = levenshteinSimilarity(want, read)
  if (digits(want) !== digits(read)) return { agrees: false, kind: 'changed', reason: 'numbers', similarity }
  if (FIGURE.test(want)) return { agrees: true }
  if (similarity < options.matchThreshold) return { agrees: false, kind: 'changed', reason: 'text', similarity }

  return { agrees: true }
}

/**
 * @param verified - Runs the print check matched glyph by glyph and found
 *   changed. Their differences are evidence in themselves; every other one is
 *   a reading, which the pixels still have to agree with.
 */
export function judgeRuns (references: readonly Reference[], claims: Claims, options: MatchOptions, verified: ReadonlySet<number> = new Set()): WordMatch {
  const differences: TextDifference[] = []
  const expectedParts: string[] = []
  const alignedParts: string[] = []

  for (const [r, ref] of references.entries()) {
    const found = claims.found[r]
    const separator = ref.endsLine === true ? '\n' : ' '
    expectedParts.push(ref.text + separator)
    alignedParts.push(found + separator)

    const verdict = judgeRun(ref.text, found, options)
    if (verdict.agrees) continue
    differences.push({
      kind:       verdict.kind,
      expected:   ref.text,
      found:      verdict.kind === 'missing' ? null : found,
      similarity: verdict.similarity,
      reason:     verdict.reason,
      verified:   verified.has(r),
      ...box(ref),
    })
  }

  // Added words, grouped along the engine's lines so a stray phrase is one difference.
  for (const group of claims.added) {
    const found = group.map(w => w.text).join(' ')
    alignedParts.push(found + '\n')
    differences.push({ kind: 'added', expected: null, found, similarity: 0, reason: 'text', verified: false, ...union(group) })
  }

  return { alignedText: alignedParts.join('').trim(), expectedText: expectedParts.join('').trim(), differences }
}

/** Claim and judge in one go, for a page read once. */
export function matchWords (references: readonly Reference[], words: readonly PlacedText[], lineOf: readonly number[], options: MatchOptions): WordMatch {
  return judgeRuns(references, claimWords(references, words, lineOf, options), options)
}

/**
 * The run whose box - grown by a third of its height, at least 1.5 pt - holds
 * the word's centre, the smallest where several do; `-1` when none does.
 */
function claimant (word: PlacedText, references: readonly Reference[]): number {
  const cx = word.x + word.width / 2
  const cy = word.y + word.height / 2
  let best = -1
  let bestArea = Infinity
  for (const [r, ref] of references.entries()) {
    const pad = Math.max(1.5, ref.height * 0.3)
    const inside = cx >= ref.x - pad && cx <= ref.x + ref.width + pad && cy >= ref.y - pad && cy <= ref.y + ref.height + pad
    const area = ref.width * ref.height
    if (inside && area < bestArea) {
      best = r
      bestArea = area
    }
  }

  return best
}

/** A word no run claimed that counts as added: confidently read, big enough to be writing, not noise. */
function isWriting (word: PlacedText, options: MatchOptions): boolean {
  return (word.confidence ?? 0) >= options.minWordConfidence &&
    word.height >= MIN_WORD_HEIGHT &&
    normaliseText(word.text, options.normalise) !== ''
}

/** Every digit, in order - what a figure must reproduce exactly. */
function digits (text: string): string {
  return text.replaceAll(/\D/gu, '')
}

/**
 * Words as a reader meets them: rows top to bottom - a word starts a new row
 * once its centre is more than half a word's height below the row's first -
 * and each row left to right.
 */
function inReadingOrder (words: readonly PlacedText[]): PlacedText[] {
  const byHeight = words.toSorted((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2))
  const rows: PlacedText[][] = []
  for (const word of byHeight) {
    const row = rows.at(-1)
    const centre = word.y + word.height / 2
    if (row !== undefined && centre - (row[0].y + row[0].height / 2) <= Math.min(row[0].height, word.height) / 2) row.push(word)
    else rows.push([word])
  }

  return rows.flatMap(row => row.toSorted((a, b) => a.x - b.x))
}

function box (text: PlacedText): { x: number, y: number, width: number, height: number } {
  return { x: text.x, y: text.y, width: text.width, height: text.height }
}

function union (texts: readonly PlacedText[]): { x: number, y: number, width: number, height: number } {
  const left = Math.min(...texts.map(t => t.x))
  const top = Math.min(...texts.map(t => t.y))
  const right = Math.max(...texts.map(t => t.x + t.width))
  const bottom = Math.max(...texts.map(t => t.y + t.height))

  return { x: left, y: top, width: right - left, height: bottom - top }
}
