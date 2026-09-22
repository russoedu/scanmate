import { distance } from 'fastest-levenshtein'

/**
 * Ways to say how alike two texts are. They fail differently, which is why
 * several are reported rather than one:
 *
 * - edit distance counts every insertion, deletion and substitution, so it
 *   notices a changed digit - and punishes text that reflowed;
 * - set and bag measures (Jaccard, Dice, cosine, recall) ignore order, so they
 *   survive reflow and a reading order OCR got wrong - and miss a swapped clause;
 * - character and word error rates are what anyone who works with OCR expects
 *   to see;
 * - Jaro-Winkler is for short strings - names, references - and meaningless on
 *   a page.
 *
 * All take text already normalised; similarities run from 0 to 1.
 */

/** Characters inserted, deleted or substituted to turn one text into the other (Myers' bit-parallel algorithm). */
export function levenshtein (a: string, b: string): number {
  return distance(a, b)
}

/** `1 - distance / longer length`: 1 for identical, 0 for nothing in common. */
export function levenshteinSimilarity (a: string, b: string): number {
  const longest = Math.max(a.length, b.length)

  return longest === 0 ? 1 : 1 - distance(a, b) / longest
}

/** Words inserted, deleted or substituted, as edit distance over words rather than characters. */
export function wordDistance (a: readonly string[], b: readonly string[]): number {
  // Each distinct word becomes one private-use character, so the fast
  // character routine does the work - while they last.
  const codes = new Map<string, string>()
  const PRIVATE_USE = 0xE000
  const AVAILABLE = 0xF8FF - PRIVATE_USE + 1
  for (const word of [...a, ...b]) if (!codes.has(word)) codes.set(word, String.fromCodePoint(PRIVATE_USE + codes.size))
  if (codes.size <= AVAILABLE) return distance(a.map(w => codes.get(w)).join(''), b.map(w => codes.get(w)).join(''))

  let previous = Int32Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = new Int32Array(b.length + 1)
    current[0] = i
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    previous = current
  }

  return previous[b.length]
}

/** Shared distinct words over all distinct words. */
export function jaccard (a: readonly string[], b: readonly string[]): number {
  const left = new Set(a)
  const right = new Set(b)
  if (left.size === 0 && right.size === 0) return 1

  let shared = 0
  for (const word of left) if (right.has(word)) shared++

  return shared / (left.size + right.size - shared)
}

/** Sørensen-Dice over character bigrams, counted with multiplicity. */
export function dice (a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  const bigrams = new Map<string, number>()
  for (let i = 0; i < a.length - 1; i++) {
    const pair = a.slice(i, i + 2)
    bigrams.set(pair, (bigrams.get(pair) ?? 0) + 1)
  }

  let shared = 0
  for (let i = 0; i < b.length - 1; i++) {
    const pair = b.slice(i, i + 2)
    const count = bigrams.get(pair) ?? 0
    if (count > 0) {
      shared++
      bigrams.set(pair, count - 1)
    }
  }

  return (2 * shared) / (a.length - 1 + b.length - 1)
}

/** Cosine of the two word-frequency vectors. */
export function cosine (a: readonly string[], b: readonly string[]): number {
  const left = frequencies(a)
  const right = frequencies(b)
  if (left.size === 0 && right.size === 0) return 1

  let dot = 0
  for (const [word, count] of left) dot += count * (right.get(word) ?? 0)
  const denominator = magnitude(left) * magnitude(right)

  return denominator === 0 ? 0 : dot / denominator
}

/** Share of the expected words found, each found word used once - the question "is what should be there, there?". */
export function wordRecall (expected: readonly string[], actual: readonly string[]): number {
  if (expected.length === 0) return 1

  const available = frequencies(actual)
  let found = 0
  for (const word of expected) {
    const count = available.get(word) ?? 0
    if (count > 0) {
      found++
      available.set(word, count - 1)
    }
  }

  return found / expected.length
}

/**
 * Jaro-Winkler: characters matched within a window, transpositions counted, a
 * bonus for a shared prefix of up to four. Tuned for short strings.
 */
export function jaroWinkler (a: string, b: string, prefixScale = 0.1): number {
  if (a === b) return 1
  if (a.length === 0 || b.length === 0) return 0

  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const left = a.split('')
  const right = b.split('')
  const aMatched = new Uint8Array(left.length)
  const bMatched = new Uint8Array(right.length)
  let matches = 0
  for (const [i, character] of left.entries()) {
    const j = partner(right, bMatched, character, Math.max(0, i - window), Math.min(right.length - 1, i + window))
    if (j === -1) continue
    aMatched[i] = 1
    bMatched[j] = 1
    matches++
  }
  if (matches === 0) return 0

  // Matched characters of each, in order; every position where they disagree is half a transposition.
  const leftMatched = left.filter((_, i) => aMatched[i] === 1)
  const rightMatched = right.filter((_, j) => bMatched[j] === 1)
  const transpositions = leftMatched.filter((character, k) => character !== rightMatched[k]).length

  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3
  let prefix = 0
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++

  return jaro + prefix * prefixScale * (1 - jaro)
}

/** The first unmatched `character` in `text[from..to]`, or `-1`. */
function partner (text: readonly string[], matched: Uint8Array, character: string, from: number, to: number): number {
  for (let j = from; j <= to; j++) if (matched[j] === 0 && text[j] === character) return j

  return -1
}

function magnitude (counts: ReadonlyMap<string, number>): number {
  let sum = 0
  for (const count of counts.values()) sum += count * count

  return Math.sqrt(sum)
}

function frequencies (words: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1)

  return counts
}
