import { normaliseText } from '@scanmate/ink'
import type { NormaliseOptions } from '@scanmate/ink'
import { cosine, dice, jaccard, jaroWinkler, levenshtein, wordDistance, wordRecall } from './similarity-metrics.use-case'

/** Every measure of how alike an expected text and an actual one are, after normalisation. */
export interface TextMetrics {
  /** Characters of edit between the normalised texts. */
  levenshtein:           number
  /** `1 - levenshtein / longer length`. */
  levenshteinSimilarity: number
  /** Share of distinct words in common. */
  jaccard:               number
  /** Character-bigram overlap. */
  dice:                  number
  /** Word-frequency cosine. */
  cosine:                number
  /** Only meaningful on short strings; reported for completeness. */
  jaroWinkler:           number
  /** Character error rate: edits over the expected length. Can exceed 1. */
  characterErrorRate:    number
  /** Word error rate: word edits over the expected word count. Can exceed 1. */
  wordErrorRate:         number
  /** Share of expected words present, each used once. */
  wordRecall:            number
  /** Actual length over expected length - near 0 when a page read as nothing. */
  lengthRatio:           number
  /** Normalised expected length, in characters: the weight this text carries in a total. */
  characters:            number
}

export type ScoreMetric = 'levenshteinSimilarity' | 'wordRecall' | 'jaccard' | 'dice' | 'cosine'

/** Normalise both texts the same way, then measure them every way. */
export function compareTexts (expected: string, actual: string, options: NormaliseOptions = {}): TextMetrics {
  const a = normaliseText(expected, options)
  const b = normaliseText(actual, options)
  const aWords = a === '' ? [] : a.split(' ')
  const bWords = b === '' ? [] : b.split(' ')
  const edits = levenshtein(a, b)
  const longest = Math.max(a.length, b.length)

  return {
    levenshtein:           edits,
    levenshteinSimilarity: longest === 0 ? 1 : 1 - edits / longest,
    jaccard:               jaccard(aWords, bWords),
    dice:                  dice(a, b),
    cosine:                cosine(aWords, bWords),
    jaroWinkler:           jaroWinkler(a, b),
    characterErrorRate:    a.length === 0 ? (b.length === 0 ? 0 : 1) : edits / a.length,
    wordErrorRate:         aWords.length === 0 ? (bWords.length === 0 ? 0 : 1) : wordDistance(aWords, bWords) / aWords.length,
    wordRecall:            wordRecall(aWords, bWords),
    lengthRatio:           a.length === 0 ? (b.length === 0 ? 1 : Infinity) : b.length / a.length,
    characters:            a.length,
  }
}
