import type { InkProbe } from '@scanmate/diff'
import { toGrayscale } from '@scanmate/ink'
import type { Raster } from '@scanmate/ink'
import { judgeRun, printPolarity, readRun } from '@scanmate/ocr'
import type { MatchOptions, OcrEngine, RecheckPass, TextDifference } from '@scanmate/ocr'

/**
 * Settling an argument between the reading and the pixels.
 *
 * The two comparisons see different things and neither is authoritative. The
 * reading says a run changed; the ink at that very run says nothing moved.
 * Reporting it would put a red box over text a reviewer can see is identical -
 * and OCR mangles small, faint and sideways print constantly, so that is the
 * common case, not the rare one. Dropping it would mean a change that moved
 * almost no ink went unreported - and a printed digit replaced by another of
 * the same size moves about 0.11 mm2, which is almost no ink.
 *
 * So neither answer is taken on trust. The dispute is settled by a third
 * measurement, and the measurement is a controlled one: read the *original's*
 * crop and the *scan's* crop the same way, with the same passes, and compare
 * the two readings **to each other** rather than to the text layer.
 *
 * That is what makes it evidence rather than another opinion. A systematic
 * misreading - a face, a size, a resolution the engine handles badly - misreads
 * the original exactly as it misreads the scan, so it cancels: both sides come
 * back wrong in the same way, and wrong in the same way means the same glyphs.
 * A real change does not cancel, because only one side carries it.
 *
 * ```text
 *   reading disagrees
 *          |
 *   the print check saw other glyphs? ------------ yes -> changed
 *          | no
 *   ink moved at this run (>= 0.3 mm2)? ---------- yes -> changed
 *          | no
 *   read both crops, pass for pass
 *          |
 *   the two sides read alike? -------------------- yes -> misread
 *          | no
 *                                                         unsettled
 * ```
 *
 * Only agreement between the sides clears a run; disagreement never condemns
 * one. That asymmetry is deliberate, and it is the correction of an earlier
 * version of this table which also asked *does the original's crop read as
 * printed?* and called the run changed when it did. It reads as printed almost
 * always - the original is a clean render and the scan has been through a
 * printer, a sheet of paper and a scanner - so that branch turned ordinary
 * degradation into an accusation. Measured on the returned W-9: of three runs
 * it called changed, two were `I am` read as `1am` and `FormW9` read as
 * `FormW3.`, and nothing whatever had happened to either.
 *
 * So a disagreement neither side can resolve is reported as exactly that.
 * "Neither could settle it" is a real answer: the alternative is to keep
 * changing the reading until the two agree, which finds agreement whether or
 * not it is there. That failure is measured too - on a 93 dpi scan, accepting a
 * run on a single agreeing pass cleared 4 of 61 forged digits.
 *
 * What this leaves uncovered is a change too small to move 0.3 mm2 of ink in a
 * run the glyph check does not cover - it checks figures, not letters. Such a
 * run lands in `unsettled`, which is a finding, so it is looked at rather than
 * dismissed.
 */

/** Ink at a run, in mm2, below which the print counts as identical. */
export const INK_EVIDENCE = 0.3
/** Readings that must agree before either side of the comparison is believed. */
export const QUORUM = 2
/**
 * How each side is read. Fewer passes than a recheck, and deliberately not the
 * same ones: a run reaching here has already survived the recheck's six, so
 * repeating them would ask a question that has been answered.
 */
export const SETTLEMENT_PASSES: readonly RecheckPass[] = [
  { dpi: 400, layout: 'line' },
  { dpi: 400, layout: 'line', stretch: true },
  { dpi: 600, layout: 'line', stretch: true },
]

export type Verdict = 'changed' | 'misread' | 'unsettled'

export interface Settlement {
  difference: TextDifference
  verdict:    Verdict
  /** What settled it, in one word, for the report to quote. */
  because:    'print-check' | 'ink' | 'both-sides-alike' | 'sides-disagree' | 'unreadable' | 'not-attempted'
  /** What each pass read off the original's crop, and off the scan's. */
  readings:   { original: string[], scanned: string[] }
}

export interface SettlementInput {
  /** The differences the pixels did not already account for. */
  differences:  readonly TextDifference[]
  /** The ink at each difference's own box, in the same order. */
  probes:       readonly InkProbe[]
  /** The original page and the scan aligned onto it. */
  original:     { raster: Raster, dpi: number }
  scanned:      { raster: Raster, dpi: number }
  /** The engine to re-read disputed runs with. */
  engine:       OcrEngine
  /** The matching rules the page was judged by, so the same rule settles it. */
  rules:        MatchOptions
  /** How each side is read. Default {@link SETTLEMENT_PASSES}. */
  passes?:      readonly RecheckPass[]
  /** Readings that must agree before a side is believed. Default `2`. */
  quorum?:      number
  /** Ink at a run, in mm2, at or above which the print has moved. Default `0.3`. */
  inkEvidence?: number
  /** Disputes to settle by re-reading before giving up; the rest are unsettled. Default `40`. */
  maxDisputes?: number
}

export async function settleDisputes (input: SettlementInput): Promise<Settlement[]> {
  const {
    differences, probes, original, scanned, engine, rules,
    passes = SETTLEMENT_PASSES, quorum = QUORUM, inkEvidence = INK_EVIDENCE, maxDisputes = 40,
  } = input
  const settlements: Settlement[] = []
  const grey = { original: null as ReturnType<typeof toGrayscale> | null }
  let attempted = 0

  for (const [index, difference] of differences.entries()) {
    const none = { original: [], scanned: [] }
    // The glyph check matched this run's ink against the original's own glyphs
    // and found other glyphs. That was seen, not read.
    if (difference.verified === true) {
      settlements.push({ difference, verdict: 'changed', because: 'print-check', readings: none })
      continue
    }
    const probe = probes[index]
    if (probe === undefined || probe.addedInk + probe.lostInk >= inkEvidence) {
      settlements.push({ difference, verdict: 'changed', because: 'ink', readings: none })
      continue
    }
    // Added and missing runs have nothing on one side to read against.
    if (difference.kind !== 'changed' || difference.expected === null) {
      settlements.push({ difference, verdict: 'unsettled', because: 'not-attempted', readings: none })
      continue
    }
    if (attempted >= maxDisputes) {
      settlements.push({ difference, verdict: 'unsettled', because: 'not-attempted', readings: none })
      continue
    }

    attempted++
    const run = { text: difference.expected, x: difference.x, y: difference.y, width: difference.width, height: difference.height, confidence: null }
    grey.original ??= toGrayscale(original.raster)
    const polarity = printPolarity(grey.original, original.dpi, run)
    const readings = {
      original: await readRun(engine, original, run, { ...rules, passes }, polarity),
      scanned:  await readRun(engine, scanned, run, { ...rules, passes }, polarity),
    }

    const alike = readings.original.filter((text, pass) => {
      const other = readings.scanned[pass]

      return other !== undefined && text !== '' && judgeRun(text, other, rules).agrees
    }).length
    if (alike >= quorum) {
      settlements.push({ difference, verdict: 'misread', because: 'both-sides-alike', readings })
      continue
    }

    // Read, but not alike. That is not evidence of a change - the scan is a
    // degraded copy and reads worse than the original by nature - so it is
    // reported as the open question it is.
    const read = readings.original.some(text => text !== '') && readings.scanned.some(text => text !== '')
    settlements.push({ difference, verdict: 'unsettled', because: read ? 'sides-disagree' : 'unreadable', readings })
  }

  return settlements
}
