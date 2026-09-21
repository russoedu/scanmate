import type { TextRun } from '@scanmate/ink'

import { createSyntheticPdf } from '../synthetic-pdf'
import { locateFields } from './locate-fields.use-case'
import { placeField, resolveFields } from './resolve-fields.use-case'

const LETTER = { width: 612, height: 792 }
const SIGNATURE = { dx: 44, dy: -3.8, width: 262, height: 22 }

function run (text: string, x: number, y: number): TextRun {
  return { text, x, y, width: text.length * 5, height: 8 }
}

describe('resolveFields', () => {
  it('places each field from its anchor, on the anchor\'s page', () => {
    const pages = [
      { page: 1, ...LETTER, textItems: [run('Part I', 36, 50)] },
      { page: 2, ...LETTER, textItems: [run('Signature of', 76, 580.8), run('U.S. person', 76, 589.2)] },
    ]
    const { regions, anchors, problems } = resolveFields(pages, [{ anchor: 'Signature of U.S. person', fields: { signature: SIGNATURE } }])

    expect(problems).toStrictEqual([])
    expect(anchors).toMatchObject([{ page: 2, anchor: 'Signature of U.S. person' }])
    expect(regions).toStrictEqual([{ page: 2, id: 'signature', x: 120, y: 577, width: 262, height: 22 }])
  })

  it('refuses to guess between two occurrences, across pages as within one', () => {
    const pages = [
      { page: 1, ...LETTER, textItems: [run('Signature', 50, 700)] },
      { page: 3, ...LETTER, textItems: [run('Signature', 50, 300)] },
    ]
    const field = { signature: { dx: 60, dy: 0, width: 100, height: 20 } }

    expect(resolveFields(pages, [{ anchor: 'Signature', fields: field }]).problems).toStrictEqual([{ kind: 'anchor-ambiguous', anchor: 'Signature', occurrences: 2 }])
    // Counted in page order: the second is on page 3, although it sits higher.
    expect(resolveFields(pages, [{ anchor: 'Signature', fields: field, occurrence: 2 }]).regions[0]).toMatchObject({ page: 3, y: 300 })
    expect(resolveFields(pages, [{ anchor: 'Signature', fields: field, page: 3 }]).regions[0]).toMatchObject({ page: 3 })
    expect(resolveFields(pages, [{ anchor: 'Signature', fields: field, occurrence: 3 }]).problems).toStrictEqual([
      { kind: 'occurrence-missing', anchor: 'Signature', occurrence: 3, occurrences: 2 },
    ])
  })

  it('says which anchors it could not find, and places nothing from them', () => {
    const result = resolveFields([{ page: 1, ...LETTER, textItems: [] }], [{ anchor: 'Sign Here', fields: { sign: SIGNATURE } }])

    expect(result).toStrictEqual({ regions: [], anchors: [], problems: [{ kind: 'anchor-missing', anchor: 'Sign Here' }] })
  })

  it('reports fields off the page, overlapping, unmeasurable or named twice', () => {
    const pages = [{ page: 1, ...LETTER, textItems: [run('Name', 50, 100), run('Date', 400, 100)] }]
    const { problems } = resolveFields(pages, [
      { anchor: 'Name', fields: { name: { dx: 30, dy: 0, width: 300, height: 12 }, wide: { dx: 0, dy: 20, width: 900, height: 12 } } },
      { anchor: 'Date', fields: { date: { dx: -60, dy: 0, width: 100, height: 12 }, name: SIGNATURE, blank: { dx: 0, dy: 40, width: 0, height: 12 } } },
    ])

    expect(problems).toStrictEqual([
      { kind: 'off-page', id: 'wide', page: 1 },
      { kind: 'duplicate-id', id: 'name' },
      { kind: 'not-finite', id: 'blank', page: 1 },
      { kind: 'overlap', ids: ['name', 'date'], page: 1 },
    ])
  })

  it('measures from whichever corner of the anchor is asked for', () => {
    const anchor = { x: 100, y: 200, width: 50, height: 10 }
    const offset = { dx: 5, dy: 5, width: 20, height: 20 }

    expect(placeField(anchor, offset)).toMatchObject({ x: 105, y: 205 })
    expect(placeField(anchor, offset, 'top-right')).toMatchObject({ x: 155, y: 205 })
    expect(placeField(anchor, offset, 'bottom-left')).toMatchObject({ x: 105, y: 215 })
    expect(placeField(anchor, offset, 'bottom-right')).toMatchObject({ x: 155, y: 215, width: 20, height: 20 })
  })
})

describe('locateFields', () => {
  it('finds a wrapped label in a real PDF\'s text layer', async () => {
    // The W-9's signature block, as its text layer places it: 8-point labels on two lines.
    const pdf = await createSyntheticPdf([
      { ...LETTER, text: [{ x: 36, y: 792 - 590, size: 12, content: 'Sign' }] },
      {
        ...LETTER,
        text: [
          { x: 76, y: 792 - 587, size: 8, content: 'Signature of' },
          { x: 76, y: 792 - 595.5, size: 8, content: 'U.S. person' },
          { x: 386, y: 792 - 595.5, size: 8, content: 'Date' },
        ],
      },
    ])
    const { regions, anchors, problems } = await locateFields(pdf, [
      { anchor: 'Signature of U.S. person', fields: { signature: SIGNATURE } },
      { anchor: 'Date', fields: { date: { dx: 20, dy: -2, width: 120, height: 12 } }, from: 'top-right' },
    ])

    expect(problems).toStrictEqual([])
    expect(anchors.map(a => a.page)).toStrictEqual([2, 2])
    const [signature, date] = regions
    expect(signature.x).toBeCloseTo(120, 1)
    expect(Math.abs(signature.y - (anchors[0].box.y - 3.8))).toBeLessThan(1e-9)
    expect(anchors[0].box.height).toBeGreaterThan(14)
    // Measured from the right edge of 'Date', so it clears the label whatever its width.
    expect(date.x).toBeCloseTo(anchors[1].box.x + anchors[1].box.width + 20, 5)
  }, 30_000)

  it('places fields on a turned page in the page\'s displayed frame', async () => {
    const pdf = await createSyntheticPdf([{ ...LETTER, rotate: 90, text: [{ x: 100, y: 700, size: 10, content: 'Customer signature' }] }])
    const { regions, anchors, problems } = await locateFields(pdf, [
      { anchor: 'customer signature', fields: { box: { dx: 0, dy: 0, width: 20, height: 20 } }, page: 1 },
    ])

    expect(problems).toStrictEqual([])
    // Displayed a quarter turn clockwise, the page is landscape and the label runs down it.
    expect(anchors[0].box.height).toBeGreaterThan(anchors[0].box.width)
    // Turned, the page's bottom-left corner is its displayed top-left: the run
    // starting 100 points up from the bottom and 700 across is 100 down the
    // displayed page, just inside 700 from its left.
    expect(anchors[0].box.y).toBeCloseTo(100, 0)
    expect(anchors[0].box.x).toBeLessThan(700)
    expect(anchors[0].box.x).toBeGreaterThan(685)
    expect(regions[0]).toMatchObject({ page: 1, x: anchors[0].box.x, y: anchors[0].box.y })
  }, 30_000)
})
