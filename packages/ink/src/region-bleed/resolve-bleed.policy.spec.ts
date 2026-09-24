import { DEFAULT_BLEED, growBy, hasBleed, resolveBleed, resolveRegionBleed } from './resolve-bleed.policy'

describe('resolveRegionBleed', () => {
  const base = resolveBleed({ bleed: 6, bleedBottom: 14 })

  it('claims exactly what the options say when the region says nothing', () => {
    expect(resolveRegionBleed({}, base)).toEqual(base)
  })

  it("lets a region's named side override the options' side, and leaves the others alone", () => {
    expect(resolveRegionBleed({ bleedBottom: 20 }, base)).toEqual({ top: 6, right: 6, bottom: 20, left: 6 })
  })

  it("lets a region's own `bleed` override every side, and its named side override that", () => {
    expect(resolveRegionBleed({ bleed: 2, bleedLeft: 9 }, base)).toEqual({ top: 2, right: 2, bottom: 2, left: 9 })
  })

  it('accepts zero on a region, which is no room on that side', () => {
    expect(resolveRegionBleed({ bleedTop: 0 }, base).top).toBe(0)
  })

  it('refuses a negative bleed on a region as it does on the options', () => {
    expect(() => resolveRegionBleed({ bleedRight: -3 }, base)).toThrow(RangeError)
  })
})

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
