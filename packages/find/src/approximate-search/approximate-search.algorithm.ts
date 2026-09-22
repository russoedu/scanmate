/**
 * Where a short text occurs inside a long one, allowing for OCR's errors.
 *
 * Sellers' algorithm: edit distance in which the match may start and end
 * anywhere in the text - the first row of the table is zero, so skipping text
 * before the match is free, and the best end is read off the last row. An
 * exact `includes` would call a perfectly good scan incomplete for one misread
 * letter; this finds "Initial Subscription Term" in "lnitial Subscription
 * Terrn" and says how far off it was.
 *
 * Figures are held to more than closeness. A match for something containing
 * digits must contain the same digits, in order, and must not run into more
 * digits on either side - so `1,250.00` is not found inside `11,250.00`, and
 * `7,250.00` is not an approximate `1,250.00`. A letter standing alone - the
 * "A" of "Schedule A", the "B" of "Option B" - is an identifier the same way,
 * and must be there as a word of its own: one letter in ten is 90% similar.
 */

export interface ApproximateMatch {
  /** Characters of the text the match covers, `[start, end)`. */
  start:    number
  end:      number
  /** Edits between the needle and the match. */
  distance: number
  /** `1 - distance / needle length`. */
  score:    number
}

export interface SearchOptions {
  /** Least score a match may have. Default `0.85`. */
  minScore?: number
}

/** Every acceptable match, best first; overlapping matches keep only the best. */
export function approximateSearch (needle: string, text: string, options: SearchOptions = {}): ApproximateMatch[] {
  const { minScore = 0.85 } = options
  const m = needle.length
  if (m === 0) return []
  const n = text.length

  const maxEdits = Math.floor((1 - minScore) * m + 1e-9)
  const table = new Int32Array((m + 1) * (n + 1))
  const at = (i: number, j: number): number => i * (n + 1) + j
  for (let i = 1; i <= m; i++) table[at(i, 0)] = i
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      table[at(i, j)] = Math.min(
        table[at(i - 1, j - 1)] + (needle[i - 1] === text[j - 1] ? 0 : 1),
        table[at(i - 1, j)] + 1,
        table[at(i, j - 1)] + 1,
      )

  const ends: number[] = []
  for (let j = 1; j <= n; j++) if (table[at(m, j)] <= maxEdits) ends.push(j)
  ends.sort((a, b) => table[at(m, a)] - table[at(m, b)] || a - b)

  const wanted = digitsOf(needle)
  const letters = needle.split(/\s+/u).filter(word => /^\p{L}$/u.test(word))
  const found: ApproximateMatch[] = []
  for (const end of ends) {
    const start = startOf(table, n, m, end, needle, text)
    if (found.some(f => start < f.end && end > f.start)) continue
    if (wanted !== '' && !keepsFigures(text, start, end, wanted)) continue
    if (letters.length > 0 && !keepsLetters(text, start, end, letters)) continue
    const distance = table[at(m, end)]
    found.push({ start, end, distance, score: 1 - distance / m })
  }

  return found
}

/** The best acceptable match, or `null`. */
export function bestMatch (needle: string, text: string, options: SearchOptions = {}): ApproximateMatch | null {
  return approximateSearch(needle, text, options)[0] ?? null
}

/**
 * A match widened to whole words. The cheapest alignment may stop inside a
 * word - "subscription ter" costs less than "subscription terrn" - which is
 * right for scoring and wrong for showing someone what was found.
 */
export function wordSpan (text: string, start: number, end: number): { start: number, end: number } {
  let from = start
  let to = end
  while (from > 0 && !/\s/u.test(text[from - 1])) from--
  while (to < text.length && !/\s/u.test(text[to])) to++

  return { start: from, end: to }
}

/** Walk the table back from the match's end to where it started, preferring the diagonal. */
function startOf (table: Int32Array, n: number, m: number, end: number, needle: string, text: string): number {
  const at = (i: number, j: number): number => i * (n + 1) + j
  let i = m
  let j = end
  while (i > 0 && j > 0) {
    const here = table[at(i, j)]
    if (here === table[at(i - 1, j - 1)] + (needle[i - 1] === text[j - 1] ? 0 : 1)) {
      i--
      j--
    } else if (here === table[at(i - 1, j)] + 1) i--
    else j--
  }

  return j
}

/** The match has exactly the wanted digits, and no digit touches it from outside. */
function keepsFigures (text: string, start: number, end: number, wanted: string): boolean {
  if (digitsOf(text.slice(start, end)) !== wanted) return false

  return !isDigit(text[start - 1]) && !isDigit(text[end])
}

/** Every lone letter of the needle stands as a word in the match. */
function keepsLetters (text: string, start: number, end: number, letters: readonly string[]): boolean {
  const span = wordSpan(text, start, end)
  const words = new Set(text.slice(span.start, span.end).split(/\s+/u))

  return letters.every(letter => words.has(letter))
}

function digitsOf (text: string): string {
  return text.replaceAll(/\D/gu, '')
}

function isDigit (character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9'
}
