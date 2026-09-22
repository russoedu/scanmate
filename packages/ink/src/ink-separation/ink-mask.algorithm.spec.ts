import type { GrayImage } from '../raster-codec'
import { binarize, coverage, dilate, otsuThreshold } from './ink-mask.algorithm'
import { createBinary, createGray } from '../raster-codec'

function grayOf (width: number, height: number, values: number[]): GrayImage {
  const image = createGray(width, height)
  image.data.set(values)

  return image
}

describe('otsuThreshold', () => {
  it('splits a clearly bimodal histogram between the modes', () => {
    const image = createGray(100, 1)
    for (let i = 0; i < 100; i++) image.data[i] = i < 50 ? 0.1 : 0.9

    const threshold = otsuThreshold(image)

    expect(threshold).toBeGreaterThan(0.1)
    expect(threshold).toBeLessThan(0.9)
  })
})

describe('binarize', () => {
  it('will not call half of a blank page ink', () => {
    // Pure noise around zero has no real split, and Otsu would happily invent one.
    const image = createGray(64, 64)
    for (let i = 0; i < image.data.length; i++) image.data[i] = (i % 7) * 0.001

    expect(coverage(binarize(image))).toBe(0)
  })

  it('honours an explicit threshold', () => {
    const image = grayOf(4, 1, [0.1, 0.3, 0.6, 0.9])

    expect([...binarize(image, 0.5).data]).toEqual([0, 0, 1, 1])
  })
})

describe('dilate', () => {
  it('grows a single pixel into a square of the requested radius', () => {
    const mask = createBinary(7, 7)
    mask.data[3 * 7 + 3] = 1
    const grown = dilate(mask, 1)

    let hits = 0
    for (const value of grown.data) hits += value

    expect(hits).toBe(9)
    expect(grown.data[2 * 7 + 2]).toBe(1)
    expect(grown.data[1 * 7 + 1]).toBe(0)
  })

  it('is a no-op at radius zero', () => {
    const mask = createBinary(3, 3)
    mask.data[4] = 1

    expect([...dilate(mask, 0).data]).toEqual([...mask.data])
  })
})
