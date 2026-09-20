import type { GrayImage } from '@scanmate/ink'

/**
 * Where each printed character sits inside a run, found in the original's own
 * rendering rather than guessed from font metrics.
 *
 * A generated PDF renders its glyphs cleanly: between two characters there is a
 * column of paper - whatever the page puts behind the run, white or the colour
 * of a total bar - and the only thing that varies is how wide. So the run's box
 * is read as a column profile - how much ink stands in each column - and the
 * groups of inked columns are the characters, in order. Nothing here needs to
 * know the font, its advance widths, or its kerning, all of which a text layer
 * leaves out and every face does differently.
 *
 * When the groups do not come to the number of characters expected - glyphs
 * that touch, a comma that merges with the digit beside it - the run is left
 * alone rather than guessed at: the caller can only verify what it can place.
 */

/** A rectangle in PDF points from the page's top-left corner. */
export interface Box {
  x:      number
  y:      number
  width:  number
  height: number
}

/**
 * The least a pixel may stand out from the paper around it and still count as
 * print, `0` to `1`. The run's own contrast decides above this.
 *
 * Measured against the run's own background rather than against white, because
 * the paper under a run is whatever the page puts there: white, the grey of a
 * shaded row, or the colour of a total bar.
 */
const CONTRAST = 0.19
/** Columns are grown by this, in pixels, before grouping, so a dotted stem stays one glyph. */
const JOIN = 0

export interface CellOptions {
  /** The least a pixel may stand out from the run's own paper and count as print. Default `0.19`. */
  contrast?:    number
  /** Empty columns that still join two groups into one character. Default `0`. */
  join?:        number
  /** The run is printed light on a dark bar, so its paper is the dark part. */
  lightOnDark?: boolean
}

/**
 * The box of each printed character of a run, left to right.
 *
 * @param page - The original page, greyscale, `0` black to `1` white.
 * @param dpi - What that page was rendered at.
 * @param run - The run's box, in points.
 * @param count - How many characters the run prints, spaces excluded.
 * @param options - Contrast against the run's paper, column joining, and polarity.
 * @returns One box per character, or `null` when they cannot be told apart.
 */
export function glyphCells (page: GrayImage, dpi: number, run: Box, count: number, options: CellOptions = {}): Box[] | null {
  const { contrast = CONTRAST, join = JOIN, lightOnDark = false } = options
  if (count <= 0) return null

  const s = dpi / 72
  const left = Math.max(0, Math.floor(run.x * s))
  const right = Math.min(page.width, Math.ceil((run.x + run.width) * s))
  const top = Math.max(0, Math.floor(run.y * s))
  const bottom = Math.min(page.height, Math.ceil((run.y + run.height) * s))
  if (right - left < count || bottom - top < 2) return null

  // The paper this run is printed on: most of its box is background. How far the
  // glyphs stand from it is the run's own contrast, and half of that separates
  // ink from paper - on white or on the colour of a total bar alike.
  const values: number[] = []
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) values.push(page.data[y * page.width + x])
  const sorted = values.toSorted((a, b) => a - b)
  const paper = sorted[Math.floor(sorted.length / 2)]
  const darkest = sorted[Math.floor(sorted.length * (lightOnDark ? 0.98 : 0.02))]
  const threshold = Math.max(contrast, Math.abs(darkest - paper) / 2)

  // Where ink stands in each column of the run.
  const inked: boolean[] = []
  for (let x = left; x < right; x++) {
    let dark = 0
    for (let y = top; y < bottom; y++) {
      const difference = lightOnDark ? page.data[y * page.width + x] - paper : paper - page.data[y * page.width + x]
      if (difference > threshold) dark++
    }
    inked.push(dark > 0)
  }

  let groups = groupsOf(inked, join)
  // Characters printed in two parts - an i, a colon, a percent sign - read as
  // more groups than there are characters; the narrowest gaps close first.
  while (groups.length > count) {
    const gaps = groups.slice(1).map((group, i) => ({ at: i + 1, gap: group.start - groups[i].end }))
    const narrowest = gaps.toSorted((a, b) => a.gap - b.gap)[0]
    if (narrowest === undefined) break
    groups = [
      ...groups.slice(0, narrowest.at - 1),
      { start: groups[narrowest.at - 1].start, end: groups[narrowest.at].end },
      ...groups.slice(narrowest.at + 1),
    ]
  }
  if (groups.length !== count) return null

  return groups.map(group => ({
    x:      (left + group.start) / s,
    y:      run.y,
    width:  (group.end - group.start + 1) / s,
    height: run.height,
  }))
}

/** Runs of inked columns, separated by more than `join` empty ones. */
function groupsOf (inked: readonly boolean[], join: number): { start: number, end: number }[] {
  const groups: { start: number, end: number }[] = []
  let start = -1
  let last = -1

  for (const [x, dark] of inked.entries()) {
    if (!dark) continue
    if (start === -1) start = x
    else if (x - last - 1 > join) {
      groups.push({ start, end: last })
      start = x
    }
    last = x
  }
  if (start !== -1) groups.push({ start, end: last })

  return groups
}
