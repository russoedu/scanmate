import { checkGroups } from './checkbox-group.policy'
import type { CheckboxReading, CheckboxState } from './checkbox.contract'

function box (id: string, state: CheckboxState): CheckboxReading {
  const side = { state, ink: 0, fill: 0, solid: 0 }

  return { id, page: 1, box: { x: 0, y: 0, width: 8, height: 8 }, original: { ...side, state: 'empty' }, scanned: side, changed: state !== 'empty', expect: null, satisfied: null }
}

const CLASSIFICATION = ['individual', 'c-corporation', 's-corporation']

describe('checkGroups', () => {
  it('judges each rule by how many boxes the scan shows ticked', () => {
    const one = [box('individual', 'ticked'), box('c-corporation', 'empty'), box('s-corporation', 'empty')]
    const two = [box('individual', 'ticked'), box('c-corporation', 'ticked'), box('s-corporation', 'empty')]
    const none = CLASSIFICATION.map(id => box(id, 'empty'))
    const judge = (readings: CheckboxReading[], ticked: 'exactly-one' | 'at-least-one' | 'at-most-one') =>
      checkGroups(readings, [{ id: 'classification', boxes: CLASSIFICATION, ticked }])[0].satisfied

    expect([judge(one, 'exactly-one'), judge(two, 'exactly-one'), judge(none, 'exactly-one')]).toStrictEqual([true, false, false])
    expect([judge(one, 'at-least-one'), judge(two, 'at-least-one'), judge(none, 'at-least-one')]).toStrictEqual([true, true, false])
    expect([judge(one, 'at-most-one'), judge(two, 'at-most-one'), judge(none, 'at-most-one')]).toStrictEqual([true, false, true])
  })

  it('names what it saw, and never takes a box inked over for an answer', () => {
    const [reading] = checkGroups([box('individual', 'ticked'), box('c-corporation', 'struck'), box('s-corporation', 'empty')], [
      { id: 'classification', boxes: CLASSIFICATION, ticked: 'exactly-one' },
    ])

    expect(reading).toStrictEqual({ id: 'classification', rule: 'exactly-one', ticked: ['individual'], struck: ['c-corporation'], missing: [], satisfied: false })
  })

  it('does not judge a group whose boxes were not all read', () => {
    const [reading] = checkGroups([box('individual', 'ticked')], [{ id: 'classification', boxes: CLASSIFICATION, ticked: 'exactly-one' }])

    expect(reading).toMatchObject({ missing: ['c-corporation', 's-corporation'], satisfied: null })
  })
})
