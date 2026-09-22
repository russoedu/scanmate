import type { CheckboxGroup, CheckboxReading, GroupReading } from './checkbox.contract'

/**
 * Whether each group of boxes is answered as its form asks - "check only one
 * of the following seven boxes" - on the returned scan.
 *
 * A box inked over gives no answer, so it is neither counted as ticked nor as
 * empty: a group holding one is `satisfied: false`, because what it says
 * cannot be read. A group whose boxes were not all read - some on pages that
 * were not audited, as in a document taken a batch at a time - is not judged,
 * and says which boxes it is missing.
 */
export function checkGroups (readings: readonly CheckboxReading[], groups: readonly CheckboxGroup[]): GroupReading[] {
  const byId = new Map(readings.map(reading => [reading.id, reading]))

  return groups.map((group) => {
    const read = group.boxes.flatMap(id => byId.get(id) ?? [])
    const missing = group.boxes.filter(id => !byId.has(id))
    const ticked = read.filter(box => box.scanned.state === 'ticked').map(box => box.id)
    const struck = read.filter(box => box.scanned.state === 'struck').map(box => box.id)

    return {
      id:        group.id,
      rule:      group.ticked,
      ticked,
      struck,
      missing,
      satisfied: missing.length > 0 ? null : struck.length === 0 && RULES[group.ticked](ticked.length),
    }
  })
}

const RULES: Readonly<Record<CheckboxGroup['ticked'], (count: number) => boolean>> = {
  'exactly-one':  count => count === 1,
  'at-least-one': count => count >= 1,
  'at-most-one':  count => count <= 1,
}
