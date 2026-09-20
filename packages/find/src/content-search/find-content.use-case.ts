import type { ScanmateRect } from '@scanmate/ink'
import { DEFAULT_NORMALISE, normaliseText } from '@scanmate/ocr'
import type { NormaliseOptions, PageOcr, ReadPage } from '@scanmate/ocr'

import { approximateSearch, bestMatch, wordSpan } from '../approximate-search'
import type { ApproximateMatch } from '../approximate-search'
import type { ContentResult, ExpectedContent, FindOptions, FindReport, Occurrence } from './find-report.contract'

/**
 * Is what must be on the page on the page - and is it where it belongs?
 *
 * The question is asked of the OCR report, in two steps. First the content is
 * found in the original's text, which is exact, to learn where the original
 * prints it. Then the scan's reading of that very place is searched for it.
 * Found there, it is present and identifiable: the right words, in the right
 * place, as `@scanmate/ocr` read them after its own re-checking. Not found
 * there, the scan's whole page is searched, which still answers "present?" for
 * content that moved, or that the original never printed. And every page is
 * searched, so a required clause found only on another page says pages were
 * reordered or swapped. Content the original prints more than once must read
 * correctly at every place to be identifiable: one altered copy of an amount
 * printed twice leaves it found, and not identifiable.
 *
 * Matching tolerates OCR's slips in words (`minScore`), never in figures: a
 * reference number, an amount or a date must keep every digit.
 */
export function findContent<Page extends ReadPage> (
  pages: readonly Page[],
  expected: readonly ExpectedContent[],
  options: FindOptions = {},
): FindReport<Page> {
  const { minScore = 0.85, normalise = DEFAULT_NORMALISE } = options
  const indexed = new Map(pages.map(page => [page.page, indexPage(page.text, normalise)]))
  const wanted = new Map(expected.map(entry => [entry.page, entry.content]))

  const searched = pages.map((page) => {
    const content = wanted.get(page.page) ?? []
    const index = indexed.get(page.page)
    const found = index === undefined ? content.map(one => notFound(one)) : content.map(one => findOne(one, index, indexed, { minScore, normalise }))

    return { ...page, find: { page: page.page, content: found, allFound: found.every(one => one.found), warnings: [] } }
  })

  // Content asked for on a page that is not here at all: said once, at the top,
  // because there is no page to hang it on.
  const warnings = [...wanted.keys()]
    .filter(page => !indexed.has(page))
    .map(page => `content was expected on page ${page}, which is not among the pages given`)

  return {
    allFound:        warnings.length === 0 && searched.every(page => page.find.allFound),
    allIdentifiable: searched.every(page => page.find.content.every(one => one.identifiable)),
    pages:           searched,
    warnings,
  }
}

interface PageIndex {
  page:     PageOcr
  /** The original's runs, normalised and joined by spaces. */
  original: string
  /** Which run each character of `original` belongs to; `-1` for the joins. */
  runAt:    Int32Array
  /** The scan's text of the page, normalised, in the original's order. */
  scanned:  string
}

function indexPage (page: PageOcr, normalise: NormaliseOptions): PageIndex {
  const parts = page.runs.map(run => normaliseText(run.text, normalise))
  const original = parts.join(' ')
  const runAt = new Int32Array(original.length).fill(-1)
  let offset = 0
  for (const [r, part] of parts.entries()) {
    runAt.fill(r, offset, offset + part.length)
    offset += part.length + 1
  }

  return { page, original, runAt, scanned: normaliseText(page.alignedText, normalise) }
}

function findOne (content: string, index: PageIndex, pages: ReadonlyMap<number, PageIndex>, options: { minScore: number, normalise: NormaliseOptions }): ContentResult {
  const needle = normaliseText(content, options.normalise)
  if (needle === '') throw new RangeError(`nothing to find in ${JSON.stringify(content)} once normalised`)

  const foundOnPages = [...pages.values()].filter(p => bestMatch(needle, p.scanned, options) !== null).map(p => p.page.page)

  // Every place the original prints it, each checked against the scan's reading there.
  const checked = approximateSearch(needle, index.original, options)
    .toSorted((a, b) => a.start - b.start)
    .map(printed => inPlace(needle, printed, index, options))
  const occurrences = checked.map(c => c.occurrence)
  const common = { content, printedInOriginal: occurrences.length > 0, box: occurrences[0]?.box ?? null, occurrences, foundOnPages }

  const intact = checked.filter(c => c.occurrence.intact).toSorted((a, b) => b.score - a.score)
  if (intact.length > 0)
    return { ...common, found: true, identifiable: intact.length === checked.length, foundBy: 'in-place', score: intact[0].score, excerpt: intact[0].occurrence.excerpt }

  // Not where the original prints it: anywhere on the scanned page, then?
  const onPage = bestMatch(needle, index.scanned, options)
  if (onPage !== null) return { ...common, found: true, identifiable: false, foundBy: 'on-page', score: onPage.score, excerpt: excerptOf(index.scanned, onPage) }

  // Not found: report how close the page came, for whoever reviews it.
  const nearest = bestMatch(needle, index.scanned, { minScore: 0 })

  return { ...common, found: false, identifiable: false, foundBy: 'none', score: nearest?.score ?? 0, excerpt: null }
}

/** One printed occurrence: the runs it spans, and whether the scan's reading of them contains it. */
function inPlace (needle: string, printed: ApproximateMatch, index: PageIndex, options: { minScore: number, normalise: NormaliseOptions }): { occurrence: Occurrence, score: number } {
  const runs = [...new Set(index.runAt.slice(printed.start, printed.end))].filter(r => r !== -1).map(r => index.page.runs[r])
  const box = union(runs)
  const there = runs.map(run => normaliseText(run.found, options.normalise)).join(' ')
  const match = bestMatch(needle, there, options)

  return { occurrence: { box, intact: match !== null, excerpt: match === null ? null : excerptOf(there, match) }, score: match?.score ?? 0 }
}

function notFound (content: string): ContentResult {
  return { content, found: false, identifiable: false, foundBy: 'none', score: 0, excerpt: null, printedInOriginal: false, box: null, occurrences: [], foundOnPages: [] }
}

function excerptOf (text: string, match: { start: number, end: number }): string {
  const span = wordSpan(text, match.start, match.end)

  return text.slice(span.start, span.end)
}

function union (boxes: readonly ScanmateRect[]): ScanmateRect {
  const left = Math.min(...boxes.map(b => b.x))
  const top = Math.min(...boxes.map(b => b.y))

  return { x: left, y: top, width: Math.max(...boxes.map(b => b.x + b.width)) - left, height: Math.max(...boxes.map(b => b.y + b.height)) - top }
}
