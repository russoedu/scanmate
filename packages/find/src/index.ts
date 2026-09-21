/**
 * `@scanmate/find` - is the content that must be on each page there, and is it
 * where the original puts it?
 *
 * ```ts
 * import { findContent } from '@scanmate/find'
 *
 * const found = findContent(ocrReport, [
 *   { page: 1, content: ['The Resistance', 'Total 27,211,380.00'] },
 *   { page: 6, content: ['For and on behalf of Customer'] },
 * ])
 * found.allFound                     // every item found on its page
 * found.pages[0].content[1]          // { found, identifiable, excerpt, box, foundOnPages, ... }
 * ```
 *
 * Content is first located in the original's text - exact - and then looked
 * for in the scan's reading of that very place: found there, it is present and
 * identifiable. Words forgive OCR's slips; figures and lone letters ("Schedule
 * A") must match exactly. Every page is searched too, so content that moved
 * pages shows where it went.
 */

export { findContent } from './content-search'
export type { ContentResult, ExpectedContent, FindOptions, FindReport, FoundBy, Occurrence, PageFind } from './content-search'

// --- Building blocks ---

export { approximateSearch, bestMatch, wordSpan } from './approximate-search'
export type { ApproximateMatch, SearchOptions } from './approximate-search'
