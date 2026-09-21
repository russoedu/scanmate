import type { ReadablePage } from '@scanmate/ink'

import type { AuditReport } from '../page-audit'
import { calibrateAudit, documentPasses } from './calibrate-audit.use-case'
import type { CalibrationSample, SampledFinding } from './calibration.contract'
import { sampleAudit } from './sample-audit.mapper'

const FLOOR = { minChangeArea: 1, minMissingArea: 4 }

function sample (id: string, genuine: boolean, pages: Array<{ score: number, findings?: SampledFinding[] }>): CalibrationSample {
  return {
    id,
    genuine,
    floor: FLOOR,
    pages: pages.map((p, i) => ({ page: i + 1, textScore: p.score, findings: p.findings ?? [], verdict: 'pass' })),
  }
}

const mark = (inkArea: number, hasText = false): SampledFinding => ({ kind: 'unexpected-mark', inkArea, hasText })
const lost = (inkArea: number): SampledFinding => ({ kind: 'missing-ink', inkArea, hasText: false })
const digit: SampledFinding = { kind: 'text-changed', inkArea: null, hasText: true }

describe('calibrateAudit', () => {
  const corpus = [
    sample('clean-sharp', true, [{ score: 0.99 }, { score: 0.97 }]),
    sample('clean-speck', true, [{ score: 0.95, findings: [mark(1.5)] }]),
    sample('clean-blurry', true, [{ score: 0.88 }]),
    sample('forged-digit', false, [{ score: 0.97, findings: [digit] }]),
    sample('added-initials', false, [{ score: 0.96 }, { score: 0.95, findings: [mark(3)] }]),
    sample('forged-unread', false, [{ score: 0.83 }]),
  ]

  it('counts both mistakes by document, at every combination', () => {
    const { documents, points } = calibrateAudit(corpus, { minTextScore: [0.8, 0.85, 0.9], minChangeArea: [1, 2, 4], minMissingArea: [4] })

    expect(documents).toStrictEqual({ genuine: 3, altered: 3 })
    expect(points).toHaveLength(9)
    const at = (minTextScore: number, minChangeArea: number) => points.find(p => p.thresholds.minTextScore === minTextScore && p.thresholds.minChangeArea === minChangeArea)

    // The defaults: a speck of dust holds up a genuine document.
    expect(at(0.85, 1)).toMatchObject({ falseAccepts: [], falseReviews: ['clean-speck'] })
    // Ignoring marks under 2 mm2 lets it through and still catches the initials.
    expect(at(0.85, 2)).toMatchObject({ falseAccepts: [], falseReviews: [], falseAcceptRate: 0, falseReviewRate: 0 })
    // Under 4 mm2, the initials pass too.
    expect(at(0.85, 4)?.falseAccepts).toStrictEqual(['added-initials'])
    // Trusting worse readings passes a forgery the reading could not see.
    expect(at(0.8, 2)?.falseAccepts).toStrictEqual(['forged-unread'])
    // Distrusting better ones holds up the blurry genuine scan.
    expect(at(0.9, 2)?.falseReviews).toStrictEqual(['clean-blurry'])
  })

  it('picks the safest point, and says how little a small corpus proves', () => {
    const { best, points } = calibrateAudit(corpus, { minTextScore: [0.8, 0.85, 0.9], minChangeArea: [1, 2, 4], minMissingArea: [4] })

    expect(best?.thresholds).toStrictEqual({ minTextScore: 0.85, minChangeArea: 2, minMissingArea: 4 })
    expect(points[0]).toBe(best)
    // Three altered documents and none passed: the rate could still be over half.
    expect(best?.falseAcceptUpper).toBeGreaterThan(0.5)
    expect(best?.falseAcceptUpper).toBeLessThan(0.6)
  })

  it('never drops a mark the reading saw words in', () => {
    const doc = sample('overwritten', false, [{ score: 0.97, findings: [mark(0.5, true)] }])

    expect(documentPasses(doc, { minTextScore: 0.85, minChangeArea: 8, minMissingArea: 16 })).toBe(false)
  })

  it('weighs lost ink by its own threshold', () => {
    const doc = sample('dropped-rule', true, [{ score: 0.97, findings: [lost(6)] }])

    expect(documentPasses(doc, { minTextScore: 0.85, minChangeArea: 1, minMissingArea: 4 })).toBe(false)
    expect(documentPasses(doc, { minTextScore: 0.85, minChangeArea: 1, minMissingArea: 8 })).toBe(true)
  })

  it('does not pretend to reach below what the audit reported', () => {
    const coarse = [{ ...sample('a', true, [{ score: 0.9 }]), floor: { minChangeArea: 2, minMissingArea: 4 } }]
    const { points, unreachable } = calibrateAudit(coarse, { minTextScore: [0.85], minChangeArea: [1, 2, 4], minMissingArea: [4] })

    expect(unreachable).toStrictEqual({ minChangeArea: [1] })
    expect(points.map(p => p.thresholds.minChangeArea)).toStrictEqual([2, 4])
  })

  it('has no rate, and no best point, for a kind of document it was not given', () => {
    const { best, points } = calibrateAudit([sample('only-genuine', true, [{ score: 0.9 }])], { minTextScore: [0.85], minChangeArea: [1], minMissingArea: [4] })

    expect(points[0]).toMatchObject({ falseAcceptRate: null, falseAcceptUpper: null, falseReviewRate: 0 })
    expect(best).toBeNull()
  })
})

describe('sampleAudit', () => {
  it('keeps what a threshold decides on, and the thresholds it was measured at', () => {
    const change = { x: 0, y: 0, width: 10, height: 10, inkArea: 2.5, pixels: 90 }
    const expected = { id: 'signature', identified: false }
    const report = {
      pages: [{
        audit: {
          page:     3,
          verdict:  'review',
          text:     { score: 0.93 },
          findings: [
            { kind: 'unexpected-mark', pixels: change, text: [] },
            { kind: 'expected-empty', pixels: expected, text: [] },
            { kind: 'text-changed', pixels: null, text: [{}] },
          ],
        },
      }],
    } as unknown as AuditReport<ReadablePage>

    expect(sampleAudit(report, { id: 'returned.pdf', genuine: false }, { diff: { minChangeArea: 1.5 } })).toStrictEqual({
      id:      'returned.pdf',
      genuine: false,
      floor:   { minChangeArea: 1.5, minMissingArea: 4 },
      pages:   [{
        page:      3,
        textScore: 0.93,
        verdict:   'review',
        findings:  [
          { kind: 'unexpected-mark', inkArea: 2.5, hasText: false },
          { kind: 'expected-empty', inkArea: null, hasText: false },
          { kind: 'text-changed', inkArea: null, hasText: true },
        ],
      }],
    })
  })
})
