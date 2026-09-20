import type { Change, ExpectedResult, PageDiff } from '@scanmate/diff'
import type { ScanmateRect } from '@scanmate/ink'
import type { TextDifference } from '@scanmate/ocr'

import type { Settlement } from '../dispute-settlement'
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
  /** Differences settled as misreadings: the print is identical, the reading was not. */
  noise:     TextDifference[]
}

export interface CorrelationInput {
  /** The text differences of the page, in points. */
  text:     readonly TextDifference[]
  /** The pixel comparison of the page, with rectangles in points. */
  pixels:   Pick<PageDiff, 'expected' | 'unexpected' | 'missing'>
  /**
   * How each text difference the pixels did not account for was settled, from
   * `settleDisputes`. A difference with no settlement is reported as it stands.
   */
  settled?: readonly Settlement[]
}

/** Points of slack when deciding two boxes are at the same place. */
const SLACK = 1.5

export function correlateFindings ({ text, pixels, settled = [] }: CorrelationInput): Correlation {
  const explained: ExplainedDifference[] = []
  const open: TextDifference[] = []
  for (const difference of text) {
    const region = explanation(difference, pixels.expected)
    if (region === null) open.push(difference)
    else explained.push({ difference, region })
  }

  const used = new Set<TextDifference>()
  const claim = (box: ScanmateRect, kinds: ReadonlyArray<TextDifference['kind']>): TextDifference[] => {
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
  // What the pixels did not see, as the settlement decided it: a change the ink
  // or the glyph check confirmed, a misreading the two sides' own readings
  // agreed on, or an argument neither could settle - which is reported too,
  // because "we could not tell" is not the same as "nothing happened".
  const noise: TextDifference[] = []
  const verdicts = new Map(settled.map(settlement => [settlement.difference, settlement]))
  for (const difference of open) {
    if (used.has(difference)) continue
    const settlement = verdicts.get(difference)
    if (settlement?.verdict === 'misread') noise.push(difference)
    else findings.push(textFinding(difference, settlement))
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

function textFinding (difference: TextDifference, settlement?: Settlement): AuditFinding {
  const unsettled = settlement?.verdict === 'unsettled'
  const KINDS = { changed: 'text-changed', missing: 'text-missing', added: 'text-added' } as const
  const kind = unsettled ? 'text-unsettled' : KINDS[difference.kind]
  const summary = difference.kind === 'changed'
    ? `Printed "${difference.expected}" reads "${difference.found}"${difference.reason === 'numbers' ? ' - its figures differ' : ''}`
    : (difference.kind === 'missing' ? `Printed "${difference.expected}" could not be read` : `Words the original does not have: "${difference.found}"`)

  return {
    kind,
    box:          boxOf(difference),
    corroborated: false,
    summary:      unsettled ? `${summary} - the ink is identical and re-reading could not settle it${settlement?.steady ?? false ? ', though each side read the same thing every time' : ''}` : summary,
    text:         [difference],
    pixels:       null,
  }
}

function boxOf (r: ScanmateRect): ScanmateRect {
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

function overlaps (a: ScanmateRect, b: ScanmateRect): boolean {
  return a.x < b.x + b.width + SLACK && a.x + a.width + SLACK > b.x && a.y < b.y + b.height + SLACK && a.y + a.height + SLACK > b.y
}

/** Share of `a`'s area inside `b`. */
function share (a: ScanmateRect, b: ScanmateRect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  const area = a.width * a.height

  return area === 0 || width <= 0 || height <= 0 ? 0 : (width * height) / area
}
