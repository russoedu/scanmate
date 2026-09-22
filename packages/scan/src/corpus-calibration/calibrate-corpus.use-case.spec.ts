import type { AuditReport } from '@scanmate/audit'
import type { ReadablePage } from '@scanmate/ink'
import type { OcrEngine } from '@scanmate/ocr'

import type { ScanmateOptions } from '../session-contract'
import { calibrateCorpus } from './calibrate-corpus.use-case'
import type { CalibrationCase } from './corpus-calibration.contract'

/** An audit of one page with a given text score and, optionally, one digit read differently. */
function report (score: number, forged: boolean): AuditReport<ReadablePage> {
  const findings = forged ? [{ kind: 'text-changed', pixels: null, text: [{}] }] : []

  return {
    pages: [{ audit: { page: 1, verdict: forged || score < 0.85 ? 'review' : 'pass', text: { score }, findings } }],
  } as unknown as AuditReport<ReadablePage>
}

const terminate = vi.fn()
const ENGINE = { terminate } as unknown as OcrEngine

async function * lateCases (): AsyncGenerator<CalibrationCase> {
  await Promise.resolve()
  yield { id: 'late', genuine: true, original: 'l.pdf', scanned: 'l.pdf' }
}

describe('calibrateCorpus', () => {
  it('audits each document in its own session, one at a time, and measures the corpus', async () => {
    const outcomes = new Map<unknown, AuditReport<ReadablePage>>([['a', report(0.97, false)], ['b', report(0.97, true)], ['c', report(0.8, false)]])
    let open = 0
    let most = 0
    const given: ScanmateOptions[] = []
    const corpus: CalibrationCase[] = [
      { id: 'a', genuine: true, original: 'a.pdf', scanned: 'a' },
      { id: 'b', genuine: false, original: 'b.pdf', scanned: 'b', expected: [{ page: 1, id: 'sig', x: 1, y: 1, width: 5, height: 5 }] },
      { id: 'c', genuine: true, original: 'c.pdf', scanned: 'c' },
    ]
    const done: string[] = []

    const { samples, report: measured } = await calibrateCorpus(corpus, {
      engine: ENGINE,
      audit:  { minTextScore: 0.85 },
      grid:   { minTextScore: [0.75, 0.85], minChangeArea: [1], minMissingArea: [4] },
      onCase: ({ id }) => {
        done.push(id)
      },
    }, (_original, scanned, options) => {
      given.push(options)
      open++
      most = Math.max(most, open)

      return {
        audit: async () => {
          await Promise.resolve()

          const outcome = outcomes.get(scanned)
          if (outcome === undefined) throw new Error('no such case')

          return outcome
        },
        dispose: async () => {
          open--
        },
      }
    })

    expect(most).toBe(1)
    expect(open).toBe(0)
    expect(done).toStrictEqual(['a', 'b', 'c'])
    expect(samples.map(s => [s.id, s.genuine, s.pages[0].textScore])).toStrictEqual([['a', true, 0.97], ['b', false, 0.97], ['c', true, 0.8]])
    // No evidence images - nothing looks at them - and the shared engine, and each case's own regions.
    expect(given.every(o => o.audit?.output === 'none' && o.audit.minTextScore === 0.85 && o.engine === ENGINE)).toBe(true)
    expect(given[1].expected).toHaveLength(1)
    expect(given[0].expected).toBeUndefined()

    expect(measured.documents).toStrictEqual({ genuine: 2, altered: 1 })
    expect(measured.best?.thresholds.minTextScore).toBe(0.75)
    expect(measured.points.find(p => p.thresholds.minTextScore === 0.85)?.falseReviews).toStrictEqual(['c'])
  })

  it('disposes a session whose audit fails, and leaves an engine it was given running', async () => {
    const dispose = vi.fn(async () => {})
    const failing = calibrateCorpus([{ id: 'x', genuine: true, original: 'x.pdf', scanned: 'x.pdf' }], { engine: ENGINE }, () => ({
      audit: async () => {
        throw new Error('unreadable')
      },
      dispose,
    }))

    await expect(failing).rejects.toThrow('unreadable')
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(terminate).not.toHaveBeenCalled()
  })

  it('reads an async corpus as it goes', async () => {
    const { samples } = await calibrateCorpus(lateCases(), { engine: ENGINE }, () => ({ audit: async () => report(0.9, false), dispose: async () => {} }))

    expect(samples.map(s => s.id)).toStrictEqual(['late'])
  })
})
