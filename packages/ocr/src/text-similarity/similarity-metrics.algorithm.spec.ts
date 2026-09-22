import { compareTexts } from './compare-texts.use-case'
import { cosine, dice, jaccard, jaroWinkler, levenshtein, levenshteinSimilarity, wordDistance, wordRecall } from './similarity-metrics.use-case'

describe('similarity metrics', () => {
  it('match their textbook values', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshteinSimilarity('kitten', 'sitting')).toBeCloseTo(4 / 7, 10)
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.9611, 4)
    expect(jaroWinkler('dwayne', 'duane')).toBeCloseTo(0.84, 2)
    expect(dice('night', 'nacht')).toBeCloseTo(0.25, 10)
  })

  it('treat words as sets, bags and sequences', () => {
    const a = ['the', 'cat', 'sat', 'the']
    const b = ['the', 'dog', 'sat']

    expect(jaccard(a, b)).toBeCloseTo(2 / 4, 10)
    expect(cosine(a, a)).toBeCloseTo(1, 10)
    expect(wordRecall(a, b)).toBeCloseTo(2 / 4, 10)
    expect(wordDistance(a, b)).toBe(2)
  })

  it('count word edits the same way past the few thousand words the fast path can hold', () => {
    const many = Array.from({ length: 7000 }, (_, i) => `w${i}`)
    const edited = many.with(10, 'changed').toSpliced(5000, 1)

    expect(wordDistance(many, edited)).toBe(2)
  })

  it('agree that identical and empty texts are the same', () => {
    expect(jaccard([], [])).toBe(1)
    expect(cosine([], [])).toBe(1)
    expect(wordRecall([], ['x'])).toBe(1)
    expect(levenshteinSimilarity('', '')).toBe(1)
    expect(jaroWinkler('', 'x')).toBe(0)
  })
})

describe('compareTexts', () => {
  it('scores text that differs only in what normalisation forgives as identical', () => {
    const metrics = compareTexts('Crème brûlée - informa-\ntion', 'CREME BRULEE — information |')

    expect(metrics).toMatchObject({ levenshtein: 0, levenshteinSimilarity: 1, wordRecall: 1, characterErrorRate: 0, wordErrorRate: 0, lengthRatio: 1 })
  })

  it('sees a changed amount', () => {
    const metrics = compareTexts('Total 1,250.00', 'Total 7,250.00')

    expect(metrics.levenshtein).toBe(1)
    expect(metrics.wordRecall).toBe(0.5)
    expect(metrics.wordErrorRate).toBe(0.5)
  })

  it('says when a page read as nothing', () => {
    const metrics = compareTexts('Order confirmation form', '')

    expect(metrics.lengthRatio).toBe(0)
    expect(metrics.characterErrorRate).toBe(1)
    expect(metrics.characters).toBe(23)
  })
})
