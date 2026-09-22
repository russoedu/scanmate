import { createGray, createRandom, gaussian } from '@scanmate/ink'

import { estimateNoiseSigma } from './noise-level.algorithm'

describe('estimateNoiseSigma', () => {
  it('reads a flat page as noiseless', () => {
    const page = createGray(64, 64)
    page.data.fill(0.9)

    expect(estimateNoiseSigma(page)).toBeCloseTo(0, 6)
  })

  it('recovers the level of Gaussian noise added to a page', () => {
    const random = createRandom(3)
    const page = createGray(256, 256)
    for (let i = 0; i < page.data.length; i++) page.data[i] = 0.8 + 0.03 * gaussian(random)

    expect(estimateNoiseSigma(page)).toBeCloseTo(0.03, 2)
  })

  it('reports nothing for an image too small to measure', () => {
    expect(estimateNoiseSigma(createGray(2, 2))).toBe(0)
  })
})
