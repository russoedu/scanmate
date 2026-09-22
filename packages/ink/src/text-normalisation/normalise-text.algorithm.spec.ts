import { diacriticsMap, foldDiacritics } from './diacritics.mapper'
import { normaliseText, tokenise } from './normalise-text.use-case'

describe('normaliseText', () => {
  it('folds accents, ligatures, full-width forms and case', () => {
    expect(normaliseText('Crème Brûlée ﬁnal ＡＢＣ Æsir')).toBe('creme brulee final abc aesir')
  })

  it('joins a word hyphenated across a line, and only then', () => {
    expect(normaliseText('informa-\ntion and well-known')).toBe('information and well-known')
  })

  it('makes typography plain: quotes, dashes, spaces, zero-width characters', () => {
    expect(normaliseText('\u{201C}It\u{2019}s\u{201D} 10\u{2013}12\u{A0}pm\u{200B}\u{2026}')).toBe('"it\'s" 10-12 pm...')
  })

  it('drops noise tokens OCR reads off rules and specks, and keeps currency', () => {
    expect(normaliseText('Total | 1,250.00 ___ ~ \u{2022} ¥ .')).toBe('total 1,250.00 ¥')
  })

  it('keeps punctuation and confusable characters unless asked', () => {
    expect(normaliseText('Ref 1O-5S rn')).toBe('ref 1o-5s rn')
    expect(normaliseText('Ref 1O-5S rn', { stripPunctuation: true, confusables: true })).toBe('ref lo ss m')
  })

  it('can leave every step out', () => {
    const none = { nfkc: false, typography: false, dehyphenate: false, diacritics: false, caseFold: false, dropNoise: false }

    expect(normaliseText('Crème\u{9} | ', none)).toBe('Crème |')
  })

  it('tokenises into normalised words', () => {
    expect(tokenise(' Hello,\u{9}Wörld ')).toEqual(['hello,', 'world'])
    expect(tokenise(' \u{9} ')).toEqual([])
  })
})

describe('foldDiacritics', () => {
  it('holds the whole table from the brief, and never maps a base letter', () => {
    const map = diacriticsMap()

    expect(map.size).toBeGreaterThan(780)
    expect(map.get('é')).toBe('e')
    expect(map.get('Ø')).toBe('O')
    expect(map.has('a')).toBe(false)
  })

  it('may lengthen text, where a base is two letters', () => {
    expect(foldDiacritics('Œuvre, ǅ')).toBe('OEuvre, Dz')
  })
})
