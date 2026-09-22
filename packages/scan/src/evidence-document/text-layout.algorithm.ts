/** What a line of text needs from a font: its width, and which characters it can draw. */
export interface Measure {
  width:  (text: string) => number
  /** Characters the font has no glyph for, replaced so the page can still be written. */
  covers: (codePoint: number) => boolean
}

/**
 * Text as a standard PDF font can draw it.
 *
 * A finding quotes what was read, and OCR reads what it likes - a curly quote,
 * a ligature, a Cyrillic letter in a forged name. The standard fonts draw only
 * Latin-1 and a few more, and pdf-lib throws on anything else, which would lose
 * the whole report for one character. So typography is flattened to ASCII and
 * anything still not drawable becomes `?` - visibly, not silently.
 */
export function drawable (text: string, measure: Measure): string {
  return [...text].map((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    const flat = TYPOGRAPHY.get(codePoint) ?? (isSpace(codePoint) ? ' ' : character)

    return [...flat].every(c => measure.covers(c.codePointAt(0) ?? 0)) ? flat : '?'
  }).join('')
}

/** Typography with a plain ASCII equivalent: quotes, dashes, the ellipsis. */
const TYPOGRAPHY = new Map<number, string>([
  [0x20_18, "'"], [0x20_19, "'"], [0x20_1A, "'"], [0x20_1B, "'"],
  [0x20_1C, '"'], [0x20_1D, '"'], [0x20_1E, '"'], [0x20_1F, '"'],
  [0x20_10, '-'], [0x20_11, '-'], [0x20_12, '-'], [0x20_13, '-'], [0x20_14, '-'], [0x20_15, '-'], [0x22_12, '-'],
  [0x20_26, '...'],
])

/** Tabs, line breaks, and the no-break and typographic spaces. */
function isSpace (codePoint: number): boolean {
  return codePoint === 0x09 || codePoint === 0x0A || codePoint === 0x0D || codePoint === 0xA0 ||
    (codePoint >= 0x20_00 && codePoint <= 0x20_0A) || codePoint === 0x20_2F || codePoint === 0x20_5F || codePoint === 0x30_00
}

/** Lines no wider than `width`, broken between words; a word wider than a line is broken where it must be. */
export function wrap (text: string, width: number, measure: Measure): string[] {
  const lines: string[] = []
  let line = ''
  const words = text.split(' ').filter(w => w !== '')
  for (const word of words) {
    const candidate = line === '' ? word : `${line} ${word}`
    if (measure.width(candidate) <= width) {
      line = candidate
      continue
    }
    if (line !== '') lines.push(line)
    line = word
    while (measure.width(line) > width && line.length > 1) {
      let cut = line.length - 1
      while (cut > 1 && measure.width(line.slice(0, cut)) > width) cut--
      lines.push(line.slice(0, cut))
      line = line.slice(cut)
    }
  }
  if (line !== '') lines.push(line)

  return lines
}
