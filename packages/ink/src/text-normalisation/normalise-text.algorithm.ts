import { foldConfusables } from './confusables.mapper'
import { foldDiacritics } from './diacritics.mapper'

/**
 * Text made comparable: the differences OCR introduces that say nothing about
 * the document are removed, and nothing else.
 *
 * Each step is a judgement about which noise to forgive, so each can be turned
 * off. In order:
 *
 * 1. Unicode NFKC - ligatures (`ﬁ`), full-width and compatibility forms.
 * 2. Typography - curly quotes, dashes, ellipses and odd spaces to plain ASCII.
 * 3. De-hyphenation - `informa-` + newline + `tion` is `information`, or every
 *    wrapped word counts as an edit.
 * 4. Diacritics - `é` to `e`, `Æ` to `AE`.
 * 5. Case.
 * 6. Noise - tokens with no letter, digit or currency sign: table rules read
 *    as `|`, underlines as `___`, specks as `.` or `~`.
 * 7. Punctuation (off by default) - it carries real signal: `1,250.00` is not
 *    `125000`.
 * 8. OCR confusables (off by default) - `0/o`, `1/l/i`, `5/s`, `rn/m`. Folding
 *    them forgives exactly the substitutions a forger would make.
 * 9. Whitespace collapsed and trimmed.
 */

export interface NormaliseOptions {
  nfkc?:             boolean
  typography?:       boolean
  dehyphenate?:      boolean
  diacritics?:       boolean
  caseFold?:         boolean
  dropNoise?:        boolean
  stripPunctuation?: boolean
  confusables?:      boolean
}

export const DEFAULT_NORMALISE: Required<NormaliseOptions> = {
  nfkc:             true,
  typography:       true,
  dehyphenate:      true,
  diacritics:       true,
  caseFold:         true,
  dropNoise:        true,
  stripPunctuation: false,
  confusables:      false,
}

const LINE_END_HYPHEN = /(\p{L})[-\u{AD}\u{2010}\u{2011}][\t ]*\r?\n[\t ]*(?=\p{Ll})/gu
const TYPOGRAPHY: ReadonlyArray<readonly [RegExp, string]> = [
  // single quotes and prime, double quotes and double prime
  [/[\u{2018}\u{2019}\u{201A}\u{201B}\u{2032}]/gu, '\''],
  [/[\u{201C}\u{201D}\u{201E}\u{201F}\u{2033}]/gu, '"'],
  // hyphens, figure dash, en and em dashes, horizontal bar, minus
  [/[\u{2010}\u{2011}\u{2012}\u{2013}\u{2014}\u{2015}\u{2212}]/gu, '-'],
  [/\u{2026}/gu, '...'],
  // no-break and typographic spaces
  [/[\u{A0}\u{2000}-\u{200A}\u{202F}\u{205F}\u{3000}]/gu, ' '],
  // zero-width space and non-joiner, word joiner, byte-order mark
  [/[\u{200B}\u{200C}\u{2060}\u{FEFF}]/gu, ''],
  // zero-width joiner, on its own: in a character class it reads as joining its neighbours
  [/\u{200D}/gu, ''],
]
const MEANINGFUL = /[\p{L}\p{N}\p{Sc}]/u
const PUNCTUATION = /\p{P}+/gu
const WHITESPACE = /\s+/gu

export function normaliseText (text: string, options: NormaliseOptions = {}): string {
  const o = { ...DEFAULT_NORMALISE, ...options }
  let out = text

  if (o.nfkc) out = out.normalize('NFKC')
  if (o.typography) for (const [pattern, replacement] of TYPOGRAPHY) out = out.replaceAll(pattern, () => replacement)
  if (o.dehyphenate) out = out.replaceAll(LINE_END_HYPHEN, '$1')
  if (o.diacritics) out = foldDiacritics(out)
  if (o.caseFold) out = out.toLowerCase()
  if (o.dropNoise) out = out.split(WHITESPACE).filter(token => MEANINGFUL.test(token)).join(' ')
  if (o.stripPunctuation) out = out.replaceAll(PUNCTUATION, ' ')
  if (o.confusables) out = foldConfusables(out)

  return out.replaceAll(WHITESPACE, ' ').trim()
}

/** Normalised words, in order. */
export function tokenise (text: string, options: NormaliseOptions = {}): string[] {
  const normalised = normaliseText(text, options)

  return normalised === '' ? [] : normalised.split(' ')
}
