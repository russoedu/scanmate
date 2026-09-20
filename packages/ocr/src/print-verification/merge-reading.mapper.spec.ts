import { mergeVerifiedFigures } from './merge-reading.mapper'
import type { PrintVerification } from './verify-print.use-case'

const RUN = { text: 'Total 1,250.00', x: 0, y: 0, width: 90, height: 12 }

/** A verification of the run above, deciding the characters given at their positions. */
function decided (cells: Array<[number, string, string]>, reading = RUN.text): PrintVerification {
  return {
    reading,
    agrees:     reading === RUN.text,
    checked:    cells.length,
    confidence: 0.3,
    cells:      cells.map(([at, printed, read]) => ({ at, printed, printedScore: 0.9, rival: read, rivalScore: 0.4, read })),
  }
}

describe('mergeVerifiedFigures', () => {
  it('clears a misread digit the ink says was never changed', () => {
    // 'Tota1 7,250.00': the reader mangled a letter and a digit; the ink settles the digit only.
    const merged = mergeVerifiedFigures('Tota1 7,250.00', RUN, decided([[5, '1', '1']]))

    expect(merged).toBe('Tota1 1,250.00')
  })

  it('leaves a changed letter alone: the check never looked at it', () => {
    const merged = mergeVerifiedFigures('Tota1 1,250.00', RUN, decided([[5, '1', '1']]))

    expect(merged).toBe('Tota1 1,250.00')
  })

  it('leaves a digit it could not call to the reading', () => {
    const undecided: PrintVerification = {
      ...decided([[5, '1', '1']]),
      cells: [{ at: 5, printed: '1', printedScore: 0.6, rival: '7', rivalScore: 0.55, read: null }],
    }

    expect(mergeVerifiedFigures('Total 7,250.00', RUN, undecided)).toBe('Total 7,250.00')
  })

  it('reports a digit the ink says did change', () => {
    const merged = mergeVerifiedFigures('Total 1,250.00', RUN, decided([[5, '1', '7']], 'Total 7,250.00'))

    expect(merged).toBe('Total 7,250.00')
  })

  it('cannot place a decision in a reading of another length, and says what the ink saw only when it saw a change', () => {
    expect(mergeVerifiedFigures('Total 7250.00', RUN, decided([[5, '1', '1']]))).toBe('Total 7250.00')
    expect(mergeVerifiedFigures('Total 7250.00', RUN, decided([[5, '1', '7']], 'Total 7,250.00'))).toBe('Total 7,250.00')
  })

  it('takes the ink as the witness when nothing was read at all', () => {
    expect(mergeVerifiedFigures('', RUN, decided([[5, '1', '1']]))).toBe('Total 1,250.00')
  })
})
