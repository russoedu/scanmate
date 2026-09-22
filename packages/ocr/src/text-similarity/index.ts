/** How alike two texts are, measured the several ways they can differ. */

export { compareTexts } from './compare-texts.algorithm'
export type { ScoreMetric, TextMetrics } from './compare-texts.algorithm'
export { cosine, dice, jaccard, jaroWinkler, levenshtein, levenshteinSimilarity, wordDistance, wordRecall } from './similarity-metrics.algorithm'
