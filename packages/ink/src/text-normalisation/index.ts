/** Making OCR text and a document's own text comparable: the noise OCR adds, removed. */

export { foldConfusables } from './confusables.mapper'
export { diacriticsMap, foldDiacritics } from './diacritics.mapper'
export { DEFAULT_NORMALISE, normaliseText, tokenise } from './normalise-text.use-case'
export type { NormaliseOptions } from './normalise-text.use-case'
