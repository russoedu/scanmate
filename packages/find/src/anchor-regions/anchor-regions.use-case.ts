import type { ScanmateRect, TextRun } from '@scanmate/ink'
import { normaliseText } from '@scanmate/ocr'
import type { NormaliseOptions } from '@scanmate/ocr'

/**
 * Regions placed relative to text the original prints, instead of at fixed
 * coordinates.
 *
 * A generated document's fields move with its content: one more line in an
 * address pushes the signature block down. What does not move is the field's
 * position relative to its label. So a region is given as an offset from an
 * anchor - "Signature", "For and on behalf of Customer" - and resolved against
 * the original's text layer, which says exactly where the anchor landed.
 *
 * An anchor may be split across text runs ("For and on behalf of" + "Customer")
 * and is found by joining consecutive runs on one line; it must match exactly
 * after normalisation, because it is known text from the document's template,
 * not a reading. It must occur exactly once unless an occurrence is named -
 * an anchor that appears twice would put the field in one of two places.
 */

/** Where a field sits relative to its anchor's top-left corner, in points; positive is right and down. */
export interface FieldOffset {
  dx:     number
  dy:     number
  width:  number
  height: number
}

export interface AnchorOptions {
  normalise?:     NormaliseOptions
  /** Most consecutive runs one anchor may span. Default `12`. */
  maxRuns?:       number
  /** Runs whose tops differ by at most this many points are on one line. Default `2`. */
  lineTolerance?: number
}

export interface RegionSpec extends AnchorOptions {
  /** The text to anchor on. */
  anchor:      string
  /** The fields, by id. */
  fields:      Readonly<Record<string, FieldOffset>>
  /** `'unique'` (the default): the anchor must occur exactly once. A number picks that occurrence, one-based, in page order. */
  occurrence?: 'unique' | number
}

export type RegionProblem = { kind: 'anchor-missing', anchor: string } |
  { kind: 'anchor-ambiguous', anchor: string, occurrences: number } |
  { kind: 'off-page', id: string } |
  { kind: 'not-finite', id: string } |
  { kind: 'overlap', ids: [string, string] }

export interface ResolvedRegions {
  /** Where the anchor was found; `null` when it could not be settled. */
  anchor:   ScanmateRect | null
  /** The fields, by id, in points from the page's top-left - empty when the anchor could not be settled. */
  regions:  Record<string, ScanmateRect>
  /** Everything wrong: an empty list means the regions can be trusted. */
  problems: RegionProblem[]
}

/** Every place the anchor occurs, in page order: the box around the runs that spell it. */
export function locateAnchor (items: readonly TextRun[], anchor: string, options: AnchorOptions = {}): ScanmateRect[] {
  const { normalise, maxRuns = 12, lineTolerance = 2 } = options
  const target = normaliseText(anchor, normalise)
  if (target === '') return []

  const found: ScanmateRect[] = []
  for (const start of items.keys()) {
    const box = anchorAt(items.slice(start, start + maxRuns), target, normalise, lineTolerance)
    // The same place reached from a different first run is one occurrence.
    if (box !== null && found.every(f => Math.abs(f.x - box.x) >= 0.1 || Math.abs(f.y - box.y) >= 0.1)) found.push(box)
  }

  return found.toSorted((a, b) => a.y - b.y || a.x - b.x)
}

/** The anchor spelled by the first few of `runs`, all on one line, or `null`. */
function anchorAt (runs: readonly TextRun[], target: string, normalise: NormaliseOptions | undefined, lineTolerance: number): ScanmateRect | null {
  const line: TextRun[] = []
  for (const run of runs) {
    if (line.length > 0 && Math.abs(run.y - line[0].y) > lineTolerance) return null
    line.push(run)
    if (normaliseText(line.map(r => r.text).join(' '), normalise) === target) return union(line)
  }

  return null
}

/** Each field placed from the anchor's top-left corner. */
export function regionsFromAnchor (anchor: ScanmateRect, fields: Readonly<Record<string, FieldOffset>>): Record<string, ScanmateRect> {
  return Object.fromEntries(Object.entries(fields).map(([id, f]) => [id, { x: anchor.x + f.dx, y: anchor.y + f.dy, width: f.width, height: f.height }]))
}

/** Everything that makes a set of regions unusable: off the page, not a number, or overlapping another. */
export function checkRegions (regions: Readonly<Record<string, ScanmateRect>>, page: { width: number, height: number }): RegionProblem[] {
  const problems: RegionProblem[] = []
  const entries = Object.entries(regions)

  for (const [id, r] of entries) {
    if ([r.x, r.y, r.width, r.height].some(v => !Number.isFinite(v)) || r.width <= 0 || r.height <= 0) problems.push({ kind: 'not-finite', id })
    else if (r.x < 0 || r.y < 0 || r.x + r.width > page.width || r.y + r.height > page.height) problems.push({ kind: 'off-page', id })
  }

  const pairs = entries.flatMap(([a, ra], i) => entries.slice(i + 1).map(([b, rb]) => ({ a, ra, b, rb })))
  for (const { a, ra, b, rb } of pairs)
    if (ra.x < rb.x + rb.width && ra.x + ra.width > rb.x && ra.y < rb.y + rb.height && ra.y + ra.height > rb.y) problems.push({ kind: 'overlap', ids: [a, b] })

  return problems
}

/** Find the anchor, place the fields, check them - one call for a signature block. */
export function resolveRegions (items: readonly TextRun[], page: { width: number, height: number }, spec: RegionSpec): ResolvedRegions {
  const { anchor: text, fields, occurrence = 'unique' } = spec
  const occurrences = locateAnchor(items, text, spec)

  if (occurrences.length === 0) return { anchor: null, regions: {}, problems: [{ kind: 'anchor-missing', anchor: text }] }
  const chosen = occurrence === 'unique' ? (occurrences.length === 1 ? occurrences[0] : undefined) : occurrences[occurrence - 1]
  if (chosen === undefined) return { anchor: null, regions: {}, problems: [{ kind: 'anchor-ambiguous', anchor: text, occurrences: occurrences.length }] }

  const regions = regionsFromAnchor(chosen, fields)

  return { anchor: chosen, regions, problems: checkRegions(regions, page) }
}

function union (runs: readonly TextRun[]): ScanmateRect {
  const left = Math.min(...runs.map(r => r.x))
  const top = Math.min(...runs.map(r => r.y))

  return { x: left, y: top, width: Math.max(...runs.map(r => r.x + r.width)) - left, height: Math.max(...runs.map(r => r.y + r.height)) - top }
}
