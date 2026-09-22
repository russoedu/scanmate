import type { GrayImage, ScanmateOrientedRect } from '@scanmate/ink'

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
 * That is all-or-nothing over a whole run, which costs more the longer the run
 * is: one pair of touching letters in a 52-character sentence loses the other
 * fifty. `glyphWords` splits a run at its spaces first - the widest gaps in the
 * same profile - so a sentence is verified word by word and only the word that
 * will not segment is given up.
 *
 * **Direction.** A run's characters advance along the run, which is not always
 * left to right: a form's margin instruction is often printed at a right angle
 * to the page. The profile is taken along whichever axis the run's `angle`
 * says, and quarter turns are the only ones handled - anything between would
 * need the crop resampled, and is left unverifiable instead of guessed at.
 */

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
export function glyphCells (page: GrayImage, dpi: number, run: ScanmateOrientedRect, count: number, options: CellOptions = {}): ScanmateOrientedRect[] | null {
  const profile = profileOf(page, dpi, run, count, options)
  if (profile === null) return null

  const groups = fitGroups(profile.inked, options.join ?? JOIN, count)

  return groups === null ? null : groups.map(group => boxOf(run, profile, group))
}

/**
 * The box of each word of a run, in order, split at the run's own spaces.
 *
 * @param page - The original page, greyscale.
 * @param dpi - What that page was rendered at.
 * @param run - The run's box, in points, with its angle.
 * @param counts - Characters in each word, in order, spaces excluded.
 * @param options - Contrast against the run's paper, column joining, and polarity.
 * @returns One box per word, or `null` when the words cannot be told apart.
 */
export function glyphWords (page: GrayImage, dpi: number, run: ScanmateOrientedRect, counts: readonly number[], options: CellOptions = {}): ScanmateOrientedRect[] | null {
  const total = counts.reduce((sum, count) => sum + count, 0)
  const profile = profileOf(page, dpi, run, total, options)
  if (profile === null) return null
  if (counts.length === 1) return [{ ...run }]

  // The widest gaps are the spaces: as many cuts as the run has spaces.
  const groups = groupsOf(profile.inked, options.join ?? JOIN)
  if (groups.length < counts.length) return null
  const gaps = groups.slice(1)
    .map((group, index) => ({ at: index + 1, gap: group.start - groups[index].end }))
    .toSorted((a, b) => b.gap - a.gap)
    .slice(0, counts.length - 1)
    .map(gap => gap.at)
    .toSorted((a, b) => a - b)

  const words: ScanmateOrientedRect[] = []
  let from = 0
  for (const cut of [...gaps, groups.length]) {
    const first = groups[from]
    const last = groups[cut - 1]
    if (first === undefined || last === undefined) return null
    // A word holding fewer groups than it has characters has glyphs that run
    // together, and nothing inside it can be placed - but that is that word's
    // problem. Its box is still returned, and it is the caller who finds the
    // letters unplaceable, one word at a time.
    words.push(boxOf(run, profile, { start: first.start, end: last.end }))
    from = cut
  }

  return words
}

/**
 * How much ink stands in each step along the run, in the run's own direction.
 *
 * @returns The profile and the frame to read boxes back out of, or `null` when
 *   the run is turned by something other than a quarter turn, or is too small.
 */
function profileOf (page: GrayImage, dpi: number, run: ScanmateOrientedRect, count: number, options: CellOptions): Profile | null {
  const { contrast = CONTRAST, lightOnDark = false } = options
  if (count <= 0) return null

  const turn = Math.round(((run.angle ?? 0) % 360 + 360) % 360 / 90) % 4
  if (Math.abs((((run.angle ?? 0) % 360) + 360) % 360 - turn * 90) > 1) return null
  const along: 'x' | 'y' = turn % 2 === 0 ? 'x' : 'y'
  // A quarter turn one way advances up the page, the other way down.
  const reverse = turn === 2 || turn === 3

  const s = dpi / 72
  const left = Math.max(0, Math.floor(run.x * s))
  const right = Math.min(page.width, Math.ceil((run.x + run.width) * s))
  const top = Math.max(0, Math.floor(run.y * s))
  const bottom = Math.min(page.height, Math.ceil((run.y + run.height) * s))
  const steps = along === 'x' ? right - left : bottom - top
  const across = along === 'x' ? bottom - top : right - left
  if (steps < count || across < 2) return null

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

  const inked: boolean[] = []
  for (let step = 0; step < steps; step++) {
    let dark = 0
    for (let other = 0; other < across; other++) {
      const x = left + (along === 'x' ? step : other)
      const y = top + (along === 'x' ? other : step)
      const difference = lightOnDark ? page.data[y * page.width + x] - paper : paper - page.data[y * page.width + x]
      if (difference > threshold) dark++
    }
    inked.push(dark > 0)
  }

  return { inked: reverse ? inked.toReversed() : inked, along, reverse, left, top, right, bottom, s }
}

interface Profile {
  inked:   boolean[]
  along:   'x' | 'y'
  reverse: boolean
  left:    number
  top:     number
  right:   number
  bottom:  number
  s:       number
}

/** A span of the profile, back in page points. */
function boxOf (run: ScanmateOrientedRect, profile: Profile, group: { start: number, end: number }): ScanmateOrientedRect {
  const steps = profile.along === 'x' ? profile.right - profile.left : profile.bottom - profile.top
  const start = profile.reverse ? steps - 1 - group.end : group.start
  const end = profile.reverse ? steps - 1 - group.start : group.end

  return profile.along === 'x'
    ? { x: (profile.left + start) / profile.s, y: run.y, width: (end - start + 1) / profile.s, height: run.height, angle: run.angle }
    : { x: run.x, y: (profile.top + start) / profile.s, width: run.width, height: (end - start + 1) / profile.s, angle: run.angle }
}

/** The groups of inked steps, closed up until there are exactly `count` of them. */
function fitGroups (inked: readonly boolean[], join: number, count: number): { start: number, end: number }[] | null {
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

  return groups.length === count ? groups : null
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

/**
 * Where every character of a run sits, or `null` where it could not be placed.
 *
 * The whole run is tried first, which is what a figure wants: short, its glyphs
 * separate, and nothing gained by taking it apart. When that fails the run is
 * split at its spaces and each word placed on its own, so one pair of touching
 * letters costs its own word rather than the sentence around it - on the W-9's
 * certification line, two characters rather than fifty-two.
 *
 * @param page - The original page, greyscale.
 * @param dpi - What that page was rendered at.
 * @param run - The run's box, in points, with its angle.
 * @param text - What the run prints; spaces divide the words.
 * @param options - Contrast against the run's paper, column joining, and polarity.
 * @returns One entry per printed character, spaces excluded, or `null` when not
 *   even the words could be told apart.
 */
export function placeGlyphs (page: GrayImage, dpi: number, run: ScanmateOrientedRect, text: string, options: CellOptions = {}): Array<ScanmateOrientedRect | null> | null {
  const characters = [...text].filter(character => character.trim() !== '')
  const whole = glyphCells(page, dpi, run, characters.length, options)
  if (whole !== null) return whole

  const words = text.split(/\s+/).filter(word => word !== '')
  if (words.length < 2) return null
  const boxes = glyphWords(page, dpi, run, words.map(word => [...word].length), options)
  if (boxes === null) return null

  const cells: Array<ScanmateOrientedRect | null> = []
  for (const [index, word] of words.entries()) {
    const letters = [...word].length
    const placed = glyphCells(page, dpi, { ...boxes[index], angle: run.angle }, letters, options)
    for (let letter = 0; letter < letters; letter++) cells.push(placed === null ? null : placed[letter])
  }

  return cells.length === characters.length ? cells : null
}
