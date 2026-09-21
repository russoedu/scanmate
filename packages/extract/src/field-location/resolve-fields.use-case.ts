import type { PageRegion, ScanmateRect } from '@scanmate/ink'

import type { AnchorCorner, FieldOffset, FieldSpec, LocatablePage, LocatedAnchor, LocatedFields, LocateOptions, LocationProblem } from './field-location.contract'
import { locateAnchor } from './locate-anchor.use-case'

/**
 * Field regions placed from the labels a document prints, instead of at fixed
 * coordinates.
 *
 * A generated document's fields move with its content - one more line in an
 * address pushes the signature block down, sometimes onto the next page. What
 * does not move is a field's place beside its label. So each field is an
 * offset from an anchor, and the anchor is found in the text layer, which says
 * exactly where it landed.
 *
 * Pure: it takes the pages' text, so it can run on text already extracted.
 * `locateFields` reads a PDF and calls it.
 */
export function resolveFields (pages: readonly LocatablePage[], specs: readonly FieldSpec[], options: LocateOptions = {}): LocatedFields {
  const regions: PageRegion[] = []
  const anchors: LocatedAnchor[] = []
  const problems: LocationProblem[] = []
  const ids = new Set<string>()
  const ordered = pages.toSorted((a, b) => a.page - b.page)

  for (const spec of specs) {
    const { anchor, fields, occurrence = 'unique', page, from = 'top-left' } = spec
    const searched = page === undefined ? ordered : ordered.filter(p => p.page === page)
    const found = searched.flatMap(p => locateAnchor(p.textItems, anchor, options).map(match => ({ ...match, anchor, page: p.page })))

    const chosen = choose(found, occurrence)
    if (chosen === undefined) {
      problems.push(problemFor(anchor, occurrence, found.length))
      continue
    }

    anchors.push(chosen)
    const bounds = ordered.find(p => p.page === chosen.page)
    for (const [id, offset] of Object.entries(fields)) {
      if (ids.has(id)) {
        problems.push({ kind: 'duplicate-id', id })
        continue
      }
      ids.add(id)

      const region = { page: chosen.page, id, ...placeField(chosen.box, offset, from) }
      regions.push(region)
      const wrong = bounds === undefined ? null : checkRegion(region, bounds)
      if (wrong !== null) problems.push(wrong)
    }
  }

  problems.push(...overlaps(regions))

  return { regions, anchors, problems }
}

/** A field's box, placed from one corner of its anchor. */
export function placeField (anchor: ScanmateRect, offset: FieldOffset, from: AnchorCorner = 'top-left'): ScanmateRect {
  const right = from.endsWith('right')
  const bottom = from.startsWith('bottom')

  return {
    x:      (right ? anchor.x + anchor.width : anchor.x) + offset.dx,
    y:      (bottom ? anchor.y + anchor.height : anchor.y) + offset.dy,
    width:  offset.width,
    height: offset.height,
  }
}

function choose (found: readonly LocatedAnchor[], occurrence: 'unique' | number): LocatedAnchor | undefined {
  if (occurrence === 'unique') return found.length === 1 ? found[0] : undefined

  return Number.isSafeInteger(occurrence) && occurrence >= 1 ? found[occurrence - 1] : undefined
}

function problemFor (anchor: string, occurrence: 'unique' | number, occurrences: number): LocationProblem {
  if (occurrences === 0) return { kind: 'anchor-missing', anchor }
  if (occurrence === 'unique') return { kind: 'anchor-ambiguous', anchor, occurrences }

  return { kind: 'occurrence-missing', anchor, occurrence, occurrences }
}

/** What makes one region unusable on its own: not a number, or not on its page. */
function checkRegion (region: PageRegion, page: LocatablePage): LocationProblem | null {
  const { id, x, y, width, height } = region
  if ([x, y, width, height].some(v => !Number.isFinite(v)) || width <= 0 || height <= 0) return { kind: 'not-finite', id, page: region.page }
  if (x < 0 || y < 0 || x + width > page.width || y + height > page.height) return { kind: 'off-page', id, page: region.page }

  return null
}

/** Every two regions on one page that cover some of the same ground. */
function overlaps (regions: readonly PageRegion[]): LocationProblem[] {
  const found: LocationProblem[] = []
  for (const [i, a] of regions.entries()) {
    const later = regions.slice(i + 1)
    for (const b of later)
      if (a.page === b.page && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y)
        found.push({ kind: 'overlap', ids: [a.id, b.id], page: a.page })
  }

  return found
}
