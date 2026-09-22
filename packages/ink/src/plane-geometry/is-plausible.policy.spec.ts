import { isPlausible } from './is-plausible.policy'
import { scaling, similarity } from './matrix3.algorithm'

const DEGREE = Math.PI / 180

describe('isPlausible', () => {
  it('accepts an ordinary page transform', () => {
    expect(isPlausible(similarity(1.5, 4 * DEGREE, { x: 0, y: 0 }, { x: 20, y: 30 }))).toBe(true)
  })

  it('rejects a mirrored page', () => {
    expect(isPlausible(scaling(-1, 1))).toBe(false)
  })

  it('rejects an absurd scale', () => {
    expect(isPlausible(scaling(400))).toBe(false)
  })

  it('rejects anything non-finite', () => {
    expect(isPlausible([NaN, 0, 0, 0, 1, 0, 0, 0, 1])).toBe(false)
  })
})
