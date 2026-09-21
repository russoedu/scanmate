import { toUserSpace, viewportSize, viewportTransform } from './page-viewport.policy'

const A4 = { view: [0, 0, 595, 842] as const, rotation: 0 }

describe('viewportTransform', () => {
  it('flips an unrotated page so the origin is top-left, as pdf.js does', () => {
    expect(viewportTransform(A4)).toEqual([1, 0, 0, -1, 0, 842])
  })

  // Every value below is what pdfjs-dist's `page.getViewport({ scale: 1 }).transform`
  // returned for a real PDF built with pdf-lib at that rotation and crop box - read
  // off the library, not derived here, so this checks the port against the thing it
  // ports rather than against itself.
  it.each([
    [0, [1, 0, 0, -1, 0, 842]],
    [90, [0, 1, 1, 0, 0, 0]],
    [180, [-1, 0, 0, 1, 595, 0]],
    [270, [0, -1, -1, 0, 842, 595]],
  ] as const)('matches pdf.js on a full A4 page turned %i degrees', (rotation, transform) => {
    expect(viewportTransform({ view: [0, 0, 595, 842], rotation })).toEqual(transform)
  })

  it.each([
    [0, [1, 0, 0, -1, -36, 810]],
    [90, [0, 1, 1, 0, -18, -36]],
    [180, [-1, 0, 0, 1, 559, -18]],
    [270, [0, -1, -1, 0, 810, 559]],
  ] as const)('matches pdf.js on a page cropped off its origin, turned %i degrees', (rotation, transform) => {
    // A crop box of 36, 18 to 559, 810: the case a naive y-flip gets wrong.
    expect(viewportTransform({ view: [36, 18, 559, 810], rotation })).toEqual(transform)
  })

  it('refuses a rotation a PDF may not have', () => {
    expect(() => viewportTransform({ view: [0, 0, 595, 842], rotation: 45 })).toThrow(RangeError)
  })
})

describe('viewportSize', () => {
  it('swaps width and height on a quarter turn', () => {
    expect(viewportSize(A4)).toEqual({ width: 595, height: 842 })
    expect(viewportSize({ view: [0, 0, 595, 842], rotation: 90 })).toEqual({ width: 842, height: 595 })
  })
})

describe('toUserSpace', () => {
  it('undoes the viewport exactly, for every rotation and a crop box off the origin', () => {
    for (const rotation of [0, 90, 180, 270])
      for (const view of [[0, 0, 595, 842], [36, 18, 559, 810]] as const) {
        const [a, b, c, d, e, f] = viewportTransform({ view, rotation })
        for (const [ux, uy] of [[100, 200], [view[0], view[1]], [view[2], view[3]]]) {
          const seen = { x: a * ux + c * uy + e, y: b * ux + d * uy + f }
          const back = toUserSpace([a, b, c, d, e, f], seen.x, seen.y)
          expect(back.x).toBeCloseTo(ux, 9)
          expect(back.y).toBeCloseTo(uy, 9)
        }
      }
  })

  it('puts the top-left of an unrotated page at the top of the media box', () => {
    expect(toUserSpace(viewportTransform(A4), 0, 0)).toEqual({ x: 0, y: 842 })
  })
})
