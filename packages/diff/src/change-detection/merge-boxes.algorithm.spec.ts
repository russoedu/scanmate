import type { Component } from './connected-components.algorithm'
import { mergeBoxes } from './merge-boxes.algorithm'

function box (x: number, y: number, width: number, height: number, pixels = width * height): Component {
  return { x, y, width, height, pixels }
}

describe('mergeBoxes', () => {
  it('leaves nothing and one box alone', () => {
    expect(mergeBoxes([], 5)).toEqual([])
    expect(mergeBoxes([box(0, 0, 4, 4)], 5)).toEqual([{ ...box(0, 0, 4, 4), components: 1 }])
  })

  it('joins boxes within the gap, and keeps the pixels and component count', () => {
    const [merged, ...rest] = mergeBoxes([box(0, 0, 10, 10, 30), box(14, 0, 10, 10, 40)], 5)

    expect(rest).toEqual([])
    expect(merged).toEqual({ x: 0, y: 0, width: 24, height: 10, pixels: 70, components: 2 })
  })

  it('keeps boxes further apart than the gap separate', () => {
    expect(mergeBoxes([box(0, 0, 10, 10), box(30, 0, 10, 10)], 5)).toHaveLength(2)
  })

  it('merges a chain transitively, as the letters of a signature are', () => {
    const letters = Array.from({ length: 8 }, (_, i) => box(i * 14, 0, 10, 12))
    const merged = mergeBoxes(letters, 5)

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ x: 0, width: 108, components: 8 })
  })

  it('merges again when a merged box newly reaches a neighbour', () => {
    // A (a bar along the top) and B (a bar down the left) are within the gap of
    // each other. C sits in the corner they enclose: more than the gap from
    // either one, but inside the box that holds both, so it joins on a second pass.
    const merged = mergeBoxes([box(0, 0, 20, 2), box(0, 6, 2, 20), box(14, 16, 4, 4)], 5)

    expect(merged).toHaveLength(1)
    expect(merged[0].components).toBe(3)
  })

  it('handles thousands of fragments without comparing every pair', () => {
    const confetti = Array.from({ length: 4000 }, (_, i) => box((i % 80) * 30, Math.floor(i / 80) * 30, 2, 2))
    const started = Date.now()
    const merged = mergeBoxes(confetti, 3)

    expect(merged).toHaveLength(4000)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
