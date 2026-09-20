import type { PrintedRun } from './glyph-templates.use-case'
import type { PrintVerification } from './verify-print.use-case'

/**
 * Puts what the ink settled into what the scan was read as.
 *
 * The check speaks for the figures it decided, and for nothing else. It looks at
 * digits, cell by cell, and leaves a cell it cannot call. So its answer is merged
 * into the reading one character at a time rather than replacing it: replacing it
 * would erase a changed letter, or a digit too soft to judge, along with the
 * misreadings this is here to clear - and erasing a real change is the one thing
 * the check must never do.
 *
 * @param read - What the scan was read as; empty when nothing was read there.
 * @param run - The run as the original prints it.
 * @param verification - What `verifyPrintedRun` decided about it.
 * @returns The reading with the decided figures settled.
 */
export function mergeVerifiedFigures (read: string, run: PrintedRun, verification: PrintVerification): string {
  const decided = verification.cells.filter(cell => cell.read !== null)
  if (decided.length === 0) return read
  // Nothing was read here at all, yet the ink shows the glyphs: the ink is the better witness.
  if (read.trim() === '') return verification.reading

  // `at` counts the run's printed characters, spaces aside, so the reading has to
  // line up the same way before a position in one means anything in the other.
  const places = [...read].map((character, index) => ({ character, index })).filter(entry => entry.character.trim() !== '')
  const changed = decided.some(cell => cell.read !== cell.printed)
  if (places.length !== [...run.text].filter(character => character.trim() !== '').length)
    return changed ? verification.reading : read

  const merged = [...read]
  for (const cell of decided) if (cell.read !== null) merged[places[cell.at].index] = cell.read

  return merged.join('')
}
