import type { TextRun } from '@scanmate/ink'

import { locateAnchor } from './locate-anchor.algorithm'

/** A run of 8-point text, 5 points a character, like a form's small print. */
function run (text: string, x: number, y: number, angle = 0): TextRun {
  const length = text.length * 5

  return angle === 90 ? { text, x, y, width: 8, height: length, angle } : { text, x, y, width: length, height: 8, angle }
}

describe('locateAnchor', () => {
  it('follows a label that wraps onto the next line', () => {
    // The W-9's signature label: two runs, one under the other.
    const [match, ...rest] = locateAnchor([run('Signature of', 76, 580.8), run('U.S. person', 76, 589.2)], 'Signature of U.S. person')

    expect(rest).toHaveLength(0)
    expect(match.box).toMatchObject({ x: 76, y: 580.8, width: 60 })
    expect(match.box.height).toBeCloseTo(16.4, 9)
    expect(match.estimated).toBe(false)
  })

  it('joins runs along one line, and not across a column gap', () => {
    const runs = [run('For and on behalf', 50, 100), run('of Customer', 140, 100), run('Customer', 400, 200)]

    expect(locateAnchor(runs, 'For and on behalf of Customer')).toHaveLength(1)
    // 'behalf' then a run 300 points away is two columns, not one label.
    expect(locateAnchor([run('On behalf', 50, 100), run('of', 400, 100)], 'On behalf of')).toHaveLength(0)
  })

  it('matches whole words, never part of one', () => {
    const runs = [run('Update the record', 50, 100), run('Date:', 50, 300)]
    const [date, ...rest] = locateAnchor(runs, 'Date')

    expect(rest).toHaveLength(0)
    expect(date.box.y).toBe(300)
  })

  it('finds a label inside a longer run, and says the box is estimated', () => {
    const [match] = locateAnchor([run('Name (as shown on your income tax return)', 50, 100)], 'income tax')

    expect(match.estimated).toBe(true)
    // 'income tax' is characters 23-33 of 42, so 115 to 165 points in.
    expect(match.box.x).toBeCloseTo(165, 5)
    expect(match.box.width).toBeCloseTo(50, 5)
  })

  it('does not follow a label onto a line too far below it', () => {
    expect(locateAnchor([run('Signature of', 76, 580), run('U.S. person', 76, 620)], 'Signature of U.S. person')).toHaveLength(0)
  })

  it('reads a turned label down the page, its next line beside it', () => {
    // Turned a quarter clockwise, a line reads downward and the next is to its left.
    const runs = [run('Signature of', 500, 100, 90), run('U.S. person', 491.6, 100, 90)]
    const [match] = locateAnchor(runs, 'Signature of U.S. person')

    expect(match.box).toMatchObject({ x: 491.6, y: 100 })
    const [part] = locateAnchor([run('Name of entity', 500, 100, 90)], 'entity')
    // 'entity' is characters 8-14: 40 to 70 points down the page.
    expect(part.box.y).toBeCloseTo(140, 5)
    expect(part.box.height).toBeCloseTo(30, 5)
    expect(part.box.x).toBe(500)
  })

  it('never joins text turned differently', () => {
    expect(locateAnchor([run('Signature of', 76, 580), run('U.S. person', 76, 589, 90)], 'Signature of U.S. person')).toHaveLength(0)
  })

  it('lists every occurrence, top to bottom', () => {
    const found = locateAnchor([run('Date', 300, 700), run('Date', 50, 100)], 'date')

    expect(found.map(f => f.box.y)).toStrictEqual([100, 700])
  })

  it('finds nothing for an anchor with no words', () => {
    expect(locateAnchor([run('___', 50, 100)], '___')).toHaveLength(0)
  })
})
