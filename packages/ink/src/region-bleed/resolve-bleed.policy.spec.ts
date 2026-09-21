import { DEFAULT_BLEED, growBy, hasBleed, resolveBleed } from './resolve-bleed.policy'

describe('resolveBleed', () => {
  it('gives every side the default when nothing is set, as the uniform margin always did', () => {
    expect(resolveBleed()).toEqual({ top: DEFAULT_BLEED, right: DEFAULT_BLEED, bottom: DEFAULT_BLEED, left: DEFAULT_BLEED })
  })

  it('applies `bleed` to every side', () => {
    expect(resolveBleed({ bleed: 10 })).toEqual({ top: 10, right: 10, bottom: 10, left: 10 })
  })

  it('lets a named side override the generic bleed', () => {
    expect(resolveBleed({ bleed: 6, bleedBottom: 14, bleedLeft: 0 })).toEqual({ top: 6, right: 6, bottom: 14, left: 0 })
  })

  it('falls back to the default for any side neither names', () => {
    expect(resolveBleed({ bleedTop: 2 })).toEqual({ top: 2, right: DEFAULT_BLEED, bottom: DEFAULT_BLEED, left: DEFAULT_BLEED })
  })

  it('accepts zero, which is no room at all', () => {
    expect(hasBleed(resolveBleed({ bleed: 0 }))).toBe(false)
  })

  it('refuses a negative bleed rather than shrink the region it guards', () => {
    expect(() => resolveBleed({ bleedTop: -1 })).toThrow(RangeError)
    expect(() => resolveBleed({ bleed: NaN })).toThrow(RangeError)
  })
})

describe('growBy', () => {
  it('grows each side by its own amount, the top moving up because the origin is top-left', () => {
    const sides = resolveBleed({ bleed: 0, bleedTop: 2, bleedRight: 3, bleedBottom: 5, bleedLeft: 7 })

    expect(growBy({ x: 100, y: 200, width: 50, height: 20 }, sides)).toEqual({ x: 93, y: 198, width: 60, height: 27 })
  })
})
