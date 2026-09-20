import type { Change, ExpectedResult, InkProbe, PageDiff } from '@scanmate/diff'
import type { ContentResult } from '@scanmate/find'
import type { Rect } from '@scanmate/ink'
import type { TextDifference } from '@scanmate/ocr'

import type { AuditFinding, ExplainedDifference } from './audit-finding.contract'

/**
 * One list of findings from two comparisons that see different things.
 *
 * The pixel comparison sees ink: a signature, a stamp, a struck-out clause, a
 * paragraph gone. It cannot see a 3 become an 8 - the new glyph stays within
 * the tolerance band of the old. The text comparison sees exactly that, and
 * cannot see a mark that is not writing. So each is kept, and where both saw
 * something at the same place they become one finding, corroborated.
 *
 * Two kinds of text difference are explained rather than reported. Words read
 * inside an expected region are that region's expected ink - a signature read
 * as "Ae dhe". And a printed run under a region that was filled in reads
 * differently because someone wrote across it; the region itself carries the
 * finding that matters.
 */

export interface Correlation {
  findings:  AuditFinding[]
  explained: ExplainedDifference[]
  /** Differences the ink says are not differences: the print is identical, the reading was not. */
  noise:     TextDifference[]
}

export interface CorrelationInput {
  /** The text differences of the page, in points. */
  text:     readonly TextDifference[]
  /** The pixel comparison of the page, with rectangles in points. */
  pixels:   Pick<PageDiff, 'expected' | 'unexpected' | 'missing'>
  /** Required content checked on this page, if any. */
  content?: readonly ContentResult[]
  /**
   * The ink measured at each text difference's own box, in the same order as
   * `text`. Where the ink is identical, the characters are identical however
   * they were read, and the difference is set aside as noise.
   */
  probes?:  readonly InkProbe[]
}

/** Points of slack when deciding two boxes are at the same place. */
const SLACK = 1.5

/**
 * Ink at a text difference, in square millimetres, below which the print is
 * taken to be identical. A glyph of 9 pt text covers roughly 1 mm2, so a
 * changed character moves several times this; scanner grain does not.
 */
const INK_EVIDENCE = 0.3

export function correlateFindings ({ text, pixels, content = [], probes = [] }: CorrelationInput): Correlation {
  const explained: ExplainedDifference[] = []
  const open: TextDifference[] = []
  for (const difference of text) {
    const region = explanation(difference, pixels.expected)
    if (region === null) open.push(difference)
    else explained.push({ difference, region })
  }

  const used = new Set<TextDifference>()
  const claim = (box: Rect, kinds: ReadonlyArray<TextDifference['kind']>): TextDifference[] => {
    const hits = open.filter(d => !used.has(d) && kinds.includes(d.kind) && overlaps(d, box))
    for (const hit of hits) used.add(hit)

    return hits
  }

  const findings: AuditFinding[] = []
  for (const change of pixels.unexpected) {
    const words = claim(change, ['added', 'changed'])
    findings.push(pixelFinding('unexpected-mark', change, words, words.length > 0
      ? `Ink added where nothing was expected, reading "${words.map(w => w.found).join(' ')}"`
      : `Ink added where nothing was expected (${change.inkArea.toFixed(1)} mm2)`))
  }
  for (const change of pixels.missing) {
    const words = claim(change, ['missing', 'changed'])
    findings.push(pixelFinding('missing-ink', change, words, words.length > 0
      ? `Printed ink lost, and with it "${words.map(w => w.expected).join(' ')}"`
      : `Printed ink lost (${change.inkArea.toFixed(1)} mm2)`))
  }
  // What the pixels did not see. A difference the print check *saw* - the scan's
  // ink matched against the original's own glyphs, and found to be other glyphs -
  // stands on its own. Every other one is a reading, and a reading needs the ink
  // to agree that something changed: identical ink under a word means identical
  // print, and a reading that disagrees with identical print is a misreading,
  // which is most of what OCR does to small, faint or sideways type.
  const noise: TextDifference[] = []
  for (const difference of open) {
    if (used.has(difference)) continue
    const probe = probes[text.indexOf(difference)]
    const changedInk = probe === undefined || probe.addedInk + probe.lostInk >= INK_EVIDENCE
    if (changedInk || difference.verified === true) findings.push(textFinding(difference))
    else noise.push(difference)
  }

  for (const region of pixels.expected) {
    if (region.identified) continue
    findings.push({
      kind:         region.overfilled ? 'expected-overfilled' : 'expected-empty',
      box:          boxOf(region),
      corroborated: false,
      summary:      region.overfilled ? `"${region.id}" is covered, not filled in` : `"${region.id}" was left empty`,
      text:         [],
      pixels:       region,
      subject:      region.id,
    })
  }

  for (const result of content) {
    if (result.identifiable) continue
    const missing = !result.found
    const box = result.occurrences.find(o => !o.intact)?.box ?? result.box

    // The same misreading already found at that place: one finding, which now
    // also says the content was required.
    const same = box === null ? undefined : findings.find(f => f.box !== null && f.subject === undefined && f.kind !== 'unexpected-mark' && overlaps(f.box, box))
    if (same !== undefined) {
      same.subject = result.content
      same.summary += ' - required content'
      continue
    }

    findings.push({
      kind:         missing ? 'content-missing' : 'content-not-identifiable',
      box,
      corroborated: false,
      summary:      missing
        ? `Required "${result.content}" is not on the page${result.foundOnPages.length > 0 ? ` (found on page ${result.foundOnPages.join(', ')})` : ''}`
        : `Required "${result.content}" does not read correctly everywhere the original prints it`,
      text:    [],
      pixels:  null,
      subject: result.content,
    })
  }

  return { findings, explained, noise }
}

/** The expected region that accounts for a text difference, or `null`. */
function explanation (difference: TextDifference, regions: readonly ExpectedResult[]): string | null {
  for (const region of regions) {
    if (difference.kind === 'added' && share(difference, region) >= 0.5) return region.id
    if (difference.kind !== 'added' && region.identified && overlaps(difference, region)) return region.id
  }

  return null
}

function pixelFinding (kind: 'unexpected-mark' | 'missing-ink', change: Change, words: TextDifference[], summary: string): AuditFinding {
  return { kind, box: boxOf(change), corroborated: words.length > 0, summary, text: words, pixels: change }
}

function textFinding (difference: TextDifference): AuditFinding {
  const kind = difference.kind === 'changed' ? 'text-changed' : (difference.kind === 'missing' ? 'text-missing' : 'text-added')
  const summary = difference.kind === 'changed'
    ? `Printed "${difference.expected}" reads "${difference.found}"${difference.reason === 'numbers' ? ' - its figures differ' : ''}`
    : (difference.kind === 'missing' ? `Printed "${difference.expected}" could not be read` : `Words the original does not have: "${difference.found}"`)

  return { kind, box: boxOf(difference), corroborated: false, summary, text: [difference], pixels: null }
}

function boxOf (r: Rect): Rect {
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

function overlaps (a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width + SLACK && a.x + a.width + SLACK > b.x && a.y < b.y + b.height + SLACK && a.y + a.height + SLACK > b.y
}

/** Share of `a`'s area inside `b`. */
function share (a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  const area = a.width * a.height

  return area === 0 || width <= 0 || height <= 0 ? 0 : (width * height) / area
}
