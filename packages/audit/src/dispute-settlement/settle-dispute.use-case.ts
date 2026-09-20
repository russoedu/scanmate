import type { InkProbe } from '@scanmate/diff'
import { toGrayscale } from '@scanmate/ink'
import type { GrayImage, Raster, TextRun } from '@scanmate/ink'
import { collectTemplates, judgeRun, printPolarity, readRun, verifyPrintedRun } from '@scanmate/ocr'
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
 *   match this run's glyphs, letters and all
 *          |
 *   every glyph is the one printed? -------------- yes -> misread
 *          | no, or it could not be placed
 *   read both crops, pass for pass
 *          |
 *   the two sides read alike? -------------------- yes -> misread
 *          | no
 *                                                         unsettled
 * ```
 *
 * The glyph match is tried before the re-reading because it is the better
 * instrument and it is cheaper: it asks *are these the same glyphs?* of the ink
 * itself, where re-reading asks an engine to say what it sees and hopes the
 * answer is stable. The page-wide check covers figures only - it is run over
 * every printed run and the rival set for letters is six times larger - so here,
 * on one run somebody is already arguing about, it is run again against letters
 * and digits alike.
 *
 * **It may clear a run; it may not condemn one.** Letters are far more
 * confusable than digits at the size real print arrives in, and the margin that
 * separates a digit from its rivals does not separate a `t` from a `k` or a `g`
 * from a `t`. Swept over every run of four real documents - 327 runs, about
 * 1700 glyph cells - matching against letters called four runs changed that had
 * not changed, roughly one run in eighty, while the honest W-9's own 921 cells
 * produced none. One in eighty is a fine rate for *clearing* a dispute and a
 * disgraceful one for opening an accusation, so a glyph that fails to match
 * sends the run on to the re-reading instead of condemning it. Digits keep
 * their own verdict: the figures check runs over the whole page, its rivals are
 * ten glyphs rather than sixty-two, and it has never made a false call on any
 * scan measured here.
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
  because:    'print-check' | 'ink' | 'glyphs-match' | 'both-sides-alike' | 'sides-disagree' | 'unreadable' | 'not-attempted'
  /** What each pass read off the original's crop, and off the scan's. */
  readings:   { original: string[], scanned: string[] }
  /**
   * Each side read the same thing on every pass, and the two still disagreed.
   *
   * A degraded read wavers - `380.00`, `380.90`, `38O.00` - because the engine
   * is guessing at damaged ink. A substituted glyph does not: it is a different
   * character and reads like one, every time. So a steady disagreement is a
   * stronger signal than an unsteady one, and worth telling apart.
   *
   * It is not proof, which is why it does not change the verdict: a blemish in
   * the same place on every pass reads consistently too. A caller who knows
   * their documents can act on it; this package will not.
   */
  steady:     boolean
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
  /**
   * The original's text layer. Glyph templates are collected from it, so a
   * disputed run can be matched character by character against the faces and
   * sizes the page itself prints. Without it that step is skipped.
   */
  runs?:        readonly TextRun[]
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
    differences, probes, original, scanned, engine, rules, runs = [],
    passes = SETTLEMENT_PASSES, quorum = QUORUM, inkEvidence = INK_EVIDENCE, maxDisputes = 40,
  } = input
  const settlements: Settlement[] = []
  const grey: { original: GrayImage | null, scanned: GrayImage | null } = { original: null, scanned: null }
  let templates: ReturnType<typeof collectTemplates> | null = null
  // The run as the original's text layer has it: the face, the size and the
  // turn, which a difference's bare rectangle does not carry.
  const printed = new Map(runs.map(run => [`${run.text}|${Math.round(run.x)}|${Math.round(run.y)}`, run]))
  let attempted = 0

  for (const [index, difference] of differences.entries()) {
    const none = { original: [], scanned: [] }
    // The glyph check matched this run's ink against the original's own glyphs
    // and found other glyphs. That was seen, not read.
    if (difference.verified === true) {
      settlements.push({ difference, verdict: 'changed', because: 'print-check', readings: none, steady: false })
      continue
    }
    const probe = probes[index]
    if (probe === undefined || probe.addedInk + probe.lostInk >= inkEvidence) {
      settlements.push({ difference, verdict: 'changed', because: 'ink', readings: none, steady: false })
      continue
    }
    // Added and missing runs have nothing on one side to read against.
    if (difference.kind !== 'changed' || difference.expected === null) {
      settlements.push({ difference, verdict: 'unsettled', because: 'not-attempted', readings: none, steady: false })
      continue
    }
    const run = { text: difference.expected, x: difference.x, y: difference.y, width: difference.width, height: difference.height, confidence: null }
    grey.original ??= toGrayscale(original.raster)

    // The glyphs themselves, where the page prints enough of that face to say.
    const asPrinted = printed.get(`${difference.expected}|${Math.round(difference.x)}|${Math.round(difference.y)}`)
    if (asPrinted !== undefined && runs.length > 0) {
      grey.scanned ??= toGrayscale(scanned.raster)
      templates ??= collectTemplates(grey.original, original.dpi, runs)
      // The question here is not "what does this ink say" but "is it what was
      // printed, or what the reading claims instead" - and two named characters
      // answer that, where identifying an unknown glyph needs most of an
      // alphabet. So the ink gets asked the narrower question first, and can
      // settle a dispute either way; measured over three scans of a real
      // document, 16,146 false claims were put to it and none was endorsed,
      // while 507 of 584 pasted digits were caught.
      const claimed = difference.found ?? ''
      const confirmed = claimed === ''
        ? null
        : verifyPrintedRun(grey.original, grey.scanned, original.dpi, asPrinted, templates, { scope: 'confirm', claimed })
      if (confirmed?.verified === true) {
        settlements.push(confirmed.agrees
          ? { difference, verdict: 'misread', because: 'glyphs-match', readings: none, steady: false }
          : { difference, verdict: 'changed', because: 'print-check', readings: none, steady: false })
        continue
      }

      // Failing that, the wider question: does every glyph match what was
      // printed? That can clear a run but never condemn one - letters are
      // confusable enough at print sizes that a failed match is a reason to
      // look, not a verdict.
      const matched = verifyPrintedRun(grey.original, grey.scanned, original.dpi, asPrinted, templates, { scope: 'text' })
      if (matched.verified && matched.agrees) {
        settlements.push({ difference, verdict: 'misread', because: 'glyphs-match', readings: none, steady: false })
        continue
      }
    }

    if (attempted >= maxDisputes) {
      settlements.push({ difference, verdict: 'unsettled', because: 'not-attempted', readings: none, steady: false })
      continue
    }
    attempted++
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
      settlements.push({ difference, verdict: 'misread', because: 'both-sides-alike', readings, steady: false })
      continue
    }

    // Read, but not alike. That is not evidence of a change - the scan is a
    // degraded copy and reads worse than the original by nature - so it is
    // reported as the open question it is.
    const read = readings.original.some(text => text !== '') && readings.scanned.some(text => text !== '')
    settlements.push({
      difference,
      verdict: 'unsettled',
      because: read ? 'sides-disagree' : 'unreadable',
      readings,
      steady:  read && unanimous(readings.original, rules) && unanimous(readings.scanned, rules),
    })
  }

  return settlements
}

/** Every pass on one side read the same thing, and read something. */
function unanimous (readings: readonly string[], rules: MatchOptions): boolean {
  const read = readings.filter(text => text !== '')
  if (read.length < 2) return false

  return read.every(text => judgeRun(read[0], text, rules).agrees)
}
