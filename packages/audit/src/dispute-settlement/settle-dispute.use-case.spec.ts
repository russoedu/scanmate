import type { InkProbe } from '@scanmate/diff'
import { createSyntheticDocument, drawLabel } from '@scanmate/ink'
import { DEFAULT_NORMALISE } from '@scanmate/ink'
import type { MatchOptions, OcrEngine, RecognisedText, TextDifference } from '@scanmate/ocr'

import { settleDisputes } from './settle-dispute.use-case'

const RULES: MatchOptions = { normalise: DEFAULT_NORMALISE, matchThreshold: 0.8, minWordConfidence: 60 }
const RUN = { text: 'Account 4412-9087-3355', x: 40, y: 40, width: 140, height: 12 }

/** A page with the run printed on it, so a crop of that box has something in it. */
function paper (text: string) {
  const page = createSyntheticDocument({ width: 400, height: 200, seed: 2 })
  drawLabel(page.raster, text, { x: RUN.x, y: RUN.y + 2 }, { scale: 2 })

  return { raster: page.raster, dpi: 72 }
}

const DIFFERENCE: TextDifference = {
  kind:       'changed',
  expected:   RUN.text,
  found:      'Account 4472-9081-3356',
  similarity: 0.86,
  reason:     'numbers',
  verified:   false,
  ...RUN,
}

const NO_INK: InkProbe = { rect: RUN, addedInk: 0.02, lostInk: 0.01, sharedInk: 14 }

/**
 * An engine that reads out a script, one entry per call. `settleDisputes` reads
 * the original's passes first and the scan's second, so the script is the
 * original's readings followed by the scan's.
 */
function scripted (readings: readonly string[]): OcrEngine & { readonly count: () => number } {
  let calls = 0

  return {
    name:      'scripted',
    version:   '1',
    languages: ['eng'],
    count:     () => calls,
    async recognise (): Promise<RecognisedText> {
      const text = readings[calls++] ?? ''

      return { text, confidence: 90, lines: [{ text, words: [] }] }
    },
    async terminate (): Promise<void> {},
  }
}

async function settle (engine: OcrEngine, probe: InkProbe = NO_INK, difference = DIFFERENCE) {
  const [settlement] = await settleDisputes({
    differences: [difference],
    probes:      [probe],
    original:    paper(RUN.text),
    scanned:     paper(RUN.text),
    engine,
    rules:       RULES,
  })

  return settlement
}

describe('settleDisputes', () => {
  it('clears a misreading when both sides read alike', async () => {
    // Three passes each side, all misreading the same way: a systematic error,
    // which is what an unchanged page looks like to an engine that cannot read it.
    const wrong = 'Account 4472-9081-3356'
    const settlement = await settle(scripted([wrong, wrong, wrong, wrong, wrong, wrong]))

    expect(settlement).toMatchObject({ verdict: 'misread', because: 'both-sides-alike' })
  })

  it('does not call a run changed merely because the original reads better', async () => {
    // The original is a clean render and the scan has been printed and scanned,
    // so it reads worse by nature. That is degradation, not evidence.
    const settlement = await settle(scripted([RUN.text, RUN.text, RUN.text, 'Account 4412-9987-3355', 'Account 4412-9987-3355', 'Account 4412-9987-3355']))

    expect(settlement).toMatchObject({ verdict: 'unsettled', because: 'sides-disagree' })
  })

  it('reports a dispute neither side can settle, rather than guessing', async () => {
    // Every pass reads something different: the engine cannot read this at all,
    // so nothing here is evidence either way.
    const settlement = await settle(scripted(['Acc 4412', 'Account 44l2-9O87', '', 'Accoun 4472', 'A 4472-9081', '']))

    expect(settlement).toMatchObject({ verdict: 'unsettled', because: 'sides-disagree' })
  })

  it('marks a disagreement steady when each side read the same thing every time', async () => {
    // What a substituted glyph looks like: neither side wavers, and they differ.
    const printed = 'Account 4412-9087-3355'
    const altered = 'Account 4412-9987-3355'
    const settlement = await settle(scripted([printed, printed, printed, altered, altered, altered]))

    expect(settlement).toMatchObject({ verdict: 'unsettled', because: 'sides-disagree', steady: true })
  })

  it('does not mark a wandering disagreement steady', async () => {
    // What a degraded read looks like: the engine guesses differently each pass.
    const settlement = await settle(scripted(['Account 4412-9087-3355', 'Account 44l2-9087-3355', 'Account 4412-9O87-3355', 'Accoun 4472', 'A 4472-9081', 'Account 4472-9081-3356']))

    expect(settlement).toMatchObject({ verdict: 'unsettled', steady: false })
  })

  it('says so when a side could not be read at all', async () => {
    const settlement = await settle(scripted(['', '', '', 'Accoun 4472', 'A 4472-9081', '']))

    expect(settlement).toMatchObject({ verdict: 'unsettled', because: 'unreadable' })
  })

  it('does not re-read when the glyph check already saw other glyphs', async () => {
    const engine = scripted([])
    const settlement = await settle(engine, NO_INK, { ...DIFFERENCE, verified: true })

    expect(settlement).toMatchObject({ verdict: 'changed', because: 'print-check' })
    expect(engine.count()).toBe(0)
  })

  it('does not re-read when the ink itself moved', async () => {
    const engine = scripted([])
    const settlement = await settle(engine, { ...NO_INK, addedInk: 1.4 })

    expect(settlement).toMatchObject({ verdict: 'changed', because: 'ink' })
    expect(engine.count()).toBe(0)
  })

  it('leaves a run it cannot re-read unsettled rather than dropping it', async () => {
    const engine = scripted([])
    const settlement = await settle(engine, NO_INK, { ...DIFFERENCE, kind: 'added', expected: null })

    expect(settlement).toMatchObject({ verdict: 'unsettled', because: 'not-attempted' })
  })
})
