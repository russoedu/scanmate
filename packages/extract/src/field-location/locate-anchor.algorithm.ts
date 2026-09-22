import { normaliseText } from '@scanmate/ink'
import type { NormaliseOptions, ScanmateRect, TextRun } from '@scanmate/ink'

import type { AnchorMatch, LocateOptions } from './field-location.contract'

/**
 * Most two runs on one line may be apart, in line heights, and still spell one
 * anchor. Further than that they are two columns - a label and the next one
 * across - not two halves of one label.
 */
export const MAX_WORD_GAP = 4
/** Runs turned further apart than this, in degrees, are never read as one. */
const SAME_ANGLE = 1
const WORD = /\S+/gu
const EDGE_PUNCTUATION = /^\p{P}+|\p{P}+$/gu

interface Vector { x: number, y: number }

/** One word, as the anchor is matched: normalised, its edge punctuation set aside. */
interface Token {
  key:   string
  /** Its characters in the run's text. */
  start: number
  end:   number
}

/**
 * A run in its own reading frame: `u` along its baseline in reading order, `v`
 * down the page as the text reads. A quarter-turned run reads down or up the
 * page, and its next line is beside it rather than below it; in this frame
 * both look as they do for upright text.
 */
interface ReadRun {
  run:    TextRun
  angle:  number
  along:  Vector
  down:   Vector
  u0:     number
  u1:     number
  v0:     number
  v1:     number
  tokens: Token[]
  /** Where the run's printed characters start and end, past any padding spaces. */
  first:  number
  last:   number
}

interface Span { run: number, from: number, to: number }

/**
 * Every place `anchor` is printed among one page's runs, top to bottom.
 *
 * Runs are joined as they are read: a run may continue into the next run on
 * its line, or - for a label that wraps - into the first run of the next line
 * that sits under it. Matching is by whole words, compared after the suite's
 * normalisation with the punctuation at their edges set aside, so `'Signature'`
 * finds `Signature:` and `'Date'` never finds `Update`.
 */
export function locateAnchor (runs: readonly TextRun[], anchor: string, options: LocateOptions = {}): AnchorMatch[] {
  const { normalise, lineTolerance = 2, lineSpacing = 1.8 } = options
  const target = keys(anchor, normalise)
  if (target.length === 0) return []

  const read = runs.map(run => readRun(run, normalise))
  const successors = new Map<number, number[]>()
  const next = (index: number): number[] => {
    let found = successors.get(index)
    if (found === undefined) {
      found = followers(read, index, lineTolerance, lineSpacing)
      successors.set(index, found)
    }

    return found
  }

  const matches: AnchorMatch[] = []
  for (const [index, run] of read.entries())
    for (const [start, token] of run.tokens.entries()) {
      if (token.key !== target[0]) continue
      const spans = spell(read, next, target, index, start, 0)
      if (spans !== null) matches.push(boxOf(read, spans))
    }

  return matches.toSorted((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
}

/** The normalised words of `text`, as they are compared. */
function keys (text: string, normalise: NormaliseOptions | undefined): string[] {
  return normaliseText(text, normalise).split(' ').map(word => word.replaceAll(EDGE_PUNCTUATION, '')).filter(word => word !== '')
}

function readRun (run: TextRun, normalise: NormaliseOptions | undefined): ReadRun {
  const angle = run.angle ?? 0
  const radians = angle * Math.PI / 180
  const along = { x: Math.cos(radians), y: Math.sin(radians) }
  const down = { x: -along.y, y: along.x }
  const corners = [
    { x: run.x, y: run.y },
    { x: run.x + run.width, y: run.y },
    { x: run.x, y: run.y + run.height },
    { x: run.x + run.width, y: run.y + run.height },
  ]
  const us = corners.map(c => dot(c, along))
  const vs = corners.map(c => dot(c, down))

  const tokens: Token[] = []
  for (const word of run.text.matchAll(WORD)) {
    const end = word.index + word[0].length
    const words = keys(word[0], normalise)
    for (const key of words) tokens.push({ key, start: word.index, end })
  }

  return {
    run,
    angle,
    along,
    down,
    u0:    Math.min(...us),
    u1:    Math.max(...us),
    v0:    Math.min(...vs),
    v1:    Math.max(...vs),
    tokens,
    first: run.text.length - run.text.trimStart().length,
    last:  run.text.trimEnd().length,
  }
}

/**
 * The runs an anchor may continue into from the end of run `index`: the
 * nearest run after it on its line, and the first run of the next line that
 * sits under it. At most one of each, so no run is ever skipped over.
 */
function followers (read: readonly ReadRun[], index: number, tolerance: number, spacing: number): number[] {
  const from = read[index]
  const height = from.v1 - from.v0
  let sameLine: number | undefined
  const below: number[] = []

  for (const [other, to] of read.entries()) {
    if (other === index || to.tokens.length === 0 || !parallel(from.angle, to.angle)) continue
    const drop = to.v0 - from.v0
    const gap = to.u0 - from.u1
    if (Math.abs(drop) <= tolerance) {
      if (gap >= -tolerance && gap <= MAX_WORD_GAP * height && (sameLine === undefined || to.u0 < read[sameLine].u0)) sameLine = other
    } else if (drop > tolerance && drop <= spacing * height && to.u0 <= from.u1 && to.u1 >= from.u0) {
      below.push(other)
    }
  }

  const found = sameLine === undefined ? [] : [sameLine]
  if (below.length > 0) {
    // The next line is the nearest one down; on it, the run that starts first.
    const line = Math.min(...below.map(b => read[b].v0))
    const onLine = below.filter(b => read[b].v0 - line <= tolerance)
    found.push(onLine.reduce((a, b) => (read[b].u0 < read[a].u0 ? b : a)))
  }

  return found
}

/** The runs and words spelling `target` from its `matched`th word, starting at word `start` of run `index`; `null` if they do not. */
function spell (read: readonly ReadRun[], next: (index: number) => number[], target: readonly string[], index: number, start: number, matched: number): Span[] | null {
  const { tokens } = read[index]
  let at = start
  let count = matched
  while (at < tokens.length && count < target.length) {
    if (tokens[at].key !== target[count]) return null
    at++
    count++
  }

  const span: Span = { run: index, from: start, to: at - 1 }
  if (count === target.length) return [span]
  // The run ran out first: the anchor carries on into whatever follows it.
  for (const follower of next(index)) {
    const rest = spell(read, next, target, follower, 0, count)
    if (rest !== null) return [span, ...rest]
  }

  return null
}

/** The box around the words spelt, and whether any edge of it was estimated. */
function boxOf (read: readonly ReadRun[], spans: readonly Span[]): AnchorMatch {
  let estimated = false
  const boxes = spans.map(({ run, from, to }) => {
    const r = read[run]
    const start = r.tokens[from].start
    const end = r.tokens[to].end
    if (start <= r.first && end >= r.last) return { x: r.run.x, y: r.run.y, width: r.run.width, height: r.run.height }

    estimated = true

    return part(r, start, end)
  })

  return { box: union(boxes), estimated }
}

/** Characters `start..end` of a run, placed in proportion to their count. */
function part (r: ReadRun, start: number, end: number): ScanmateRect {
  const length = r.run.text.length
  const u0 = r.u0 + (r.u1 - r.u0) * start / length
  const u1 = r.u0 + (r.u1 - r.u0) * end / length
  const corners = [[u0, r.v0], [u1, r.v0], [u0, r.v1], [u1, r.v1]].map(([u, v]) => ({
    x: r.along.x * u + r.down.x * v,
    y: r.along.y * u + r.down.y * v,
  }))

  return bounds(corners)
}

function bounds (points: readonly Vector[]): ScanmateRect {
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)

  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top }
}

function union (boxes: readonly ScanmateRect[]): ScanmateRect {
  return bounds(boxes.flatMap(b => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y + b.height }]))
}

function parallel (a: number, b: number): boolean {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180) <= SAME_ANGLE
}

function dot (p: Vector, axis: Vector): number {
  return p.x * axis.x + p.y * axis.y
}
