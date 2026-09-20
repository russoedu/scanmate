import type { InkProbe } from '@scanmate/diff'
import { createRaster, drawLabel, labelSize } from '@scanmate/ink'
import type { Raster } from '@scanmate/ink'
import { DEFAULT_NORMALISE } from '@scanmate/ocr'
import type { MatchOptions, OcrEngine, PrintedRun, RecognisedText, TextDifference } from '@scanmate/ocr'

import { settleDisputes } from './settle-dispute.use-case'

/**
 * A page printed in `@scanmate/ink`'s bitmap font, at 72 dpi so a point is a
 * pixel. The lines above the run under test are there to be harvested for
 * glyph templates: the check will not speak about a run unless the page prints
 * enough of that face elsewhere to give every rival something to match.
 */
const SCALE = 2
const LINES = [
  'ABCDEFGHIJKLM',
  'NOPQRSTUVWXYZ',
  'ABCDEFGHIJKLM',
  'NOPQRSTUVWXYZ',
  'THE QUICK BROWN FOX',
  'JUMPS OVER A DOG',
]
const TARGET = 'PAID IN FULL'
const LINE_HEIGHT = 20

function page (target = TARGET): { raster: Raster, runs: PrintedRun[] } {
  const raster = createRaster(400, (LINES.length + 2) * LINE_HEIGHT)
  raster.data.fill(255)
  const runs: PrintedRun[] = []
  for (const [index, text] of [...LINES, target].entries()) {
    const at = { x: 10, y: 10 + index * LINE_HEIGHT }
    drawLabel(raster, text, at, { scale: SCALE })
    const size = labelSize(text, { scale: SCALE })
    runs.push({ text, x: at.x, y: at.y, width: size.width, height: size.height, fontName: 'bitmap', fontSize: 7 })
  }

  return { raster, runs }
}

const RULES: MatchOptions = { normalise: DEFAULT_NORMALISE, matchThreshold: 0.8, minWordConfidence: 60 }

/** An engine that reads nothing useful, so only the glyphs can settle anything. */
const MUTE: OcrEngine = {
  name:      'mute',
  version:   '1',
  languages: ['eng'],
  async recognise (): Promise<RecognisedText> {
    return { text: '', confidence: 0, lines: [] }
  },
  async terminate (): Promise<void> {},
}

async function settle (scan: Raster, original: ReturnType<typeof page>) {
  const run = original.runs.at(-1)!
  const difference: TextDifference = {
    kind:       'changed',
    expected:   run.text,
    found:      'PA1D 1N FULL',
    similarity: 0.83,
    reason:     'numbers',
    verified:   false,
    x:          run.x,
    y:          run.y,
    width:      run.width,
    height:     run.height,
  }
  const probe: InkProbe = { rect: difference, addedInk: 0.02, lostInk: 0.01, sharedInk: 9 }
  const [settlement] = await settleDisputes({
    differences: [difference],
    probes:      [probe],
    original:    { raster: original.raster, dpi: 72 },
    scanned:     { raster: scan, dpi: 72 },
    engine:      MUTE,
    rules:       RULES,
    runs:        original.runs,
  })

  return settlement
}

describe('settleDisputes, matching glyphs', () => {
  it('clears a dispute when every glyph is the one the original prints', async () => {
    const original = page()
    const settlement = await settle(original.raster, original)

    expect(settlement).toMatchObject({ verdict: 'misread', because: 'glyphs-match' })
  })

  it('does not condemn a run when a glyph fails to match', async () => {
    // Letters are confusable enough at print sizes that a failed match is a
    // reason to look, not a verdict: measured over four real documents it
    // called about one run in eighty changed that had not changed.
    const original = page()
    const scan = page('PAID IN FVLL').raster
    const settlement = await settle(scan, original)

    expect(settlement.verdict).not.toBe('changed')
    expect(settlement.verdict).toBe('unsettled')
  })
})
