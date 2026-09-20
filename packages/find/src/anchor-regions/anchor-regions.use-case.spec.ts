import { checkRegions, locateAnchor, regionsFromAnchor, resolveRegions } from './anchor-regions.use-case'
import type { TextRun } from '@scanmate/ink'

const PAGE = { width: 595, height: 842 }

/** The signature page of an order form, as its text layer places it. */
const ITEMS: TextRun[] = [
  { text: 'For and on behalf of', x: 25, y: 182, width: 90, height: 10 },
  { text: 'Customer', x: 118, y: 182, width: 40, height: 10 },
  { text: 'Name', x: 31, y: 205, width: 29, height: 10 },
  { text: 'Signature', x: 31, y: 225, width: 47, height: 10 },
  { text: 'For and on behalf of JATO Dynamics Limited', x: 25, y: 300, width: 179, height: 10 },
  { text: 'Name', x: 31, y: 323, width: 29, height: 10 },
  { text: 'Signature', x: 31, y: 343, width: 47, height: 10 },
]

const SIGNER = {
  name:      { dx: 35, dy: -2, width: 200, height: 16 },
  signature: { dx: 50, dy: -2, width: 480, height: 40 },
}

describe('locateAnchor', () => {
  it('finds an anchor split across runs on one line, as the box around them', () => {
    expect(locateAnchor(ITEMS, 'For and on behalf of Customer')).toEqual([{ x: 25, y: 182, width: 133, height: 10 }])
  })

  it('matches after normalisation, and only whole', () => {
    expect(locateAnchor(ITEMS, 'for AND on behalf of customer')).toHaveLength(1)
    expect(locateAnchor(ITEMS, 'For and on behalf of Cust')).toEqual([])
  })

  it('finds every occurrence, in page order', () => {
    expect(locateAnchor(ITEMS, 'Signature').map(r => r.y)).toEqual([225, 343])
  })
})

describe('regionsFromAnchor and checkRegions', () => {
  it('places fields from the anchor, and says when one runs off the page or overlaps another', () => {
    const regions = regionsFromAnchor({ x: 31, y: 225, width: 47, height: 10 }, SIGNER)

    expect(regions.signature).toEqual({ x: 81, y: 223, width: 480, height: 40 })
    expect(checkRegions(regions, PAGE)).toEqual([{ kind: 'overlap', ids: ['name', 'signature'] }])
    expect(checkRegions({ wide: { x: 500, y: 10, width: 200, height: 10 } }, PAGE)).toEqual([{ kind: 'off-page', id: 'wide' }])
    expect(checkRegions({ broken: { x: NaN, y: 0, width: 1, height: 1 } }, PAGE)).toEqual([{ kind: 'not-finite', id: 'broken' }])
  })
})

describe('resolveRegions', () => {
  const signature = { signature: SIGNER.signature }

  it('resolves a field against a unique anchor', () => {
    const resolved = resolveRegions(ITEMS, PAGE, { anchor: 'For and on behalf of Customer', fields: { block: { dx: 0, dy: 20, width: 540, height: 70 } } })

    expect(resolved.problems).toEqual([])
    expect(resolved.regions.block).toEqual({ x: 25, y: 202, width: 540, height: 70 })
  })

  it('refuses an ambiguous anchor unless an occurrence is named', () => {
    const ambiguous = resolveRegions(ITEMS, PAGE, { anchor: 'Signature', fields: signature })
    const second = resolveRegions(ITEMS, PAGE, { anchor: 'Signature', fields: signature, occurrence: 2 })

    expect(ambiguous).toEqual({ anchor: null, regions: {}, problems: [{ kind: 'anchor-ambiguous', anchor: 'Signature', occurrences: 2 }] })
    expect(second.regions.signature.y).toBe(341)
    expect(second.problems).toEqual([])
  })

  it('says when the anchor is not on the page', () => {
    expect(resolveRegions(ITEMS, PAGE, { anchor: 'Witness', fields: signature }).problems).toEqual([{ kind: 'anchor-missing', anchor: 'Witness' }])
  })
})
