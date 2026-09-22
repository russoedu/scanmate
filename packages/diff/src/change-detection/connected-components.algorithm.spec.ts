import { createBinary } from '@scanmate/ink'
import type { BinaryImage } from '@scanmate/ink'

import { connectedComponents } from './connected-components.use-case'

/** A mask from rows of '#' (set) and '.' (clear). */
function mask (...rows: string[]): BinaryImage {
  const image = createBinary(rows[0].length, rows.length)
  for (const [y, row] of rows.entries())
    for (const [x, cell] of [...row].entries()) image.data[y * row.length + x] = cell === '#' ? 1 : 0

  return image
}

describe('connectedComponents', () => {
  it('finds nothing in an empty mask', () => {
    expect(connectedComponents(mask('....', '....'))).toEqual([])
  })

  it('keeps an L-shape as one component, with its exact box and pixel count', () => {
    const components = connectedComponents(mask(
      '.#...',
      '.#...',
      '.###.',
    ))

    expect(components).toEqual([{ x: 1, y: 0, width: 3, height: 3, pixels: 5 }])
  })

  it('separates two blobs a pixel apart', () => {
    const components = connectedComponents(mask(
      '##.##',
      '##.##',
    ))

    expect(components.map(c => c.pixels)).toEqual([4, 4])
  })

  it('joins a diagonal stroke under 8-connectivity and shatters it under 4', () => {
    const diagonal = mask(
      '#...',
      '.#..',
      '..#.',
      '...#',
    )

    expect(connectedComponents(diagonal)).toHaveLength(1)
    expect(connectedComponents(diagonal, { connectivity: 4 })).toHaveLength(4)
  })

  it('merges labels that meet late, like the two arms of a U', () => {
    // The arms get different provisional labels until the bottom row joins them.
    const components = connectedComponents(mask(
      '#...#',
      '#...#',
      '#####',
    ))

    expect(components).toEqual([{ x: 0, y: 0, width: 5, height: 3, pixels: 9 }])
  })

  it('survives a worst-case checkerboard without overflowing its label table', () => {
    const rows = Array.from({ length: 40 }, (_, y) => Array.from({ length: 41 }, (_, x) => ((x + y) % 2 === 0 ? '#' : '.')).join(''))

    expect(connectedComponents(mask(...rows), { connectivity: 4 })).toHaveLength(820)
    expect(connectedComponents(mask(...rows), { connectivity: 8 })).toHaveLength(1)
  })
})
