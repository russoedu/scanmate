import { approximateSearch, bestMatch, wordSpan } from './approximate-search.algorithm'

describe('approximateSearch', () => {
  it('finds a phrase inside a longer text, with where it is and how far off', () => {
    const text = 'the lnitial subscription terrn is three years'
    const match = bestMatch('initial subscription term', text)
    const words = wordSpan(text, match!.start, match!.end)

    // The cheapest alignment stops inside "terrn"; shown, it is whole words.
    expect(match!.distance).toBe(2)
    expect(match!.score).toBeCloseTo(1 - 2 / 25, 10)
    expect(text.slice(words.start, words.end)).toBe('lnitial subscription terrn')
  })

  it('finds an exact occurrence with a perfect score', () => {
    expect(bestMatch('leia organa', 'contact: leia organa, general')).toMatchObject({ start: 9, end: 20, distance: 0, score: 1 })
  })

  it('finds nothing too far off', () => {
    expect(bestMatch('initial subscription term', 'renewal of the service', { minScore: 0.85 })).toBeNull()
  })

  it('holds a figure to its digits: close is not enough', () => {
    expect(bestMatch('total 1,250.00', 'total 7,250.00')).toBeNull()
    expect(bestMatch('total 1,250.00', 'total 1.250 00')).toMatchObject({ distance: 2 })
  })

  it('does not find a figure inside a longer one', () => {
    expect(bestMatch('1,250.00', 'amount 11,250.00')).toBeNull()
    expect(bestMatch('1,250.00', 'amount 1,250.001')).toBeNull()
    expect(bestMatch('1,250.00', 'amount 1,250.00 due')).toMatchObject({ distance: 0 })
  })

  it('holds a lone letter to itself: Schedule A is not Schedule B', () => {
    expect(bestMatch('schedule a', 'see schedule b')).toBeNull()
    expect(bestMatch('schedule a', 'see schedu1e a')).toMatchObject({ distance: 1 })
  })

  it('reports each occurrence once, best first', () => {
    const matches = approximateSearch('term', 'term one, terrn two, term three', { minScore: 0.7 })

    expect(matches.map(m => [m.start, m.distance])).toEqual([[0, 0], [21, 0], [10, 1]])
  })

  it('finds nothing for an empty needle', () => {
    expect(approximateSearch('', 'text')).toEqual([])
  })
})
